'use strict';

const { Client }   = require('minecraft-launcher-core');
const { execSync } = require('child_process');
const { spawn }    = require('child_process');
const fetch        = require('node-fetch');
const path         = require('path');
const fs           = require('fs');

let activeProcess = null;

// ── Vérification NeoForge installé ───────────────────────────────────────────
function isNeoForgeInstalled(instanceDir, neoforgeVersion) {
  const versionJson = path.join(
    instanceDir, 'versions', `neoforge-${neoforgeVersion}`,
    `neoforge-${neoforgeVersion}.json`
  );
  return fs.existsSync(versionJson);
}

function isForgeInstalled(instanceDir, mcVersion, forgeVersion) {
  const versionJson = path.join(
    instanceDir, 'versions', `${mcVersion}-forge-${forgeVersion}`,
    `${mcVersion}-forge-${forgeVersion}.json`
  );
  return fs.existsSync(versionJson);
}

// ── Téléchargement streaming avec progress ────────────────────────────────────
async function downloadFile(url, dest, onProgress) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  const total      = parseInt(res.headers.get('content-length') || '0');
  let   downloaded = 0;
  const tmp        = dest + '.tmp';
  const stream     = fs.createWriteStream(tmp);

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

// ── Lancement de l'installateur NeoForge / Forge en headless ─────────────────
// L'installateur NeoForge/Forge prend le répertoire cible comme argument
// positionnel après --installClient (pas --installDir). Le cwd est aussi
// positionné sur installDir pour que "." pointe vers le bon endroit.
async function runInstaller(javaPath, jarPath, installDir, onLog) {
  return new Promise((resolve, reject) => {
    // Argument positionnel : java -jar installer.jar --installClient <dir>
    const args = ['-jar', jarPath, '--installClient', installDir];
    const proc = spawn(javaPath || 'java', args, { cwd: installDir });
    activeProcess = proc;

    const lines = [];
    const log = (data) => {
      const s = String(data).trim();
      if (s) { lines.push(s); onLog(s); }
    };
    proc.stdout.on('data', log);
    proc.stderr.on('data', log);

    proc.on('close', code => {
      activeProcess = null;
      if (code === 0) {
        resolve();
      } else {
        const tail = lines.slice(-5).join(' | ');
        reject(new Error(`Installateur NeoForge code ${code} : ${tail}`));
      }
    });
    proc.on('error', err => { activeProcess = null; reject(err); });
  });
}

// ── Crée launcher_profiles.json si absent (requis par l'installateur NeoForge) ─
function ensureLauncherProfiles(instanceDir) {
  const profilesPath = path.join(instanceDir, 'launcher_profiles.json');
  if (!fs.existsSync(profilesPath)) {
    fs.writeFileSync(profilesPath, JSON.stringify({
      profiles: {},
      settings: {},
      version: 3,
    }, null, 2), 'utf8');
  }
}

