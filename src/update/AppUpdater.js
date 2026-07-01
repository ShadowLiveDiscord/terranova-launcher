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
    const msg = err.message || '';
    let clean;
    if (msg.includes('404') || msg.includes('Not Found'))
      clean = 'Aucune mise à jour trouvée sur GitHub (404)';
    else if (msg.includes('403') || msg.includes('Forbidden') || msg.includes('rate limit'))
      clean = 'Limite de requêtes GitHub atteinte, réessaie dans une heure';
    else if (msg.includes('ENOTFOUND') || msg.includes('ECONNREFUSED') || msg.includes('network'))
      clean = 'Pas de connexion internet';
    else if (msg.includes('ERR_INTERNET_DISCONNECTED'))
      clean = 'Pas de connexion internet';
    else
      clean = 'Erreur lors de la vérification (' + msg.slice(0, 80) + ')';
    send('app-update:status', { state: 'error', error: clean });
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
