'use strict';

const { app, BrowserWindow, ipcMain, shell, dialog, session } = require('electron');
const path = require('path');
const os = require('os');
const AuthManager      = require('./src/auth/AuthManager');
const UpdateManager    = require('./src/update/UpdateManager');
const AppUpdater       = require('./src/update/AppUpdater');
const LaunchManager    = require('./src/launch/LaunchManager');
const DiscordManager   = require('./src/discord/DiscordManager');
const SecurityManager  = require('./src/security/SecurityManager');

app.commandLine.appendSwitch('disable-features', 'NetworkService');
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
ipcMain.handle('app-update:check',   () => AppUpdater.checkForUpdates());
ipcMain.handle('app-update:download', () => AppUpdater.downloadUpdate());
ipcMain.on('app-update:install', () => AppUpdater.quitAndInstall());

// ── Lancement du jeu (minecraft-launcher-core) ───────────────────────────────
ipcMain.handle('game:launch', async (event, opts) => {
  return LaunchManager.launchGame(
    opts,
    (progress) => mainWindow?.webContents.send('game:progress', progress),
    (data)     => mainWindow?.webContents.send('game:data',     data),
    (code)     => mainWindow?.webContents.send('game:close',    code),
  );
});

ipcMain.on('game:kill', () => {
  LaunchManager.killGame();
  DiscordManager.clearActivity();
});

// ── Discord Rich Presence ─────────────────────────────────────────────────────
ipcMain.handle('discord:play', (_, opts) => DiscordManager.setPlaying(opts));
ipcMain.handle('discord:stop', ()       => DiscordManager.clearActivity());

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