// ── Installation automatique NeoForge ─────────────────────────────────────────
async function ensureNeoForge(instanceDir, neoforgeVersion, javaPath, onStep) {
  if (isNeoForgeInstalled(instanceDir, neoforgeVersion)) return;

  const url          = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${neoforgeVersion}/neoforge-${neoforgeVersion}-installer.jar`;
  const installerJar = path.join(instanceDir, `neoforge-${neoforgeVersion}-installer.jar`);

  fs.mkdirSync(instanceDir, { recursive: true });
  ensureLauncherProfiles(instanceDir);

  onStep({ type: 'setup', msg: `Téléchargement NeoForge ${neoforgeVersion}...`, pct: 0.02 });
  await downloadFile(url, installerJar, pct => {
    onStep({ type: 'setup', msg: `Téléchargement NeoForge... ${Math.round(pct * 100)}%`, pct: 0.02 + pct * 0.38 });
  });

  onStep({ type: 'setup', msg: 'Installation de NeoForge + Minecraft 1.21.1...', pct: 0.42 });
  await runInstaller(javaPath, installerJar, instanceDir, (log) => {
    if (log) onStep({ type: 'setup', msg: log.slice(0, 80), pct: 0.70 });
  });

  try { fs.unlinkSync(installerJar); } catch {}
  onStep({ type: 'setup', msg: 'NeoForge installé !', pct: 0.80 });
}

// ── Installation automatique Forge ────────────────────────────────────────────
async function ensureForge(instanceDir, mcVersion, forgeVersion, javaPath, onStep) {
  if (isForgeInstalled(instanceDir, mcVersion, forgeVersion)) return;

  const url          = `https://maven.minecraftforge.net/net/minecraftforge/forge/${mcVersion}-${forgeVersion}/forge-${mcVersion}-${forgeVersion}-installer.jar`;
  const installerJar = path.join(instanceDir, `forge-${mcVersion}-${forgeVersion}-installer.jar`);

  fs.mkdirSync(instanceDir, { recursive: true });
  ensureLauncherProfiles(instanceDir);

  onStep({ type: 'setup', msg: `Téléchargement Forge ${forgeVersion}...`, pct: 0.02 });
  await downloadFile(url, installerJar, pct => {
    onStep({ type: 'setup', msg: `Téléchargement Forge... ${Math.round(pct * 100)}%`, pct: 0.02 + pct * 0.38 });
  });

  onStep({ type: 'setup', msg: 'Installation de Forge + Minecraft...', pct: 0.42 });
  await runInstaller(javaPath, installerJar, instanceDir, (log) => {
    if (log) onStep({ type: 'setup', msg: log.slice(0, 80), pct: 0.70 });
  });

  try { fs.unlinkSync(installerJar); } catch {}
  onStep({ type: 'setup', msg: 'Forge installé !', pct: 0.80 });
}

// ── JVM args obligatoires du JSON de version custom (NeoForge/Forge modernes) ─
// minecraft-launcher-core ne lit que arguments.game du JSON de version, jamais
// arguments.jvm : sans ça, le bootstrap ModLauncher plante (module java.base
// non ouvert à cpw.mods.securejarhandler).
function getModernJvmArgs(instanceDir, customVersion) {
  const versionJsonPath = path.join(instanceDir, 'versions', customVersion, `${customVersion}.json`);
  if (!fs.existsSync(versionJsonPath)) return [];

  const versionJson = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
  const jvmArgs = versionJson.arguments?.jvm;
  if (!Array.isArray(jvmArgs)) return [];

  const separator = process.platform === 'win32' ? ';' : ':';
  const placeholders = {
    '${version_name}':        customVersion,
    '${library_directory}':   path.join(instanceDir, 'libraries'),
    '${classpath_separator}': separator,
  };
  const resolve = (str) => Object.entries(placeholders).reduce(
    (s, [key, val]) => s.split(key).join(val), str
  );

  return jvmArgs.filter(a => typeof a === 'string').map(resolve);
}

// ── Sélection automatique du meilleur Java 21+ ────────────────────────────────
function pickBestJava21() {
  const all = detectJava();
  const candidates = all
    .map(j => {
      const v     = j.version;
      const major = parseInt(v.startsWith('1.') ? v.split('.')[1] : v.split('.')[0]);
      return { path: j.path, major };
    })
    .filter(j => j.major >= 21)
    .sort((a, b) => a.major - b.major);
  return candidates.length ? candidates[0].path : null;
}

