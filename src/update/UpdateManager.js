'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const fetch  = require('node-fetch');

// Télécharge le manifest distant (instance.json côté serveur)
async function fetchRemoteManifest(url) {
  const res = await fetch(url, { timeout: 10000 });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// Calcule le SHA-256 d'un fichier local (null si inexistant)
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(filePath)) return resolve(null);
    const hash   = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data',  chunk => hash.update(chunk));
    stream.on('end',   ()    => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

// Télécharge un fichier en streaming avec callback de progression
async function downloadFile(url, dest, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Téléchargement échoué : HTTP ${res.status} pour ${url}`);

  const total      = parseInt(res.headers.get('content-length') || '0', 10);
  let   downloaded = 0;

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp    = dest + '.tmp';
  const stream = fs.createWriteStream(tmp);

  return new Promise((resolve, reject) => {
    res.body.on('data', chunk => {
      stream.write(chunk);
      downloaded += chunk.length;
      if (onProgress && total > 0) onProgress(downloaded / total);
    });
    res.body.on('end', () => {
      stream.end(() => {
        try { fs.renameSync(tmp, dest); resolve(); }
        catch (e) { reject(e); }
      });
    });
    res.body.on('error', err => {
      stream.destroy();
      try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
      reject(err);
    });
  });
}

/**
 * Lance la mise à jour complète.
 * @param {string}   instanceDir  Dossier racine de l'instance
 * @param {Array}    files        Liste de { path, url, sha256, size }
 * @param {Function} onProgress   ({ phase, file, index, total, filePct, globalPct })
 */
async function runUpdate(instanceDir, files, onProgress) {
  const results = [];

  for (let i = 0; i < files.length; i++) {
    const file     = files[i];
    const destPath = path.join(instanceDir, file.path);
    const globalPct = i / files.length;

    onProgress({ phase: 'check', file: file.path, index: i, total: files.length, filePct: 0, globalPct });

    const localHash = await hashFile(destPath);

    if (localHash && localHash === file.sha256) {
      results.push({ path: file.path, status: 'ok' });
      continue;
    }

    onProgress({ phase: 'download', file: file.path, index: i, total: files.length, filePct: 0, globalPct });

    await downloadFile(file.url, destPath, (filePct) => {
      onProgress({
        phase: 'download',
        file:  file.path,
        index: i,
        total: files.length,
        filePct,
        globalPct: globalPct + filePct / files.length,
      });
    });

    // Vérification du hash après téléchargement
    const newHash = await hashFile(destPath);
    if (file.sha256 !== 'placeholder' && newHash !== file.sha256) {
      try { fs.unlinkSync(destPath); } catch {}
      throw new Error(`Erreur de vérification pour ${file.path}`);
    }

    results.push({ path: file.path, status: 'updated' });
  }

  return results;
}

module.exports = { fetchRemoteManifest, runUpdate };
