'use strict';

require('dotenv').config({ path: __dirname + '/.env' });

const { app, BrowserWindow, ipcMain, shell, dialog, session } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const AuthManager      = require('./src/auth/AuthManager');
const UpdateManager    = require('./src/update/UpdateManager');
const AppUpdater       = require('./src/update/AppUpdater');
const LaunchManager    = require('./src/launch/LaunchManager');
const DiscordManager   = require('./src/discord/DiscordManager');
const SecurityManager  = require('./src/security/SecurityManager');

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu-sandbox');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 1100,
    minHeight: 680,
    frame: false,
    backgroundColor: '#0a0a0a',
    icon: path.join(__dirname, 'assets', 'logo.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      webSecurity: false, // requis pour charger les skins Mojang CDN depuis file://
    },
    show: false,
  });

  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());

  AppUpdater.init(mainWindow);
}

app.whenReady().then(() => {
  SecurityManager.applyCSP(session.defaultSession);
  createWindow();
  setTimeout(() => AppUpdater.checkForUpdates(), 3000);
});
app.on('window-all-closed', () => {
  DiscordManager.destroy();
  if (process.platform !== 'darwin') app.quit();
});

// ── Titlebar ──────────────────────────────────────────────────────────────────
ipcMain.on('minimize-window', () => mainWindow?.minimize());
ipcMain.on('close-window',    () => mainWindow?.close());
ipcMain.on('maximize-window', () => {
  mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize();
});

// ── Auth Microsoft ────────────────────────────────────────────────────────────

