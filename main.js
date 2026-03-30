const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const os   = require('os');

// ── persistent settings via electron's simple store ─────────────────────────
const Store = (() => {
  const fs = require('fs');
  const file = path.join(app.getPath('userData'), 'settings.json');
  let data = {};
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  return {
    get: (k, def) => (k in data ? data[k] : def),
    set: (k, v)   => { data[k] = v; fs.writeFileSync(file, JSON.stringify(data, null, 2)); },
  };
})();

// ── window ───────────────────────────────────────────────────────────────────
let win;

function createWindow() {
  win = new BrowserWindow({
    width:  480,
    height: 720,
    minWidth:  420,
    minHeight: 600,
    title: 'DOOM-CLAUDE Monitor',
    backgroundColor: '#1a0a00',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: process.platform !== 'darwin',
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadFile('renderer.html');
  win.webContents.openDevTools({ mode: 'detach' });

  // Restore saved position
  const bounds = Store.get('windowBounds', null);
  if (bounds) win.setBounds(bounds);

  win.on('close', () => {
    Store.set('windowBounds', win.getBounds());
  });

  // Open external links in system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── IPC: settings ────────────────────────────────────────────────────────────
ipcMain.handle('settings:get', (_, key, def) => Store.get(key, def));
ipcMain.handle('settings:set', (_, key, val) => { Store.set(key, val); });

// ── IPC: Claude Code session reading ─────────────────────────────────────────
const fs   = require('fs');
const claudeDir = path.join(os.homedir(), '.claude');

ipcMain.handle('claude:listSessions', () => {
  const projectsDir = path.join(claudeDir, 'projects');
  const homeEncoded = os.homedir().replace(/\//g, '-');
  console.log('[listSessions] projectsDir:', projectsDir);
  console.log('[listSessions] homeEncoded:', homeEncoded);

  function displayName(proj) {
    const rel   = proj.startsWith(homeEncoded) ? proj.slice(homeEncoded.length) : proj;
    const parts = rel.split('-').filter(Boolean);
    const ci    = parts.lastIndexOf('code');
    return ci >= 0 ? parts.slice(ci + 1).join('-') : parts.slice(-2).join('-') || proj;
  }

  const results = [];
  try {
    const projs = fs.readdirSync(projectsDir);
    console.log('[listSessions] projects found:', projs.length);
    for (const proj of projs) {
      const projDir = path.join(projectsDir, proj);
      try {
        const files = fs.readdirSync(projDir).filter(f => f.endsWith('.jsonl'));
        for (const file of files) {
          const jsonlPath = path.join(projDir, file);
          const stat      = fs.statSync(jsonlPath);
          if (stat.size === 0) continue;
          results.push({
            sessionId:  file.replace('.jsonl', ''),
            displayDir: displayName(proj),
            startedAt:  stat.mtimeMs,
            jsonlPath,
          });
        }
      } catch(e) { console.log('[listSessions] projDir error:', e.message); }
    }
  } catch(e) { console.log('[listSessions] outer error:', e.message); }
  console.log('[listSessions] returning', results.length, 'sessions');
  return results.sort((a, b) => b.startedAt - a.startedAt).slice(0, 20);
});

ipcMain.handle('claude:readUsage', (_, jsonlPath) => {
  try {
    const lines = fs.readFileSync(jsonlPath, 'utf8').trim().split('\n').filter(Boolean);
    const byModel = {};
    let totalMessages = 0;
    for (const line of lines) {
      try {
        const obj = JSON.parse(line);
        if (obj.type !== 'assistant') continue;
        const msg = obj.message;
        if (!msg?.usage) continue;
        totalMessages++;
        const model = msg.model || 'unknown';
        if (!byModel[model]) byModel[model] = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        byModel[model].input     += msg.usage.input_tokens                  || 0;
        byModel[model].output    += msg.usage.output_tokens                 || 0;
        byModel[model].cacheRead += msg.usage.cache_read_input_tokens       || 0;
        byModel[model].cacheWrite+= msg.usage.cache_creation_input_tokens   || 0;
      } catch {}
    }
    return { byModel, totalMessages };
  } catch { return { byModel: {}, totalMessages: 0 }; }
});
