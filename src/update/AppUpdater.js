'use strict';

const { autoUpdater } = require('electron-updater');
const { app } = require('electron');

autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

let mainWindowRef = null;

function send(channel, payload) {
  mainWindowRef?.webContents.send(channel, payload);
}

function init(mainWindow) {
  mainWindowRef = mainWindow;

  autoUpdater.on('checking-for-update', () => {
    send('app-update:status', { state: 'checking' });
  });

  autoUpdater.on('update-available', (info) => {
    send('app-update:status', { state: 'available', version: info.version, notes: info.releaseNotes });
  });

  autoUpdater.on('update-not-available', () => {
    send('app-update:status', { state: 'not-available', version: app.getVersion() });
  });

  autoUpdater.on('download-progress', (progress) => {
    send('app-update:status', {
      state: 'downloading',
      pct: progress.percent / 100,
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    send('app-update:status', { state: 'downloaded', version: info.version });
  });

  autoUpdater.on('error', (err) => {
    send('app-update:status', { state: 'error', error: err.message });
  });
}

// Ne vérifie que sur une build packagée (un `npm start` en dev n'a pas de feed de mise à jour)
async function checkForUpdates() {
  if (!app.isPackaged) {
    return { success: false, error: 'DEV_MODE' };
  }
  try {
    await autoUpdater.checkForUpdates();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function downloadUpdate() {
  if (!app.isPackaged) return { success: false, error: 'DEV_MODE' };
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function quitAndInstall() {
  autoUpdater.quitAndInstall();
}

module.exports = { init, checkForUpdates, downloadUpdate, quitAndInstall };
