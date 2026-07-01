'use strict';

const { Client }      = require('minecraft-launcher-core');
const { execSync }    = require('child_process');
const { exec }        = require('child_process');
const path            = require('path');
const fs              = require('fs');

let activeClient = null;

// ── Lancement du jeu ──────────────────────────────────────────────────────────
async function launchGame(opts, onProgress, onData, onClose) {
  const { session, instanceDir, version, loader, ramMb, javaPath, jvmArgs } = opts;

  const launcher = new Client();
  activeClient   = launcher;

  // Construction de la version Forge : "1.20.4-forge-47.2.0"
  let customVersion = null;
  if (loader) {
    const forgeMatch = loader.match(/forge\s+([\d.]+)/i);
    if (forgeMatch) customVersion = `${version}-forge-${forgeMatch[1]}`;
  }

  const config = {
    authorization: {
      access_token:    session.tokens.mcAccessToken,
      uuid:            session.profile.id,
      name:            session.profile.name,
      user_properties: '{}',
      meta:            { type: 'msa', demo: false },
    },
    root:    instanceDir,
    version: {
      number: version,
      type:   'release',
      ...(customVersion ? { custom: customVersion } : {}),
    },
    memory: {
      max: `${ramMb}M`,
      min: `${Math.max(512, Math.floor(ramMb / 2))}M`,
    },
  };

  if (javaPath && javaPath !== 'java') config.javaPath = javaPath;

  if (jvmArgs) {
    const args = jvmArgs.split(/\s+/).filter(Boolean);
    if (args.length) config.customArgs = args;
  }

  launcher.on('progress', (e) => onProgress(e));
  launcher.on('data',     (e) => onData(String(e)));
  launcher.on('close',    (code) => { activeClient = null; onClose(code); });

  try {
    await launcher.launch(config);
    return { success: true };
  } catch (e) {
    activeClient = null;
    return { success: false, error: e.message };
  }
}

function killGame() {
  if (activeClient) {
    try { activeClient.kill?.(); } catch {}
    activeClient = null;
  }
}

// ── Détection Java ────────────────────────────────────────────────────────────
function detectJava() {
  const found  = [];
  const seen   = new Set();

  function probe(javaExe) {
    const key = javaExe.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    try {
      // java -version écrit sur stderr
      const raw = execSync(`"${javaExe}" -version 2>&1`, { timeout: 4000, stdio: 'pipe' }).toString();
      const m   = raw.match(/version "([^"]+)"/);
      if (m) found.push({ path: javaExe, version: m[1], label: buildLabel(javaExe, m[1]) });
    } catch {}
  }

  function buildLabel(p, v) {
    const major = v.startsWith('1.') ? v.split('.')[1] : v.split('.')[0];
    const name  = p === 'java' ? 'Java système' : path.basename(path.dirname(path.dirname(p)));
    return `Java ${major} — ${name} (${v})`;
  }

  // Java dans le PATH
  probe('java');

  // Répertoires courants d'installation
  const bases = [
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Microsoft',
    'C:\\Program Files\\BellSoft',
    'C:\\Program Files\\Zulu',
    'C:\\Program Files\\Amazon Corretto',
    process.env.JAVA_HOME,
    process.env.JRE_HOME,
  ].filter(Boolean);

  for (const base of bases) {
    try {
      if (!fs.existsSync(base)) continue;
      for (const entry of fs.readdirSync(base)) {
        const javaExe = path.join(base, entry, 'bin', 'java.exe');
        if (fs.existsSync(javaExe)) probe(javaExe);
      }
    } catch {}
  }

  return found;
}

module.exports = { launchGame, killGame, detectJava };