// ── Lancement du jeu ──────────────────────────────────────────────────────────
async function launchGame(opts, onProgress, onData, onClose) {
  const { session, instanceDir, version, loader, ramMb, javaPath, jvmArgs } = opts;
  let java = javaPath || 'java';

  // Auto-détection Java 21+ si aucun chemin explicite configuré
  if (java === 'java') {
    const detected = pickBestJava21();
    if (detected) {
      java = detected;
    } else {
      // Vérifie si 'java' du PATH est >= 21
      try {
        const raw   = execSync('"java" -version 2>&1', { timeout: 4000, stdio: 'pipe' }).toString();
        const match = raw.match(/version "([^"]+)"/);
        if (match) {
          const v     = match[1];
          const major = parseInt(v.startsWith('1.') ? v.split('.')[1] : v.split('.')[0]);
          if (major < 21) {
            return { success: false, error: `Java 21 requis pour NeoForge (Java ${major} détecté). Installe Java 21 depuis adoptium.net puis relance.` };
          }
        } else {
          return { success: false, error: 'Java introuvable. Installe Java 21 depuis adoptium.net et relance le launcher.' };
        }
      } catch {
        return { success: false, error: 'Java introuvable. Installe Java 21 depuis adoptium.net et relance le launcher.' };
      }
    }
  }

  // ── Détection et construction de la version custom ──
  let customVersion = null;
  let needsSetup    = false;

  if (loader) {
    const neoforgeMatch = loader.match(/neoforge\s+([\d.]+)/i);
    const forgeMatch    = loader.match(/^forge\s+([\d.]+)/i);

    if (neoforgeMatch) {
      const neoVer  = neoforgeMatch[1];
      customVersion = `neoforge-${neoVer}`;
      needsSetup    = !isNeoForgeInstalled(instanceDir, neoVer);

      if (needsSetup) {
        try {
          await ensureNeoForge(instanceDir, neoVer, java, onProgress);
        } catch (e) {
          return { success: false, error: `Installation NeoForge échouée : ${e.message}` };
        }
      }
    } else if (forgeMatch) {
      const forgeVer = forgeMatch[1];
      customVersion  = `${version}-forge-${forgeVer}`;
      needsSetup     = !isForgeInstalled(instanceDir, version, forgeVer);

      if (needsSetup) {
        try {
          await ensureForge(instanceDir, version, forgeVer, java, onProgress);
        } catch (e) {
          return { success: false, error: `Installation Forge échouée : ${e.message}` };
        }
      }
    }
  }

  // ── Configuration du launcher ──
  onProgress({ type: 'setup', msg: 'Préparation du lancement...', pct: 0.85 });

  const launcher = new Client();
  activeProcess  = launcher;

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

  if (java !== 'java') config.javaPath = java;

  const modernArgs = customVersion ? getModernJvmArgs(instanceDir, customVersion) : [];
  const userArgs    = jvmArgs ? jvmArgs.split(/\s+/).filter(Boolean) : [];
  const customArgs  = modernArgs.concat(userArgs);
  if (customArgs.length) config.customArgs = customArgs;

  launcher.on('progress', (e) => onProgress(e));
  launcher.on('data',     (e) => onData(String(e)));
  launcher.on('close', (code) => { activeProcess = null; onClose(code); });

  try {
    await launcher.launch(config);
    return { success: true };
  } catch (e) {
    activeProcess = null;
    return { success: false, error: e.message };
  }
}

// ── Arrêt forcé ───────────────────────────────────────────────────────────────
function killGame() {
  if (activeProcess) {
    try { activeProcess.kill?.(); } catch {}
    activeProcess = null;
  }
}

// ── Détection Java ────────────────────────────────────────────────────────────
function detectJava() {
  const found = [];
  const seen  = new Set();

  function probe(javaExe) {
    const key = javaExe.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    try {
      const raw   = execSync(`"${javaExe}" -version 2>&1`, { timeout: 4000, stdio: 'pipe' }).toString();
      const match = raw.match(/version "([^"]+)"/);
      if (match) {
        const v     = match[1];
        const major = v.startsWith('1.') ? v.split('.')[1] : v.split('.')[0];
        const name  = javaExe === 'java' ? 'système (PATH)' : path.basename(path.dirname(path.dirname(javaExe)));
        found.push({ path: javaExe, version: v, label: `Java ${major} — ${name} (${v})` });
      }
    } catch {}
  }

  probe('java');

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
        probe(path.join(base, entry, 'bin', 'java.exe'));
      }
    } catch {}
  }

  return found;
}

module.exports = { launchGame, killGame, detectJava };