// Vérifier si une session est déjà sauvegardée au démarrage
ipcMain.handle('auth:autoLogin', async () => {
  try {
    const session = await AuthManager.autoLogin();
    return { success: !!session, session };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Lancer le flow OAuth complet (ouvre la fenêtre Microsoft)
ipcMain.handle('auth:login', async () => {
  try {
    const session = await AuthManager.authenticate();
    return { success: true, session };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// Déconnexion : supprime la session sauvegardée
ipcMain.handle('auth:logout', async () => {
  AuthManager.clearSession();
  return { success: true };
});

// ── Vérification MAJ distante ────────────────────────────────────────────────
ipcMain.handle('update:check', async (event, { url }) => {
  try {
    const manifest = await UpdateManager.fetchRemoteManifest(url);
    return { success: true, manifest };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Téléchargement des fichiers de l'instance ─────────────────────────────────
ipcMain.handle('update:start', async (event, { instanceDir, files }) => {
  try {
    const results = await UpdateManager.runUpdate(instanceDir, files, (progress) => {
      mainWindow?.webContents.send('update:progress', progress);
    });
    return { success: true, results };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Mise à jour automatique du launcher (electron-updater / GitHub Releases) ──
ipcMain.handle('app:getVersion',      () => app.getVersion());
ipcMain.handle('app-update:check',   () => AppUpdater.checkForUpdates());
ipcMain.handle('app-update:download', () => AppUpdater.downloadUpdate());
ipcMain.on('app-update:install', () => AppUpdater.quitAndInstall());

// ── Helpers temps de jeu ─────────────────────────────────────────────────────
function parsePlaytimeSecs(str) {
  if (!str || str === '-') return 0;
  const h = (str.match(/(\d+)h/) || [])[1] || 0;
  const m = (str.match(/(\d+)m/) || [])[1] || 0;
  return parseInt(h) * 3600 + parseInt(m) * 60;
}
function formatPlaytime(secs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${h}h ${m}m`;
}

let gameStartTime = null;

// ── Lancement du jeu (minecraft-launcher-core) ───────────────────────────────
ipcMain.handle('game:launch', async (event, opts) => {
  gameStartTime = null;
  const result = await LaunchManager.launchGame(
    opts,
    (progress) => mainWindow?.webContents.send('game:progress', progress),
    (data)     => mainWindow?.webContents.send('game:data',     data),
    (code)     => {
      if (gameStartTime !== null) {
        const elapsedSecs = Math.floor((Date.now() - gameStartTime) / 1000);
        gameStartTime = null;
        try {
          const instanceJsonPath = path.join(__dirname, 'instance.json');
          const saved = JSON.parse(fs.readFileSync(instanceJsonPath, 'utf8'));
          saved.instance.playtime = formatPlaytime(parsePlaytimeSecs(saved.instance.playtime) + elapsedSecs);
          fs.writeFileSync(instanceJsonPath, JSON.stringify(saved, null, 2), 'utf8');
          mainWindow?.webContents.send('game:playtime', { playtime: saved.instance.playtime });
        } catch {}
      }
      mainWindow?.webContents.send('game:close', code);
    },
  );
  if (result.success) {
    gameStartTime = Date.now();
    try {
      const instanceJsonPath = path.join(__dirname, 'instance.json');
      const raw  = fs.readFileSync(instanceJsonPath, 'utf8');
      const data = JSON.parse(raw);
      const now  = new Date();
      const pad  = (n) => String(n).padStart(2, '0');
      const timestamp = `${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} à ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      data.instance.last_launch = timestamp;
      fs.writeFileSync(instanceJsonPath, JSON.stringify(data, null, 2), 'utf8');
      mainWindow?.webContents.send('game:launched', { last_launch: timestamp });
    } catch {}
  }
  return result;
});

ipcMain.on('game:kill', () => {
  LaunchManager.killGame();
  DiscordManager.clearActivity();
});

// ── Discord Rich Presence ─────────────────────────────────────────────────────
ipcMain.handle('discord:play', (_, opts) => DiscordManager.setPlaying(opts));
ipcMain.handle('discord:stop', ()       => DiscordManager.clearActivity());

// ── Chemin instance (AppData, toujours accessible sans droits admin) ──────────
ipcMain.handle('app:getInstanceDir', () =>
  path.join(app.getPath('userData'), 'instances', 'terranova')
);

// ── Détection Java ────────────────────────────────────────────────────────────
ipcMain.handle('java:detect', () => LaunchManager.detectJava());

// ── RAM système ───────────────────────────────────────────────────────────────
ipcMain.handle('ram:stats', () => ({
  total: os.totalmem(),
  free:  os.freemem(),
}));

// ── Shell : ouvrir un dossier / lien externe ──────────────────────────────────
ipcMain.handle('shell:openPath', async (_, p) => {
  const err = await shell.openPath(p);
  return { success: err === '' };
});

ipcMain.handle('shell:openExternal', async (_, url) => {
  await shell.openExternal(url);
  return { success: true };
});

// ── Dialog : choisir un dossier ───────────────────────────────────────────────
ipcMain.handle('dialog:openFolder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
  return { canceled: r.canceled, path: r.filePaths[0] || '' };
});

// ── Gestion réelle des mods (scan + toggle) ───────────────────────────────────
ipcMain.handle('mods:scan', async (_, instanceDir) => {
  const modsDir     = path.join(instanceDir, 'mods');
  const disabledDir = path.join(instanceDir, 'mods', 'disabled');
  const result = [];
  const exts   = ['.jar', '.zip'];

  // Scan récursif (exclut le sous-dossier disabled qui est traité séparément)
  const scan = (dir, enabled) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) {
        if (full !== disabledDir) scan(full, enabled);
      } else if (exts.some(e => f.endsWith(e))) {
        result.push({
          filename: f,
          relPath:  path.relative(modsDir, full).replace(/\\/g, '/'),
          enabled,
        });
      }
    }
  };

  scan(modsDir, true);

  // Scan du dossier disabled (un seul niveau)
  if (fs.existsSync(disabledDir)) {
    for (const f of fs.readdirSync(disabledDir)) {
      if (exts.some(e => f.endsWith(e))) {
        result.push({ filename: f, relPath: 'disabled/' + f, enabled: false });
      }
    }
  }

  return result;
});

ipcMain.handle('mods:toggle', async (_, { instanceDir, filename, relPath, enable }) => {
  const modsDir     = path.join(instanceDir, 'mods');
  const disabledDir = path.join(instanceDir, 'mods', 'disabled');
  try {
    if (enable) {
      fs.mkdirSync(modsDir, { recursive: true });
      fs.renameSync(path.join(disabledDir, filename), path.join(modsDir, filename));
    } else {
      fs.mkdirSync(disabledDir, { recursive: true });
      const src = relPath ? path.join(modsDir, relPath) : path.join(modsDir, filename);
      fs.renameSync(src, path.join(disabledDir, filename));
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Crash reporter ────────────────────────────────────────────────────────────
ipcMain.handle('crash:getReport', async (_, instanceDir) => {
  const crashDir = path.join(instanceDir, 'crash-reports');
  try {
    if (!fs.existsSync(crashDir)) return { success: false, reason: 'no_dir' };
    const files = fs.readdirSync(crashDir)
      .filter(f => f.endsWith('.txt'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(crashDir, f)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    if (!files.length) return { success: false, reason: 'no_reports' };
    const latest = files[0];
    const content = fs.readFileSync(path.join(crashDir, latest.name), 'utf8');
    const lines   = content.split('\n').filter(l => l.trim());
    return {
      success:  true,
      filename: latest.name,
      last10:   lines.slice(-10).join('\n'),
      fullPath: path.join(crashDir, latest.name),
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Stats MySQL ───────────────────────────────────────────────────────────────
ipcMain.handle('server:dbStats', async () => {
  if (!DB_CONFIG.host) return { success: false, reason: 'not_configured' };
  try {
    const mysql = require('mysql2/promise');
    const conn  = await mysql.createConnection(DB_CONFIG);
    const [tables] = await conn.execute('SHOW TABLES');
    const tableNames = tables.map(t => Object.values(t)[0]);
    const counts = {};
    for (const tbl of tableNames) {
      try {
        const [[row]] = await conn.execute(`SELECT COUNT(*) AS c FROM \`${tbl}\``);
        counts[tbl] = row.c;
      } catch { counts[tbl] = '?'; }
    }
    const PLAYER_TABLES = ['users', 'players', 'membres', 'accounts', 'utilisateurs', 'joueurs'];
    const playerTable = tableNames.find(t => PLAYER_TABLES.includes(t.toLowerCase()));
    let recentRows = [], columns = [];
    if (playerTable) {
      try {
        const [rows] = await conn.execute(`SELECT * FROM \`${playerTable}\` ORDER BY id DESC LIMIT 10`);
        recentRows = rows;
        if (rows.length) columns = Object.keys(rows[0]);
      } catch {}
    }
    await conn.end();
    return { success: true, tableNames, counts, playerTable, recentRows, columns };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Statut du serveur Minecraft (SLP ping) ────────────────────────────────────
ipcMain.handle('server:ping', async (_, { host, port }) => {
  try {
    const { status } = require('minecraft-server-util');
    const t0     = Date.now();
    const result = await status(host, port || 25565, { timeout: 5000, enableSRV: true });
    return {
      success:    true,
      online:     true,
      players:    result.players.online,
      maxPlayers: result.players.max,
      version:    result.version.name,
      motd:       result.motd.clean || '',
      latency:    Date.now() - t0,
    };
  } catch {
    return { success: true, online: false };
  }
});

// ── Base de données MySQL ─────────────────────────────────────────────────────
const DB_CONFIG = {
  host:               process.env.DB_HOST || '',
  user:               process.env.DB_USER || '',
  password:           process.env.DB_PASS || '',
  database:           process.env.DB_NAME || '',
  connectionLimit:    5,
  waitForConnections: true,
};

let _dbPool = null;
function dbPool() {
  if (!_dbPool) _dbPool = require('mysql2/promise').createPool(DB_CONFIG);
  return _dbPool;
}

ipcMain.handle('server:db', async (_, { query, params }) => {
  try {
    const [rows] = await dbPool().execute(query, params || []);
    return { success: true, rows };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Ajouter des mods (copie vers instanceDir/mods/) ──────────────────────────
ipcMain.handle('mods:add', async (_, instanceDir, mode = 'files') => {
  const exts = ['.jar', '.zip'];
  const collectFiles = (p) => {
    if (fs.statSync(p).isDirectory())
      return fs.readdirSync(p).flatMap(f => collectFiles(path.join(p, f)));
    return exts.some(e => p.endsWith(e)) ? [p] : [];
  };

  const isFolder = mode === 'folder';
  const r = await dialog.showOpenDialog(mainWindow, {
    title: isFolder ? 'Sélectionner un dossier de mods' : 'Sélectionner des fichiers mod',
    ...(!isFolder && { filters: [{ name: 'Fichiers mod', extensions: ['jar', 'zip'] }] }),
    properties: isFolder ? ['openDirectory', 'multiSelections'] : ['openFile', 'multiSelections'],
  });
  if (r.canceled || !r.filePaths.length) return { success: false, canceled: true };

  const modsDir = path.join(instanceDir, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });
  const added = [];

  if (isFolder) {
    for (const src of r.filePaths) {
      const folderName = path.basename(src);
      fs.cpSync(src, path.join(modsDir, folderName), { recursive: true });
      added.push(folderName);
    }
  } else {
    for (const src of r.filePaths) {
      for (const file of collectFiles(src)) {
        const filename = path.basename(file);
        fs.copyFileSync(file, path.join(modsDir, filename));
        added.push(filename);
      }
    }
  }
  return { success: true, added };
});

// ── Dialog : sélectionner des JARs + calcul SHA256 (panel admin) ──────────────
// Si instanceDir est fourni, copie aussi les fichiers dans mods/ pour un test local immédiat.
// ── Sync distribution.json vers GitHub (multi-PC) ────────────────────────────
ipcMain.handle('admin:pushDistribution', async (_, { content, manifestUrl, token }) => {
  try {
    const https = require('https');
    // Parse: https://raw.githubusercontent.com/{owner}/{repo}/{branch}/{file}
    const m = manifestUrl.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)/);
    if (!m) return { success: false, error: 'manifest_url invalide (attendu: raw.githubusercontent.com/owner/repo/branch/file)' };
    const [, owner, repo, branch, filePath] = m;

    const apiCall = (method, apiPath, body) => new Promise((resolve, reject) => {
      const bodyStr = body ? JSON.stringify(body) : null;
      const opts = {
        hostname: 'api.github.com',
        path: apiPath,
        method,
        headers: {
          Authorization: `token ${token}`,
          'User-Agent': 'TerraNova-Launcher',
          Accept: 'application/vnd.github.v3+json',
          ...(bodyStr ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
        },
      };
      const req = https.request(opts, (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      });
      req.on('error', reject);
      if (bodyStr) req.write(bodyStr);
      req.end();
    });

    const getRes = await apiCall('GET', `/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`);
    if (getRes.status !== 200) return { success: false, error: `GET échoué (${getRes.status}): ${getRes.body?.message || ''}` };

    const putRes = await apiCall('PUT', `/repos/${owner}/${repo}/contents/${filePath}`, {
      message: 'Update distribution.json [admin panel]',
      content: Buffer.from(content).toString('base64'),
      sha: getRes.body.sha,
      branch,
    });
    if (putRes.status === 200 || putRes.status === 201) return { success: true };
    return { success: false, error: `PUT échoué (${putRes.status}): ${putRes.body?.message || ''}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

ipcMain.handle('admin:pickMods', async (_, instanceDir) => {
  const r = await dialog.showOpenDialog(mainWindow, {
    title: 'Sélectionner les fichiers de mods',
    filters: [{ name: 'Fichiers mod', extensions: ['jar', 'zip', 'json', 'toml'] }, { name: 'Tous', extensions: ['*'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (r.canceled || !r.filePaths.length) return [];

  const crypto = require('crypto');
  const results = r.filePaths.map(fp => {
    const stat = fs.statSync(fp);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(fp)).digest('hex');
    return { filename: path.basename(fp), size: stat.size, sha256: hash, _src: fp };
  });

  // Copie dans instanceDir/mods/ pour que l'admin puisse tester immédiatement
  if (instanceDir) {
    const modsDir = path.join(instanceDir, 'mods');
    fs.mkdirSync(modsDir, { recursive: true });
    for (const m of results) {
      try { fs.copyFileSync(m._src, path.join(modsDir, m.filename)); } catch {}
    }
  }

  return results.map(({ filename, size, sha256 }) => ({ filename, size, sha256 }));
});
