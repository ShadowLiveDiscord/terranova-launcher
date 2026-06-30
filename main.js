'use strict';

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const AuthManager   = require('./src/auth/AuthManager');
const UpdateManager = require('./src/update/UpdateManager');
const AppUpdater    = require('./src/update/AppUpdater');

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
      webSecurity: false,
    },
    show: false,
  });

  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());

  AppUpdater.init(mainWindow);
}

app.whenReady().then(() => {
  createWindow();
  // Vérification auto au démarrage (silencieuse si en dev ou si à jour)
  setTimeout(() => AppUpdater.checkForUpdates(), 3000);
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

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

// ── Lancement du jeu ─────────────────────────────────────────────────────────
ipcMain.on('launch-game', (event, opts) => {
  // Ici : appel à minecraft-launcher-core ou node-minecraft-launcher
  console.log('Lancement demandé :', opts);
});
