const { ipcRenderer } = typeof require !== 'undefined' ? require('electron') : { ipcRenderer: null };
const fs   = typeof require !== 'undefined' ? require('fs')   : null;
const path = typeof require !== 'undefined' ? require('path') : null;

// ipcRenderer.invoke disponible uniquement dans Electron
const ipc = ipcRenderer ? {
  autoLogin:         () => ipcRenderer.invoke('auth:autoLogin'),
  login:             () => ipcRenderer.invoke('auth:login'),
  logout:            () => ipcRenderer.invoke('auth:logout'),
  checkUpdate:       (url) => ipcRenderer.invoke('update:check', { url }),
  startUpdate:       (instanceDir, files) => ipcRenderer.invoke('update:start', { instanceDir, files }),
  onProgress:        (cb) => ipcRenderer.on('update:progress', (_, data) => cb(data)),
  checkAppUpdate:    () => ipcRenderer.invoke('app-update:check'),
  downloadAppUpdate: () => ipcRenderer.invoke('app-update:download'),
  installAppUpdate:  () => ipcRenderer.send('app-update:install'),
  onAppUpdateStatus: (cb) => ipcRenderer.on('app-update:status', (_, data) => cb(data)),
  openPath:          (p) => ipcRenderer.invoke('shell:openPath', p),
  openExternal:      (url) => ipcRenderer.invoke('shell:openExternal', url),
  openFolderDialog:  () => ipcRenderer.invoke('dialog:openFolder'),
  pickMods:          () => ipcRenderer.invoke('admin:pickMods'),
  scanMods:          (dir) => ipcRenderer.invoke('mods:scan', dir),
  addMods:           (dir, mode) => ipcRenderer.invoke('mods:add', dir, mode),
  toggleMod:         (opts) => ipcRenderer.invoke('mods:toggle', opts),
  getInstanceDir:    () => ipcRenderer.invoke('app:getInstanceDir'),
  getAppVersion:     () => ipcRenderer.invoke('app:getVersion'),
  // Jeu
  launch:            (opts) => ipcRenderer.invoke('game:launch', opts),
  killGame:          () => ipcRenderer.send('game:kill'),
  onGameProgress:    (cb) => ipcRenderer.on('game:progress', (_, d) => cb(d)),
  onGameData:        (cb) => ipcRenderer.on('game:data',     (_, d) => cb(d)),
  onGameClose:       (cb) => ipcRenderer.on('game:close',    (_, code) => cb(code)),
  onGameLaunched:    (cb) => ipcRenderer.on('game:launched', (_, data) => cb(data)),
  onPlaytime:        (cb) => ipcRenderer.on('game:playtime', (_, data) => cb(data)),
  // Java / RAM
  detectJava:        () => ipcRenderer.invoke('java:detect'),
  getRamStats:       () => ipcRenderer.invoke('ram:stats'),
  // Discord RPC
  discordPlay:       (opts) => ipcRenderer.invoke('discord:play', opts),
  discordStop:       ()     => ipcRenderer.invoke('discord:stop'),
  // Serveur
  pingServer:        (opts) => ipcRenderer.invoke('server:ping',    opts),
  dbQuery:           (opts) => ipcRenderer.invoke('server:db',      opts),
  dbStats:           ()     => ipcRenderer.invoke('server:dbStats'),
  // Crash
  getCrashReport:      (dir)            => ipcRenderer.invoke('crash:getReport', dir),
  // Admin sync GitHub
  pushDistribution:    (content, url, token) => ipcRenderer.invoke('admin:pushDistribution', { content, manifestUrl: url, token }),
} : null;

// ── Titlebar ──
document.getElementById('btn-minimize')?.addEventListener('click', () => ipcRenderer?.send('minimize-window'));
document.getElementById('btn-maximize')?.addEventListener('click', () => ipcRenderer?.send('maximize-window'));
document.getElementById('btn-close')?.addEventListener('click',    () => ipcRenderer?.send('close-window'));

// ── Chargement de l'instance ──
let instanceData = null;
let localInstanceVersion = localStorage.getItem('localInstanceVersion') || '1';
// Chemin réel résolu via main process (AppData, toujours accessible sans admin)
let realInstanceDir = null;

// ── Distribution Nebula ───────────────────────────────────────────────────────
let distributionData    = null;
let distributionModules = [];
const OPT_MODS_KEY = 'terranova_optional_mods';

function getOptionalModState(modId) {
  const saved = JSON.parse(localStorage.getItem(OPT_MODS_KEY) || '{}');
  return saved[modId] !== false;
}
function setOptionalModState(modId, enabled) {
  const saved = JSON.parse(localStorage.getItem(OPT_MODS_KEY) || '{}');
  saved[modId] = enabled;
  localStorage.setItem(OPT_MODS_KEY, JSON.stringify(saved));
}
function toggleOptionalMod(modId, enabled) {
  setOptionalModState(modId, enabled);
  reRenderModsPanel();
}
function updateModCounts(enabled, total) {
  const modsCountEl = document.getElementById('mods-count');
  const statusEl    = document.getElementById('status-mods');
  const enabledEl   = document.getElementById('mods-enabled-count');
  if (modsCountEl) modsCountEl.textContent = total;
  if (statusEl)    statusEl.textContent    = `${enabled} / ${total}`;
  if (enabledEl)   enabledEl.textContent   = `${enabled} / ${total} mods actifs`;
}
function getDistributionFiles() {
  if (!distributionModules.length) return instanceData?.admin?.files || [];
  const files = [];
  for (const m of distributionModules) {
    const isRequired = m.required !== false;
    const isEnabled  = isRequired || getOptionalModState(m.id);
    if (!isEnabled || !m.artifact) continue;
    files.push({
      path:   m.artifact.path,
      url:    m.artifact.url,
      sha256: m.artifact.sha256 || m.artifact.md5 || 'placeholder',
      size:   m.artifact.size || 0,
    });
    for (const sub of m.subModules || []) {
      if (!sub.artifact) continue;
      files.push({ path: sub.artifact.path, url: sub.artifact.url, sha256: sub.artifact.sha256 || sub.artifact.md5 || 'placeholder', size: sub.artifact.size || 0 });
    }
  }
  return files;
}
function reRenderModsPanel() {
  const localMods = (instanceData?.instance?.mods || []).filter(m =>
    !distributionModules.some(dm => dm.artifact?.path === 'mods/' + m.filename)
  );
  renderMods(localMods);
}

function loadInstance() {
  if (fs) {
    try {
      const raw = fs.readFileSync(path.join(__dirname, 'instance.json'), 'utf8');
      instanceData = JSON.parse(raw);
      // À la première utilisation (localStorage vide), initialise depuis le distribution.json
      // bundlé plutôt que de partir à "1" — évite le faux-positif "mise à jour disponible"
      if (!localStorage.getItem('localInstanceVersion')) {
        try {
          const dist = JSON.parse(fs.readFileSync(path.join(__dirname, 'distribution.json'), 'utf8'));
          const bundledVer = dist?.servers?.[0]?.instanceVersion || dist?.admin?.instance_version;
          if (bundledVer) {
            localInstanceVersion = bundledVer;
            localStorage.setItem('localInstanceVersion', bundledVer);
          }
        } catch {}
      }
      applyInstance();
      checkAdminUpdate();
      return;
    } catch (e) {}
  }
  // Fallback navigateur : fetch
  fetch('instance.json')
    .then(r => r.json())
    .then(data => { instanceData = data; applyInstance(); checkAdminUpdate(); })
    .catch(() => { instanceData = getDefaultInstance(); applyInstance(); });
}

function getDefaultInstance() {
  return {
    instance: { name: 'TerraNova', version: '1.20.4', loader: 'Forge 47.2.0', java: '17', description: '', mods_count: 0, resource_packs: 0, shaders: '-', ram_mb: 4096, path: 'C:\\TerraNova\\instances\\terranova', last_launch: '-', playtime: '-', mods: [] },
    launcher: { version: '1.2.0', latest_version: '1.2.0' },
    admin: { instance_version: '1', changelog: '', force_update: false }
  };
}

function applyInstance() {
  const i = instanceData.instance;
  document.getElementById('banner-instance-name').textContent = i.name.toUpperCase();
  document.getElementById('inst-name').textContent   = i.name;
  document.getElementById('inst-version').textContent = i.version;
  document.getElementById('inst-loader').textContent  = i.loader;
  document.getElementById('inst-java').textContent    = i.java;
  document.getElementById('inst-desc').textContent    = i.description;
  document.getElementById('info-nom').textContent     = i.name;
  document.getElementById('info-version').textContent = i.version;
  document.getElementById('info-loader').textContent  = i.loader;
  document.getElementById('info-java').textContent    = i.java;
  document.getElementById('info-last').textContent    = i.last_launch;
  document.getElementById('info-time').textContent    = i.playtime;
  document.getElementById('info-path').textContent    = i.path;
  document.getElementById('status-ram').textContent   = i.ram_mb;
  document.getElementById('mods-count').textContent   = i.mods.length;

  // RAM slider
  const ramSlider = document.getElementById('ram-slider');
  if (ramSlider) { ramSlider.value = i.ram_mb; updateRam(i.ram_mb); }

  // Mods
  reRenderModsPanel();

  // Changelog
  const admin = instanceData.admin;
  if (admin) {
    const badge  = document.getElementById('changelog-version');
    const text   = document.getElementById('changelog-text');
    const local  = document.getElementById('changelog-local-ver');
    const remote = document.getElementById('changelog-remote-ver');
    const ver    = admin.instance_version || '?';
    const lver   = admin.local_version    || localInstanceVersion || '?';
    if (badge)  badge.textContent  = `v${ver}`;
    if (text)   text.textContent   = admin.changelog || 'Aucun changelog disponible.';
    if (local)  local.textContent  = `v${lver}`;
    if (remote) remote.textContent = `v${ver}`;
  }
}

function renderMods(localMods) {
  const icons = ['🌿','⚡','🗺','🏗','🎒','🔮','🚀','🍖','🦁','⚔','⚙','💎'];
  let html = '';
  let totalCount = 0, enabledCount = 0;

  // ── Section distribution (Nebula) ──
  if (distributionModules.length > 0) {
    const distHtml = distributionModules.map((m, i) => {
      const isRequired = m.required !== false;
      const isEnabled  = isRequired || getOptionalModState(m.id);
      if (isEnabled) enabledCount++;
      totalCount++;
      if (isRequired) {
        return `
          <div class="mod-item active">
            <div class="mod-icon">${icons[i % icons.length]}</div>
            <div class="mod-info">
              <span class="mod-name">${m.name}</span>
              <span class="mod-version">${m.type || 'ForgeMod'}</span>
            </div>
            <span class="mod-badge required">Requis</span>
          </div>`;
      }
      return `
        <div class="mod-item ${isEnabled ? 'active' : ''}">
          <div class="mod-icon">${icons[i % icons.length]}</div>
          <div class="mod-info">
            <span class="mod-name">${m.name}</span>
            <span class="mod-version">${m.type || 'ForgeMod'}</span>
          </div>
          <label class="toggle">
            <input type="checkbox" ${isEnabled ? 'checked' : ''} onchange="toggleOptionalMod('${m.id}', this.checked)">
            <span class="toggle-slider"></span>
          </label>
        </div>`;
    }).join('');
    html += `<div class="mods-section">
      <div class="mods-section-header"><span class="mods-section-title">MODS SERVEUR</span><span class="mods-section-count">${distributionModules.length} modules</span></div>
      ${distHtml}
    </div>`;
  }

  // ── Section mods locaux ──
  if (localMods && localMods.length > 0) {
    const localHtml = localMods.map((m, i) => {
      if (m.enabled) enabledCount++;
      totalCount++;
      const idx = (distributionModules.length + i) % icons.length;
      const modIdx = instanceData.instance.mods.indexOf(m);
      return `
        <div class="mod-item ${m.enabled ? 'active' : ''}">
          <div class="mod-icon">${icons[idx]}</div>
          <div class="mod-info">
            <span class="mod-name">${m.name}</span>
            <span class="mod-version">Mod local</span>
          </div>
          <label class="toggle">
            <input type="checkbox" ${m.enabled ? 'checked' : ''} onchange="toggleMod(${modIdx}, this.checked)">
            <span class="toggle-slider"></span>
          </label>
        </div>`;
    }).join('');
    html += `<div class="mods-section">
      <div class="mods-section-header"><span class="mods-section-title">MODS LOCAUX</span><span class="mods-section-count">${localMods.length} mods</span></div>
      ${localHtml}
    </div>`;
  }

  if (!html) {
    html = '<div class="placeholder-tab"><span>📦</span><p>Aucun mod installé.<br>Utilise les boutons <strong>+ Fichiers JAR</strong> ou <strong>+ Dossier</strong> pour en ajouter.</p></div>';
  }

  const el  = document.getElementById('mods-list');
  const el2 = document.getElementById('mods-list-global');
  if (el)  el.innerHTML  = html;
  if (el2) el2.innerHTML = html;
  updateModCounts(enabledCount, totalCount);
}

async function toggleMod(index, enabled) {
  const mod = instanceData.instance.mods[index];
  if (!mod) return;

  if (!mod.filename) {
    showToast('Ce mod ne peut pas être activé/désactivé (pas de fichier associé)');
    return;
  }

  if (ipc?.toggleMod && realInstanceDir) {
    const res = await ipc.toggleMod({ instanceDir: realInstanceDir, filename: mod.filename, relPath: mod.relPath, enable: enabled });
    if (!res.success) { showToast('Erreur : ' + (res.error || 'impossible de déplacer le fichier')); return; }
  }

  mod.enabled = enabled;
  const total  = instanceData.instance.mods.length;
  const active = instanceData.instance.mods.filter(m => m.enabled).length;
  const statusEl  = document.getElementById('status-mods');
  const enabledEl = document.getElementById('mods-enabled-count');
  if (statusEl)  statusEl.textContent  = `${active} / ${total}`;
  if (enabledEl) enabledEl.textContent = `${active} / ${total} mods actifs`;
}

// ── Applique un manifest distant (Nebula ou ancien format) ──────────────────
function applyRemoteManifest(remote) {
  if (remote?.servers) {
    const server = remote.servers.find(s => s.id === 'terranova') || remote.servers[0];
    if (!server) return;

    distributionData    = remote;
    distributionModules = server.modules || [];
    reRenderModsPanel();

    const badge   = document.getElementById('changelog-version');
    const text    = document.getElementById('changelog-text');
    const remote2 = document.getElementById('changelog-remote-ver');
    if (badge)   badge.textContent   = `v${server.instanceVersion || '?'}`;
    if (text)    text.textContent    = server.changelog || '';
    if (remote2) remote2.textContent = `v${server.instanceVersion || '?'}`;

    const remoteVer = parseInt(server.instanceVersion || '0');
    const localVer  = parseInt(localInstanceVersion || '1');
    if (remoteVer > localVer) {
      instanceData.admin.instance_version = server.instanceVersion;
      instanceData.admin.changelog        = server.changelog || '';
      instanceData.admin.force_update     = server.forceUpdate || false;
      showUpdateBanner(server.changelog, server.forceUpdate || false);
    }
  } else if (remote?.admin) {
    const remoteVer = parseInt(remote.admin.instance_version || '0');
    const localVer  = parseInt(localInstanceVersion || '1');

    if (remoteVer > localVer) {
      instanceData.admin.instance_version = remote.admin.instance_version;
      instanceData.admin.changelog        = remote.admin.changelog || '';
      instanceData.admin.files            = remote.admin.files     || [];
      instanceData.admin.force_update     = remote.admin.force_update || false;

      const badge   = document.getElementById('changelog-version');
      const text    = document.getElementById('changelog-text');
      const remote2 = document.getElementById('changelog-remote-ver');
      if (badge)   badge.textContent   = `v${remote.admin.instance_version}`;
      if (text)    text.textContent    = remote.admin.changelog || '';
      if (remote2) remote2.textContent = `v${remote.admin.instance_version}`;

      showUpdateBanner(remote.admin.changelog, remote.admin.force_update);
    }
  }
}

// ── Vérification MAJ admin (locale d'abord, puis distante) ──────────────────
async function checkAdminUpdate() {
  if (!instanceData) return;

  const manifestUrl = instanceData.admin?.manifest_url;
  if (!ipc || !manifestUrl) {
    const localVer = parseInt(instanceData.admin?.instance_version || '1');
    if (localVer > parseInt(localInstanceVersion)) {
      showUpdateBanner(instanceData.admin.changelog, instanceData.admin.force_update);
    }
    return;
  }

  try {
    const result = await ipc.checkUpdate(manifestUrl);
    if (!result.success) return;
    applyRemoteManifest(result.manifest);
  } catch {
    // Silencieux — pas de réseau ou serveur indisponible
  }
}

function showUpdateBanner(changelog, force) {
  const banner = document.getElementById('update-banner');
  document.getElementById('update-changelog').textContent = changelog;
  banner.style.display = 'flex';
  document.body.classList.add('has-update');
  if (force) doUpdate();
}

function dismissUpdate() {
  document.getElementById('update-banner').style.display = 'none';
  document.body.classList.remove('has-update');
}

function doUpdate() {
  dismissUpdate();
  const overlay = document.getElementById('update-overlay');
  const cl = document.getElementById('update-changelog-full');
  cl.textContent = instanceData.admin.changelog;
  overlay.style.display = 'flex';
}

async function startUpdate() {
  document.getElementById('update-actions').style.display    = 'none';
  document.getElementById('update-progress-wrap').style.display = 'block';
  document.getElementById('update-file-status').style.display   = 'block';

  const bar       = document.getElementById('update-bar');
  const pct       = document.getElementById('update-pct');
  const fileLabel = document.getElementById('update-file-label');
  const fileCount = document.getElementById('update-file-count');

  function setProgress(p, label, count) {
    bar.style.width     = Math.round(p * 100) + '%';
    pct.textContent     = Math.round(p * 100) + '%';
    fileLabel.textContent = label;
    if (count !== undefined) fileCount.textContent = count;
  }

  // Mode Electron : vrai téléchargement via UpdateManager
  if (ipc) {
    ipc.onProgress((data) => {
      const label = data.phase === 'check'
        ? `Vérification : ${data.file.split('/').pop()}`
        : `Téléchargement : ${data.file.split('/').pop()}`;
      const count = `${data.index + 1} / ${data.total} fichiers`;
      setProgress(data.globalPct, label, count);
    });

    const files       = getDistributionFiles();
    const instanceDir = realInstanceDir || instanceData.instance.path;
    setProgress(0, 'Démarrage...', `0 / ${files.length} fichiers`);

    const result = await ipc.startUpdate(instanceDir, files);

    if (result.success) {
      setProgress(1, 'Mise à jour terminée !', `${files.length} / ${files.length} fichiers`);
      setTimeout(finishUpdate, 800);
    } else {
      fileLabel.textContent = `Erreur : ${result.error}`;
      setTimeout(() => {
        document.getElementById('update-actions').style.display    = 'flex';
        document.getElementById('update-progress-wrap').style.display = 'none';
        document.getElementById('update-file-status').style.display   = 'none';
      }, 2000);
    }
    return;
  }

  // Mode preview navigateur : simulation
  const files = instanceData.admin.files || [];
  let   step  = 0;
  const iv = setInterval(() => {
    if (step >= files.length) {
      clearInterval(iv);
      setProgress(1, 'Mise à jour terminée !', `${files.length} / ${files.length} fichiers`);
      setTimeout(finishUpdate, 800);
      return;
    }
    const name = files[step] ? files[step].path.split('/').pop() : 'fichier';
    setProgress((step + 0.5) / files.length, `Téléchargement : ${name}`, `${step + 1} / ${files.length} fichiers`);
    step++;
  }, 700);
}

function finishUpdate() {
  localInstanceVersion = instanceData.admin.instance_version;
  localStorage.setItem('localInstanceVersion', localInstanceVersion);
  dismissUpdate();
  document.getElementById('update-overlay').style.display       = 'none';
  document.getElementById('update-actions').style.display        = 'flex';
  document.getElementById('update-progress-wrap').style.display  = 'none';
  document.getElementById('update-file-status').style.display    = 'none';
  document.getElementById('update-bar').style.width              = '0%';
}

// ── Navigation principale ──
function showTab(name) {
  if (name === 'settings')   populateJavaSelect();
  if (name === 'saves')      loadSaves();
  if (name === 'options')    loadOptions();
  if (name === 'community')  loadCommunity();
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  const tab = document.getElementById('tab-' + name);
  if (tab) tab.classList.add('active');
  const btn = document.querySelector(`.nav-item[data-tab="${name}"]`);
  if (btn) btn.classList.add('active');
  // Panneau droit visible seulement sur instance
  const rp = document.getElementById('right-panel');
  if (rp) rp.style.display = (name === 'instance') ? 'flex' : 'none';
}

// ── Sauvegardes ───────────────────────────────────────────────────────────────
function loadSaves() {
  const el = document.getElementById('saves-list');
  if (!el || !fs || !path) return;
  const base = realInstanceDir || instanceData?.instance?.path || '';
  const savesDir = path.join(base, 'saves');
  try {
    const entries = fs.readdirSync(savesDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => ({ name: d.name, mtime: fs.statSync(path.join(savesDir, d.name)).mtime }))
      .sort((a, b) => b.mtime - a.mtime);
    if (!entries.length) {
      el.innerHTML = '<div class="placeholder-tab"><span>💾</span><p>Aucune sauvegarde trouvée.<br>Lance le jeu une première fois.</p></div>';
      return;
    }
    el.innerHTML = entries.map(f => {
      const d = f.mtime.toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
      const safeName = f.name.replace(/'/g, "\\'");
      return `<div class="save-item" onclick="openSaveFolder('${safeName}')">
        <div class="save-icon">🌍</div>
        <div class="save-info"><div class="save-name">${f.name}</div><div class="save-date">${d}</div></div>
        <button class="mc-btn-inline green" onclick="event.stopPropagation();openSaveFolder('${safeName}')">📁 Ouvrir</button>
      </div>`;
    }).join('');
  } catch {
    el.innerHTML = '<div class="placeholder-tab"><span>💾</span><p>Dossier saves introuvable.<br>Lance le jeu une première fois.</p></div>';
  }
}

function openSaveFolder(name) {
  const base = realInstanceDir || instanceData?.instance?.path || '';
  if (ipc) ipc.openPath(path.join(base, 'saves', name));
}

// ── Options Minecraft (options.txt) ──────────────────────────────────────────
const OPT_DEFS = [
  { key:'renderDistance',   label:'Distance de rendu',    type:'range',  min:2,  max:32, unit:' chunks' },
  { key:'maxFps',           label:'FPS maximum',          type:'range',  min:10, max:260, unit:' fps', display: v => v >= 260 ? 'Illimité' : v + ' fps' },
  { key:'fullscreen',       label:'Plein écran',          type:'bool' },
  { key:'guiScale',         label:'Taille interface',     type:'select', opts:{ 0:'Auto', 1:'Petit', 2:'Normal', 3:'Grand', 4:'Très grand' } },
  { key:'particles',        label:'Particules',           type:'select', opts:{ 0:'Toutes', 1:'Réduites', 2:'Minimales' } },
  { key:'fov',              label:'Champ de vision (FOV)',type:'range',  min:30, max:110, unit:'°' },
  { key:'gamma',            label:'Luminosité',           type:'range',  min:0,  max:100, unit:'%', scale:100 },
  { key:'masterVolume',     label:'Volume général',       type:'range',  min:0,  max:100, unit:'%', scale:100 },
];

let _optParsed = {};

function loadOptions() {
  const el = document.getElementById('options-content');
  if (!el || !fs || !path) return;
  const base = realInstanceDir || instanceData?.instance?.path || '';
  const optPath = path.join(base, 'options.txt');
  try {
    const raw = fs.readFileSync(optPath, 'utf8');
    _optParsed = {};
    raw.split('\n').forEach(line => {
      const i = line.indexOf(':');
      if (i > 0) _optParsed[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    });
  } catch {
    el.innerHTML = '<div class="placeholder-tab"><span>🔧</span><p>options.txt introuvable.<br>Lance le jeu une première fois.</p></div>';
    return;
  }
  el.innerHTML = `<div class="opt-section"><h3>Paramètres du jeu</h3>${OPT_DEFS.map(def => {
    const raw = _optParsed[def.key];
    const val = raw !== undefined ? raw : '';
    if (def.type === 'range') {
      const num = parseFloat(val) * (def.scale || 1);
      const disp = def.display ? def.display(Math.round(num)) : Math.round(num) + (def.unit || '');
      return `<div class="opt-row">
        <span class="opt-label">${def.label}</span>
        <div style="display:flex;align-items:center;gap:10px">
          <input type="range" min="${def.min}" max="${def.max}" value="${Math.min(def.max, Math.max(def.min, Math.round(num)))}"
            oninput="this.nextElementSibling.textContent=${def.display ? '(this.value>=260?\'Illimité\':this.value+\' fps\')' : '`${this.value}${def.unit||\'\'}`'}"
            data-opt="${def.key}" data-scale="${def.scale || 1}">
          <span class="opt-value">${disp}</span>
        </div>
      </div>`;
    }
    if (def.type === 'bool') {
      const checked = val === 'true' ? 'checked' : '';
      return `<div class="opt-row"><span class="opt-label">${def.label}</span><input type="checkbox" ${checked} data-opt="${def.key}"></div>`;
    }
    if (def.type === 'select') {
      const opts = Object.entries(def.opts).map(([k, v]) => `<option value="${k}" ${val === k ? 'selected' : ''}>${v}</option>`).join('');
      return `<div class="opt-row"><span class="opt-label">${def.label}</span><select data-opt="${def.key}">${opts}</select></div>`;
    }
    return '';
  }).join('')}</div>`;
}

function saveGameOptions() {
  const base = realInstanceDir || instanceData?.instance?.path || '';
  const optPath = path.join(base, 'options.txt');
  document.querySelectorAll('[data-opt]').forEach(el => {
    const key = el.dataset.opt;
    let val;
    if (el.type === 'checkbox') val = el.checked ? 'true' : 'false';
    else if (el.type === 'range') val = (parseFloat(el.value) / (parseFloat(el.dataset.scale) || 1)).toFixed(el.dataset.scale > 1 ? 6 : 0);
    else val = el.value;
    _optParsed[key] = val;
  });
  try {
    const lines = fs.readFileSync(optPath, 'utf8').split('\n');
    const updated = lines.map(line => {
      const i = line.indexOf(':');
      if (i > 0) {
        const k = line.slice(0, i).trim();
        if (_optParsed[k] !== undefined) return k + ':' + _optParsed[k];
      }
      return line;
    });
    fs.writeFileSync(optPath, updated.join('\n'), 'utf8');
    showToast('Options sauvegardées');
  } catch { showToast('Erreur : options.txt inaccessible'); }
}

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

// ── Sous-tabs instance ──
function showItab(name) {
  document.querySelectorAll('.itab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.itab').forEach(b => b.classList.remove('active'));
  const el = document.getElementById('itab-' + name);
  if (el) el.classList.add('active');
  const btn = document.querySelector(`.itab[data-itab="${name}"]`);
  if (btn) btn.classList.add('active');
}

document.querySelectorAll('.itab').forEach(btn => {
  btn.addEventListener('click', () => showItab(btn.dataset.itab));
});

// ── RAM ──
function updateRam(val) {
  const gb = (val / 1024).toFixed(1);
  document.getElementById('ram-val').textContent = gb + ' GB';
  document.getElementById('status-ram').textContent = val;
  localStorage.setItem('s_ram', val);
}

// ── Sanitisation JVM args (renderer-side, avant envoi au main process) ────────
const JVM_BLOCKED = ['-javaagent:', '-agentlib:jdwp', '-agentpath:', '-Djava.security.manager='];
function sanitizeJvmArgs(raw) {
  if (!raw) return [];
  return raw.split(/\s+/).filter(Boolean).filter(arg => {
    if (/[;&|`$<>]/.test(arg)) return false;
    if (JVM_BLOCKED.some(b => arg.toLowerCase().startsWith(b.toLowerCase()))) return false;
    return true;
  });
}

// ── Toast ──
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('visible');
  setTimeout(() => t.classList.remove('visible'), 2500);
}

// ── Ouvrir dossier ──
function openFolder() {
  const p = realInstanceDir || instanceData?.instance?.path || 'C:\\TerraNova\\instances\\terranova';
  if (ipc) ipc.openPath(p);
  else showToast('📁 ' + p);
}

function openSavesFolder() {
  const base = realInstanceDir || instanceData?.instance?.path || 'C:\\TerraNova\\instances\\terranova';
  const p = base + '\\saves';
  if (ipc) ipc.openPath(p);
  else showToast('📁 ' + p);
}

// ── Lien externe ──
function openExternalLink(url) {
  if (ipc) ipc.openExternal(url);
  else window.open(url, '_blank');
}

// ── Parcourir (dialog) ──
async function browseFolder() {
  if (ipc) {
    const r = await ipc.openFolderDialog();
    if (!r.canceled && r.path) {
      const el = document.getElementById('instances-path-input');
      if (el) el.value = r.path;
      localStorage.setItem('s_instances_path', r.path);
      showToast('Dossier sélectionné : ' + r.path);
    }
  } else {
    showToast('Sélection de dossier disponible dans l\'app Electron');
  }
}

// ── Ajouter mod ──
async function addMod(mode = 'files') {
  if (!ipc?.addMods || !realInstanceDir) {
    showToast('Disponible uniquement dans l\'app Electron');
    return;
  }
  const res = await ipc.addMods(realInstanceDir, mode);
  if (res.canceled || !res.success) return;
  showToast(`${res.added.length} mod(s) ajouté(s)`);
  await loadRealMods();
}

// ── Play dropdown ──
function togglePlayMenu(e) {
  e.stopPropagation();
  const m = document.getElementById('play-menu');
  if (!m) return;
  m.style.display = m.style.display === 'none' ? 'block' : 'none';
}
function closePlayMenu() {
  const m = document.getElementById('play-menu');
  if (m) m.style.display = 'none';
}
document.addEventListener('click', () => closePlayMenu());

// ── Menu ••• ──
function toggleMoreMenu() {
  const m = document.getElementById('more-menu');
  if (!m) return;
  m.style.display = m.style.display === 'block' ? 'none' : 'block';
}
document.addEventListener('click', (e) => {
  const m = document.getElementById('more-menu');
  if (m && !m.contains(e.target) && !e.target.closest('.more-btn')) {
    m.style.display = 'none';
  }
});

// ── Persistance paramètres ──
function saveSettings() {
  const jvm = document.getElementById('jvm-input');
  if (jvm) localStorage.setItem('s_jvm', jvm.value);
  const fullscreen = document.getElementById('fullscreen-check');
  if (fullscreen) localStorage.setItem('s_fullscreen', fullscreen.checked ? '1' : '0');
  const closeOnLaunch = document.getElementById('close-on-launch-check');
  if (closeOnLaunch) localStorage.setItem('s_close_on_launch', closeOnLaunch.checked ? '1' : '0');
  const autoUpdates = document.getElementById('auto-updates-check');
  if (autoUpdates) localStorage.setItem('s_auto_updates', autoUpdates.checked ? '1' : '0');
  showToast('Paramètres sauvegardés');
}

function saveNotes() {
  const el = document.getElementById('notes-area');
  if (el) localStorage.setItem('s_notes', el.value);
}

function loadSettings() {
  const ram = localStorage.getItem('s_ram');
  if (ram) {
    const slider = document.getElementById('ram-slider');
    if (slider) { slider.value = ram; updateRam(ram); }
  }
  const jvm = localStorage.getItem('s_jvm');
  if (jvm) {
    const el = document.getElementById('jvm-input');
    if (el) el.value = jvm;
  }
  const fullscreen = localStorage.getItem('s_fullscreen');
  if (fullscreen !== null) {
    const el = document.getElementById('fullscreen-check');
    if (el) el.checked = fullscreen === '1';
  }
  const closeOnLaunch = localStorage.getItem('s_close_on_launch');
  if (closeOnLaunch !== null) {
    const el = document.getElementById('close-on-launch-check');
    if (el) el.checked = closeOnLaunch === '1';
  }
  const autoUpdates = localStorage.getItem('s_auto_updates');
  if (autoUpdates !== null) {
    const el = document.getElementById('auto-updates-check');
    if (el) el.checked = autoUpdates === '1';
  }
  const notes = localStorage.getItem('s_notes');
  if (notes !== null) {
    const el = document.getElementById('notes-area');
    if (el) el.value = notes;
  }
  const instancesPath = localStorage.getItem('s_instances_path');
  if (instancesPath) {
    const el = document.getElementById('instances-path-input');
    if (el) el.value = instancesPath;
  }
}

// ── Lancement ──
let launchInterval = null;
let gameRunning    = false;

async function launchGame() {
  if (gameRunning) return;

  const overlay = document.getElementById('launch-overlay');
  const bar     = document.getElementById('progress-bar');
  const stat    = document.getElementById('launch-status-text');
  const pct     = document.getElementById('progress-pct');
  const cancelBtn = document.getElementById('launch-cancel-btn');

  overlay.classList.add('active');
  bar.style.width = '0%'; pct.textContent = '0%';
  stat.textContent = 'Initialisation...';
  if (cancelBtn) cancelBtn.textContent = 'Annuler';

  // Mode Electron : vrai lancement
  if (ipc && currentSession) {
    const ramMb     = parseInt(localStorage.getItem('s_ram'))     || instanceData?.instance?.ram_mb || 4096;
    const jvmArgs   = localStorage.getItem('s_jvm')               || '';
    const javaPath  = localStorage.getItem('s_java_path')         || 'java';
    // Utilise le chemin AppData résolu par le main process (pas C:\TerraNova qui nécessite admin)
    const instanceDir = realInstanceDir || instanceData?.instance?.path || '';

    if (!instanceDir) {
      stat.textContent = 'Erreur : chemin de l\'instance non configuré';
      setTimeout(() => overlay.classList.remove('active'), 2500);
      return;
    }

    // ── Étapes visuelles ──
    const setStep = (step) => {
      const steps = ['setup', 'assets', 'launch'];
      steps.forEach((s, i) => {
        const el   = document.getElementById(`lstep-${s}`);
        const line = document.getElementById(`lstep-line${i + 1}`);
        const idx  = steps.indexOf(step);
        if (!el) return;
        el.classList.toggle('active', i === idx);
        el.classList.toggle('done',   i < idx);
        if (line) line.classList.toggle('done', i < idx);
      });
    };
    setStep('setup');

    // Écoute de la progression : installation NeoForge + téléchargement assets
    ipc.onGameProgress((p) => {
      if (p.type === 'setup') {
        setStep('setup');
        const v = Math.round((p.pct || 0) * 80);
        bar.style.width = v + '%';
        pct.textContent = v + '%';
        stat.textContent = p.msg || 'Installation...';
      } else if (['download', 'extract', 'assets', 'assets-copy', 'natives', 'classes', 'classes-custom'].includes(p.type)) {
        setStep('assets');
        const v = p.total > 0 ? Math.round((p.task / p.total) * 18) : 0;
        bar.style.width = (80 + v) + '%';
        pct.textContent = (80 + v) + '%';
        const labels = { extract: 'Extraction', assets: 'Vérification des assets', 'assets-copy': 'Copie des assets', natives: 'Extraction des natives', classes: 'Vérification des bibliothèques', 'classes-custom': 'Vérification des bibliothèques' };
        stat.textContent = `${labels[p.type] || 'Téléchargement'} : ${p.task} / ${p.total}`;
      }
    });

    ipc.onGameClose((code) => {
      gameRunning = false;
      overlay.classList.remove('active');
      if (cancelBtn) cancelBtn.textContent = 'Annuler';
      ipc.discordStop?.();
      saveSession(code);
      if (code !== 0 && code !== null) showCrashModal(code);
    });

    bar.style.width = '2%'; pct.textContent = '2%';
    stat.textContent = 'Vérification de NeoForge...';

    // Sanitisation des JVM args (bloque les flags dangereux)
    const safeJvmArgs = sanitizeJvmArgs(jvmArgs);

    const result = await ipc.launch({
      session:     currentSession,
      instanceDir,
      version:     instanceData.instance.version,
      loader:      instanceData.instance.loader,
      ramMb,
      javaPath,
      jvmArgs:     safeJvmArgs.join(' '),
    });

    if (!result.success) {
      gameRunning = false;
      overlay.classList.remove('active');
      stat.textContent = 'Erreur : ' + result.error;
      showToast('Erreur lancement : ' + result.error);
      return;
    }

    // Jeu lancé — la JVM démarre, peut prendre 1-3 min avant que la fenêtre apparaisse
    gameRunning = true;
    setStep('launch');
    bar.style.width = '100%'; pct.textContent = '100%';
    stat.textContent = 'Minecraft en cours de démarrage... (peut prendre 1-3 min)';

    // Discord Rich Presence
    ipc.discordPlay?.({
      version:    instanceData.instance.version,
      loader:     instanceData.instance.loader,
      modsCount:  instanceData.instance.mods.filter(m => m.enabled).length,
    });
    if (cancelBtn) cancelBtn.textContent = 'Fermer le launcher';

    // Ne minimiser qu'après réception de données du jeu (JVM active) ou après 20s max
    const closeOnLaunch = localStorage.getItem('s_close_on_launch');
    if (closeOnLaunch !== '0') {
      let minimized = false;
      const doMinimize = () => {
        if (minimized) return;
        minimized = true;
        ipcRenderer?.send('minimize-window');
      };
      ipcRenderer?.once('game:data', () => doMinimize());
      setTimeout(doMinimize, 20000);
    }
    return;
  }

  // Mode preview : simulation
  if (!ipc && !currentSession) {
    stat.textContent = 'Connexion requise pour lancer le jeu';
    setTimeout(() => overlay.classList.remove('active'), 2000);
    return;
  }

  const steps = [
    { p: 10, msg: 'Vérification des fichiers...' },
    { p: 25, msg: 'Chargement des mods...' },
    { p: 45, msg: 'Initialisation Forge...' },
    { p: 62, msg: 'Chargement des ressources...' },
    { p: 78, msg: 'Connexion au serveur...' },
    { p: 92, msg: 'Lancement du jeu...' },
    { p: 100, msg: 'Prêt !' },
  ];
  let step = 0;
  launchInterval = setInterval(() => {
    if (step >= steps.length) {
      clearInterval(launchInterval);
      setTimeout(() => overlay.classList.remove('active'), 900);
      return;
    }
    const s = steps[step];
    bar.style.width = s.p + '%'; pct.textContent = s.p + '%'; stat.textContent = s.msg;
    step++;
  }, 600);
}

function cancelLaunch() {
  if (gameRunning && ipc) {
    ipc.killGame();
    gameRunning = false;
  }
  clearInterval(launchInterval);
  document.getElementById('launch-overlay').classList.remove('active');
}

function quitApp() { ipcRenderer?.send('close-window'); }
function checkUpdate() { checkLauncherUpdate(); }

// ── Mise à jour automatique du launcher (electron-updater) ───────────────────
let appUpdateState = 'idle'; // idle | available | downloading | downloaded
let manualUpdateCheck = false;

function showAppUpdateBanner() {
  document.getElementById('app-update-banner').style.display = 'flex';
}
function dismissAppUpdate() {
  document.getElementById('app-update-banner').style.display = 'none';
}

function handleAppUpdateStatus(data) {
  const banner   = document.getElementById('app-update-banner');
  const title    = document.getElementById('app-update-title');
  const sub      = document.getElementById('app-update-sub');
  const btn      = document.getElementById('app-update-action-btn');
  const wrap     = document.getElementById('app-update-progress-wrap');
  const bar      = document.getElementById('app-update-bar');
  const pct      = document.getElementById('app-update-pct');

  switch (data.state) {
    case 'available':
      appUpdateState = 'available';
      title.textContent = 'Mise à jour du launcher disponible';
      sub.textContent   = `Version ${data.version} prête à être téléchargée.`;
      btn.textContent   = 'Télécharger';
      btn.disabled      = false;
      wrap.style.display = 'none';
      showAppUpdateBanner();
      break;

    case 'downloading':
      appUpdateState = 'downloading';
      title.textContent = 'Téléchargement de la mise à jour...';
      sub.textContent   = `${Math.round((data.transferred || 0) / 1e6)} Mo / ${Math.round((data.total || 0) / 1e6)} Mo`;
      btn.disabled       = true;
      btn.textContent    = 'Téléchargement...';
      wrap.style.display = 'block';
      bar.style.width    = Math.round(data.pct * 100) + '%';
      pct.textContent    = Math.round(data.pct * 100) + '%';
      showAppUpdateBanner();
      break;

    case 'downloaded':
      appUpdateState = 'downloaded';
      title.textContent = 'Mise à jour prête !';
      sub.textContent   = `Version ${data.version} sera installée au redémarrage.`;
      btn.textContent    = 'Redémarrer et installer';
      btn.disabled        = false;
      wrap.style.display  = 'none';
      showAppUpdateBanner();
      break;

    case 'not-available':
      appUpdateState = 'idle';
      // Feedback uniquement si l'utilisateur a demandé manuellement
      if (manualUpdateCheck) {
        showToast('Le launcher est à jour (v' + (data.version || document.title) + ')');
        manualUpdateCheck = false;
      }
      break;

    case 'error':
      appUpdateState = 'idle';
      if (manualUpdateCheck) {
        showToast('Impossible de vérifier les mises à jour : ' + (data.error || 'erreur réseau'));
        manualUpdateCheck = false;
      }
      break;

    // 'checking' : rien à faire
  }
}

function appUpdateAction() {
  if (!ipc) return;
  if (appUpdateState === 'available') {
    ipc.downloadAppUpdate();
  } else if (appUpdateState === 'downloaded') {
    ipc.installAppUpdate();
  }
}

function checkLauncherUpdate() {
  if (!ipc) { showToast('Vérification disponible uniquement en app'); return; }
  manualUpdateCheck = true;
  ipc.checkAppUpdate();
  showToast('Vérification des mises à jour...');
}

// ── Simuler une MAJ admin ──
function simulateAdminUpdate() {
  instanceData.admin.instance_version = '99';
  instanceData.admin.changelog = 'Ajout de 5 nouveaux mods, mise à jour vers Forge 47.3.0, nouveau pack BSL v9.0.';
  checkAdminUpdate();
}

// ── Session utilisateur ──
let currentUser    = null;
let currentSession = null; // session complète (avec tokens) pour le lancement

// ── Rendu du skin (approche Nebula) ──────────────────────────────────────────
// node-fetch télécharge la texture côté Node.js → pas de CORS/CSP browser.
// Conversion en base64 data URL puis dessin sur canvas.
const nodeFetch = typeof require !== 'undefined' ? require('node-fetch') : null;

async function drawSkinFace(skinUrl, canvas, onSuccess, onError) {
  if (!skinUrl || !canvas) { onError?.(); return; }
  try {
    const res    = await nodeFetch(skinUrl);
    const buf    = await res.buffer();
    const data   = `data:image/png;base64,${buf.toString('base64')}`;
    const img    = new Image();
    img.onload = () => {
      try {
        const ctx  = canvas.getContext('2d');
        const size = canvas.width;
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, 8, 8, 8, 8, 0, 0, size, size);
        if (img.naturalHeight >= 64) ctx.drawImage(img, 40, 8, 8, 8, 0, 0, size, size);
        onSuccess?.();
      } catch { onError?.(); }
    };
    img.onerror = () => onError?.();
    img.src = data;
  } catch { onError?.(); }
}

function setUser(profile, session = null) {
  currentUser    = profile;
  if (session) currentSession = session;
  const letter = profile.name.charAt(0).toUpperCase();

  // Sidebar : lettre par défaut + skin par-dessus
  const letterEl   = document.getElementById('sidebar-avatar-letter');
  const skinCanvas = document.getElementById('sidebar-avatar-skin');
  const usernameEl = document.getElementById('sidebar-username');
  if (letterEl)   letterEl.textContent = letter;
  if (usernameEl) usernameEl.textContent = profile.name;
  if (skinCanvas) {
    drawSkinFace(profile.skin, skinCanvas,
      () => { skinCanvas.classList.add('loaded'); if (letterEl) letterEl.style.display = 'none'; },
      () => { skinCanvas.classList.remove('loaded'); if (letterEl) letterEl.style.display = 'flex'; }
    );
  }

  // Page compte : lettre + skin par-dessus
  const accLetter = document.getElementById('account-avatar-letter');
  const accCanvas = document.getElementById('account-avatar-skin');
  const accName   = document.getElementById('account-username');
  const accType   = document.getElementById('account-type');
  if (accLetter) accLetter.textContent = letter;
  if (accName)   accName.textContent = profile.name;
  if (accType)   accType.textContent = `Compte ${profile.type} · UUID: ${profile.uuid}`;
  if (accCanvas) {
    drawSkinFace(profile.skin, accCanvas,
      () => { accCanvas.classList.add('loaded'); if (accLetter) accLetter.style.display = 'none'; },
      () => { accCanvas.classList.remove('loaded'); if (accLetter) accLetter.style.display = 'flex'; }
    );
  }
}

async function logout() {
  if (ipc) await ipc.logout();
  currentUser = null;
  showLoginScreen();
}

async function switchAccount() {
  if (ipc) await ipc.logout();
  currentUser = null;
  showLoginScreen();
}

function showLoginScreen() {
  const screen = document.getElementById('login-screen');
  // Reset du bouton login
  const btn = document.getElementById('ms-login-btn');
  const loading = document.getElementById('login-loading');
  if (btn) btn.disabled = false;
  if (loading) loading.classList.remove('visible');
  // Réafficher l'écran
  screen.classList.remove('hidden', 'fade-out');
  // Retour à l'onglet instance
  showTab('instance');
}

// ── Login Microsoft (vrai flow OAuth via IPC → AuthManager) ──────────────────
async function doMicrosoftLogin() {
  const btn         = document.getElementById('ms-login-btn');
  const loading     = document.getElementById('login-loading');
  const loadingText = document.getElementById('login-loading-text');

  btn.disabled = true;
  loading.classList.add('visible');

  // En mode preview navigateur : simulation
  if (!ipc) {
    const steps = [
      { delay: 600,  msg: 'Ouverture de la session Microsoft...' },
      { delay: 1500, msg: 'Vérification des identifiants...' },
      { delay: 2400, msg: 'Récupération du profil Minecraft...' },
      { delay: 3200, msg: 'Connexion à TerraNova...' },
    ];
    steps.forEach(s => setTimeout(() => { loadingText.textContent = s.msg; }, s.delay));
    setTimeout(() => {
      loadingText.textContent = 'Connecté !';
      setUser({
        name: 'NovaPlayer_',
        type: 'Premium',
        uuid: 'a4f2c1b3-d5e6...',
        skin: 'https://assets.mojang.com/SkinTemplates/steve.png',
      }, null);
      setTimeout(transitionToLauncher, 500);
    }, 3800);
    return;
  }

  // Mode Electron : vrai OAuth
  try {
    loadingText.textContent = 'Ouverture de la fenêtre Microsoft...';
    const result = await ipc.login();

    if (!result.success) {
      handleLoginError(result.error, btn, loading, loadingText);
      return;
    }

    loadingText.textContent = 'Connecté !';
    setUser({
      name: result.session.profile.name,
      type: 'Premium',
      uuid: result.session.profile.id,
      skin: result.session.profile.skin,
    }, result.session);
    setTimeout(transitionToLauncher, 500);

  } catch (e) {
    handleLoginError(e.message, btn, loading, loadingText);
  }
}

function handleLoginError(errorMsg, btn, loading, loadingText) {
  let msg = 'Erreur de connexion.';
  if (errorMsg === 'AUTH_WINDOW_CLOSED')   msg = 'Connexion annulée.';
  if (errorMsg === 'MC_NO_GAME')           msg = 'Ce compte ne possède pas Minecraft Java.';
  if (errorMsg === 'XSTS_NO_XBOX_ACCOUNT') msg = 'Aucun compte Xbox associé.';
  if (errorMsg === 'XSTS_CHILD_ACCOUNT')   msg = 'Compte mineur : autorisation parentale requise.';

  loadingText.textContent = msg;
  loading.classList.remove('visible');
  btn.disabled = false;
}

function transitionToLauncher() {
  const screen = document.getElementById('login-screen');
  screen.classList.add('fade-out');
  setTimeout(() => screen.classList.add('hidden'), 500);
}

// ── RAM live ──────────────────────────────────────────────────────────────────
function startRamPolling() {
  function updateRamDisplay() {
    if (ipc) {
      ipc.getRamStats().then(({ total, free }) => {
        const used    = total - free;
        const usedGb  = (used  / 1073741824).toFixed(1);
        const totalGb = (total / 1073741824).toFixed(1);
        const pct     = Math.round(used / total * 100);
        const el = document.getElementById('mem-text');
        if (el) el.innerHTML = `${usedGb} GB / ${totalGb} GB &nbsp; <strong>${pct}%</strong>`;
        const bar = document.querySelector('.mem-bar-fill');
        if (bar) bar.style.width = pct + '%';
      }).catch(() => {});
    } else if (typeof require !== 'undefined') {
      // Preview / dev avec nodeIntegration
      try {
        const os  = require('os');
        const total = os.totalmem();
        const free  = os.freemem();
        const used  = total - free;
        const usedGb  = (used  / 1073741824).toFixed(1);
        const totalGb = (total / 1073741824).toFixed(1);
        const pct     = Math.round(used / total * 100);
        const el = document.getElementById('mem-text');
        if (el) el.innerHTML = `${usedGb} GB / ${totalGb} GB &nbsp; <strong>${pct}%</strong>`;
        const bar = document.querySelector('.mem-bar-fill');
        if (bar) bar.style.width = pct + '%';
      } catch {}
    }
  }
  updateRamDisplay();
  setInterval(updateRamDisplay, 3000);
}

// ── Détection Java ────────────────────────────────────────────────────────────
async function populateJavaSelect() {
  const select = document.getElementById('java-select');
  if (!select) return;

  if (ipc) {
    const javas = await ipc.detectJava();
    select.innerHTML = '';
    if (javas.length === 0) {
      select.innerHTML = '<option value="java">java (PATH système)</option>';
    } else {
      javas.forEach(j => {
        const opt = document.createElement('option');
        opt.value = j.path;
        opt.textContent = j.label;
        if (j.path === (localStorage.getItem('s_java_path') || 'java')) opt.selected = true;
        select.appendChild(opt);
      });
    }
    select.onchange = () => {
      localStorage.setItem('s_java_path', select.value);
      showToast('Java sélectionné : ' + select.options[select.selectedIndex].text);
    };
  } else {
    select.innerHTML = '<option value="java">java (détection disponible en app)</option>';
  }
}

// ── Polling MAJ admin (toutes les 5 min) ─────────────────────────────────────
function startUpdatePolling() {
  if (!ipc) return;
  setInterval(async () => {
    const url = instanceData?.admin?.manifest_url;
    if (!url) return;
    try {
      const res = await ipc.checkUpdate(url);
      if (!res.success) return;
      const remote = res.manifest;
      let remoteVer;
      if (remote?.servers) {
        const server = remote.servers.find(s => s.id === 'terranova') || remote.servers[0];
        remoteVer = parseInt(server?.instanceVersion || '0');
      } else {
        remoteVer = parseInt(remote?.admin?.instance_version || '0');
      }
      const localVer = parseInt(localInstanceVersion || '1');
      if (remoteVer > localVer) {
        const changelog = remote?.servers?.[0]?.changelog || remote?.admin?.changelog || '';
        showToast('Mise à jour de l\'instance disponible !');
        showUpdateBanner(changelog, false);
      }
    } catch {}
  }, 5 * 60 * 1000);
}

// ── Gestion réelle des mods ───────────────────────────────────────────────────
async function loadRealMods() {
  if (!ipc?.scanMods || !realInstanceDir) return;
  const mods = await ipc.scanMods(realInstanceDir);
  instanceData.instance.mods = mods.map(m => ({
    name:     m.filename.replace(/\.(jar|zip)$/i, ''),
    version:  '',
    enabled:  m.enabled,
    filename: m.filename,
    relPath:  m.relPath,
  }));
  reRenderModsPanel();
}

// ── Crash reporter ────────────────────────────────────────────────────────────
function analyzeCrash(content, exitCode) {
  const c = content || '';
  if (c.includes('OutOfMemoryError') || c.includes('GC overhead limit')) {
    return {
      icon: '🧠', title: 'Manque de RAM', color: '#e67e22',
      cause: 'Minecraft a manqué de mémoire pendant la session.',
      advice: ['Augmente la RAM allouée dans Paramètres (recommandé : 6 GB+)', 'Ferme les autres applications avant de lancer', 'Désactive les shaders si actifs'],
    };
  }
  if (c.includes('InjectionError') || c.includes('MixinTransformerError') || c.includes('mixin.injection')) {
    const modMatch = c.match(/from mod (\w+)/);
    const modName  = modMatch ? modMatch[1] : 'un mod';
    return {
      icon: '🧩', title: 'Conflit de mod', color: '#9b59b6',
      cause: `Un mixin de "${modName}" a échoué — incompatibilité entre mods.`,
      advice: [`Désactive "${modName}" dans l'onglet Mods et relance`, 'Vérifie que tous tes mods sont compatibles NeoForge 1.21.1', 'Si tu utilises Sinytra Connector, le mod Fabric est peut-être incompatible'],
    };
  }
  if (c.includes('EXCEPTION_ACCESS_VIOLATION') || c.includes('A fatal error has been detected') || exitCode === -1073741819) {
    return {
      icon: '⚡', title: 'Crash JVM / Pilote', color: '#e74c3c',
      cause: 'La JVM a planté — souvent lié aux pilotes graphiques ou à Java.',
      advice: ['Mets à jour tes pilotes graphiques (NVIDIA/AMD)', 'Réinstalle Java 21 depuis adoptium.net', 'Désactive les overclocks si tu en as', 'Essaie de désactiver les shaders'],
    };
  }
  if (c.includes('FileNotFoundException') || c.includes('NoSuchFileException')) {
    return {
      icon: '📁', title: 'Fichier manquant', color: '#3498db',
      cause: 'Un fichier requis par l\'instance est introuvable.',
      advice: ['Utilise "Forcer la MAJ des mods" dans le menu JOUER', 'Vérifie que le dossier de l\'instance est accessible', 'Réinstalle l\'instance si le problème persiste'],
    };
  }
  if (exitCode === 0) {
    return {
      icon: '✅', title: 'Fermeture normale', color: '#27ae60',
      cause: 'Le jeu s\'est fermé normalement (code 0).',
      advice: [],
    };
  }
  return {
    icon: '💥', title: 'Crash inattendu', color: '#e74c3c',
    cause: `Le jeu s'est arrêté avec le code ${exitCode}.`,
    advice: ['Consulte le rapport complet pour plus de détails', 'Vérifie les logs Minecraft pour identifier la cause', 'Essaie de désactiver les mods ajoutés récemment'],
  };
}

async function showCrashModal(code) {
  const modal = document.getElementById('crash-modal');
  if (!modal) return;
  const codeEl      = document.getElementById('crash-code');
  const logEl       = document.getElementById('crash-log');
  const labelEl     = document.getElementById('crash-filename-label');
  const openBtn     = document.getElementById('crash-open-btn');
  const titleEl     = document.getElementById('crash-title');
  const iconEl      = document.getElementById('crash-icon');
  const diagEl      = document.getElementById('crash-diagnosis');
  const causeEl     = document.getElementById('crash-diagnosis-cause');
  const adviceEl    = document.getElementById('crash-advice');
  if (codeEl) codeEl.textContent = code;
  if (logEl)  logEl.textContent  = 'Recherche du rapport...';
  if (openBtn) openBtn.style.display = 'none';
  if (diagEl)  diagEl.style.display  = 'none';
  modal.style.display = 'flex';

  let crashContent = '';
  if (ipc?.getCrashReport && realInstanceDir) {
    const res = await ipc.getCrashReport(realInstanceDir);
    if (res.success) {
      crashContent = res.last10;
      if (labelEl) labelEl.textContent = res.filename;
      if (logEl)   logEl.textContent   = res.last10;
      if (openBtn) { window._crashFullPath = res.fullPath; openBtn.style.display = ''; }
    } else {
      if (logEl) logEl.textContent = 'Aucun rapport de crash trouvé.\nConsultez les logs pour diagnostiquer.';
    }
  } else {
    if (logEl) logEl.textContent = 'Rapport non disponible dans ce mode.';
  }

  const diag = analyzeCrash(crashContent, code);
  if (iconEl)  iconEl.textContent  = diag.icon;
  if (titleEl) titleEl.textContent = diag.title;
  if (diagEl)  { diagEl.style.display = 'block'; diagEl.style.borderLeftColor = diag.color; }
  if (causeEl) causeEl.textContent = diag.cause;
  if (adviceEl) {
    adviceEl.innerHTML = diag.advice.map(a => `<li>${a}</li>`).join('');
    adviceEl.style.display = diag.advice.length ? '' : 'none';
  }
}

function closeCrashModal() {
  const modal = document.getElementById('crash-modal');
  if (modal) modal.style.display = 'none';
}

function openCrashReport() {
  if (window._crashFullPath && ipc) ipc.openPath(window._crashFullPath);
}

function openMinecraftLogs() {
  if (!ipc || !realInstanceDir) { showToast('Chemin instance non résolu'); return; }
  ipc.openPath(path.join(realInstanceDir, 'logs', 'latest.log'));
}

// ── Panel Joueurs (MySQL) ─────────────────────────────────────────────────────
async function loadCommunity() {
  const el = document.getElementById('community-content');
  if (!el) return;
  el.innerHTML = '<div class="placeholder-tab"><span>⏳</span><p>Connexion à la base de données...</p></div>';
  if (!ipc?.dbStats) {
    el.innerHTML = '<div class="placeholder-tab"><span>🔌</span><p>Disponible uniquement dans l\'app.</p></div>';
    return;
  }
  const res = await ipc.dbStats();
  if (!res.success) {
    el.innerHTML = `<div class="placeholder-tab"><span>❌</span><p>Connexion impossible.<br><small style="color:var(--muted)">${res.error || res.reason || ''}</small></p></div>`;
    return;
  }
  const cards = res.tableNames.map(t => `
    <div class="db-stat-card">
      <span class="db-stat-count">${res.counts[t]}</span>
      <span class="db-stat-label">${t}</span>
    </div>
  `).join('');
  let html = `<div class="db-stats-grid">${cards}</div>`;
  if (res.playerTable && res.recentRows.length) {
    const headers = res.columns.map(c => `<th>${c}</th>`).join('');
    const rows    = res.recentRows.map(row =>
      `<tr>${res.columns.map(c => `<td>${row[c] ?? '—'}</td>`).join('')}</tr>`
    ).join('');
    html += `
      <div class="db-table-section">
        <h3 class="panel-title">DERNIERS JOUEURS · <span style="color:var(--green-bright)">${res.playerTable}</span></h3>
        <div class="db-table-wrap">
          <table class="db-table"><thead><tr>${headers}</tr></thead><tbody>${rows}</tbody></table>
        </div>
      </div>`;
  } else if (!res.tableNames.length) {
    html += '<div class="placeholder-tab"><span>📭</span><p>Aucune table trouvée dans la base de données.</p></div>';
  }
  el.innerHTML = html;
}

// ── Statut du serveur Minecraft ───────────────────────────────────────────────
function renderServerStatus(data) {
  const badge   = document.getElementById('server-badge');
  const players = document.getElementById('srv-players');
  const ping    = document.getElementById('srv-ping');
  const version = document.getElementById('srv-version');
  const motd    = document.getElementById('server-motd');

  if (!badge) return;

  if (data.online) {
    badge.textContent = 'EN LIGNE';
    badge.className   = 'server-badge online';
    if (players) players.textContent = `${data.players} / ${data.maxPlayers}`;
    if (ping)    ping.textContent    = `${data.latency} ms`;
    if (version) version.textContent = data.version || '—';
    if (motd)    motd.textContent    = data.motd    || '';
  } else {
    badge.textContent = 'HORS LIGNE';
    badge.className   = 'server-badge offline';
    if (players) players.textContent = '—';
    if (ping)    ping.textContent    = '—';
    if (version) version.textContent = '—';
    if (motd)    motd.textContent    = '';
  }
}

async function refreshServerStatus() {
  if (!ipc?.pingServer || !instanceData) return;
  const badge = document.getElementById('server-badge');
  if (badge) { badge.textContent = '...'; badge.className = 'server-badge'; }

  const host = instanceData.server?.host || 'play.terranova.fr';
  const port = instanceData.server?.port || 25565;
  const el   = document.getElementById('server-host');
  if (el) el.textContent = host;

  const res = await ipc.pingServer({ host, port });
  renderServerStatus(res);
}

function startServerPolling() {
  if (!ipc) return;
  refreshServerStatus();
  setInterval(refreshServerStatus, 60 * 1000);
}

// ── Panel Admin ──────────────────────────────────────────────────────────────
function adminLoad() {
  const el = (id) => document.getElementById(id);
  if (distributionData?.servers?.length) {
    const server = distributionData.servers[0];
    el('admin-instance-version').value = server.instanceVersion || '1';
    el('admin-local-version').value    = localInstanceVersion   || '1';
    el('admin-force-update').checked   = !!server.forceUpdate;
    el('admin-changelog').value        = server.changelog       || '';
    el('admin-files').value = (server.modules || []).map(m => {
      const a = m.artifact || {};
      return `${a.path || ''} | ${a.url || ''} | ${a.sha256 || a.md5 || 'placeholder'} | ${a.size || 0} | ${m.required !== false ? 'true' : 'false'} | ${m.name || ''} | ${m.type || 'ForgeMod'}`;
    }).join('\n');
  } else if (instanceData?.admin) {
    const a = instanceData.admin;
    el('admin-instance-version').value = a.instance_version || '1';
    el('admin-local-version').value    = a.local_version    || '1';
    el('admin-force-update').checked   = !!a.force_update;
    el('admin-changelog').value        = a.changelog        || '';
    el('admin-files').value = (a.files || []).map(f =>
      `${f.path} | ${f.url} | ${f.sha256} | ${f.size}`
    ).join('\n');
  }
  // Token GitHub stocké en localStorage (jamais dans le repo)
  el('admin-github-token').value = localStorage.getItem('admin_github_token') || '';
}

function adminBuildData() {
  const el = (id) => document.getElementById(id);
  const filesRaw = el('admin-files').value.trim().split('\n').filter(Boolean);
  const files = filesRaw.map(line => {
    const [p, url, sha256, size] = line.split('|').map(s => s.trim());
    return { path: p, url, sha256: sha256 || 'placeholder', size: parseInt(size) || 0 };
  });
  return {
    instance_version: el('admin-instance-version').value.trim(),
    local_version:    instanceData.admin?.local_version || '1',
    changelog:        el('admin-changelog').value.trim(),
    force_update:     el('admin-force-update').checked,
    manifest_url:     instanceData.admin?.manifest_url,
    files,
  };
}

function adminSave() {
  if (!fs || !path) { showToast('Disponible uniquement dans l\'app Electron'); return; }

  // En app packagée, __dirname est à l'intérieur du .asar (lecture seule).
  // On écrit à côté du .asar, dans process.resourcesPath.
  const writableDir = __dirname.includes('app.asar') ? process.resourcesPath : __dirname;

  if (distributionData?.servers?.length) {
    const server = distributionData.servers[0];
    const el = (id) => document.getElementById(id);
    server.instanceVersion = el('admin-instance-version').value.trim();
    server.changelog       = el('admin-changelog').value.trim();
    server.forceUpdate     = el('admin-force-update').checked;

    const filesRaw = el('admin-files').value.trim().split('\n').filter(Boolean);
    server.modules = filesRaw.map(line => {
      const parts = line.split('|').map(s => s.trim());
      const [p, url, sha256, size, reqStr, name, type] = parts;
      const baseName = (p || 'mod').split('/').pop().replace(/\.(jar|zip)$/i, '');
      return {
        id:       `terranova:${baseName}:auto`,
        name:     name || baseName,
        type:     type || 'ForgeMod',
        required: reqStr !== 'false',
        artifact: { path: p || '', url: url || '', sha256: sha256 || 'placeholder', size: parseInt(size) || 0 },
      };
    });

    const jsonPath = path.join(writableDir, 'distribution.json');
    try {
      fs.writeFileSync(jsonPath, JSON.stringify(distributionData, null, 2), 'utf8');
      distributionModules = server.modules;
      reRenderModsPanel();
      const badge   = document.getElementById('changelog-version');
      const text    = document.getElementById('changelog-text');
      const remote2 = document.getElementById('changelog-remote-ver');
      if (badge)   badge.textContent   = `v${server.instanceVersion}`;
      if (text)    text.textContent    = server.changelog || '';
      if (remote2) remote2.textContent = `v${server.instanceVersion}`;
      showToast('✅ distribution.json sauvegardé');
      loadRealMods();
      // Sync GitHub puis vérification — les autres PC fetchent GitHub, pas le fichier local
      const token = document.getElementById('admin-github-token')?.value?.trim();
      if (token) {
        localStorage.setItem('admin_github_token', token);
        const manifestUrl = instanceData?.admin?.manifest_url;
        if (manifestUrl && ipc?.pushDistribution) {
          showToast('⏳ Synchronisation GitHub...');
          ipc.pushDistribution(JSON.stringify(distributionData, null, 2), manifestUrl, token).then(res => {
            if (res.success) {
              showToast('✅ Synchronisé sur GitHub — autres PC seront notifiés');
              checkAdminUpdate(); // Vérifie depuis GitHub après le push
            } else {
              showToast('⚠️ GitHub : ' + (res.error || 'erreur inconnue'));
            }
          });
        }
      } else {
        showToast('💡 Renseigne un GitHub Token pour sync multi-PC');
        checkAdminUpdate();
      }
    } catch (e) {
      showToast('Erreur écriture : ' + e.message);
    }
    return;
  }

  const newAdmin = adminBuildData();
  instanceData.admin = newAdmin;
  const jsonPath = path.join(writableDir, 'instance.json');
  try {
    fs.writeFileSync(jsonPath, JSON.stringify(instanceData, null, 2), 'utf8');
    const badge  = document.getElementById('changelog-version');
    const text   = document.getElementById('changelog-text');
    const remote = document.getElementById('changelog-remote-ver');
    const local2 = document.getElementById('changelog-local-ver');
    if (badge)  badge.textContent  = `v${newAdmin.instance_version}`;
    if (text)   text.textContent   = newAdmin.changelog || '';
    if (remote) remote.textContent = `v${newAdmin.instance_version}`;
    if (local2) local2.textContent = `v${newAdmin.local_version}`;
    showToast('✅ instance.json sauvegardé — pousse sur GitHub pour déployer');
  } catch (e) {
    showToast('Erreur écriture : ' + e.message);
  }
}

function adminPreview() {
  const pre = document.getElementById('admin-json-preview');
  if (pre.style.display === 'none') {
    pre.textContent = distributionData?.servers?.length
      ? JSON.stringify(distributionData, null, 2)
      : JSON.stringify({ admin: adminBuildData() }, null, 2);
    pre.style.display = 'block';
  } else {
    pre.style.display = 'none';
  }
}

async function adminPickMods() {
  if (!ipc?.pickMods) { showToast('Disponible uniquement dans l\'app Electron'); return; }
  // On passe realInstanceDir pour que les fichiers soient aussi copiés dans mods/
  const files = await ipc.pickMods(realInstanceDir);
  if (!files.length) return;

  const textarea = document.getElementById('admin-files');
  const baseUrl  = 'https://github.com/ShadowLiveDiscord/terranova-launcher/releases/download/mods/';
  const lines    = files.map(f => {
    const name = f.filename.replace(/[-_]/g, ' ').replace(/\.(jar|zip)$/i, '');
    return `mods/${f.filename} | ${baseUrl}${f.filename} | ${f.sha256} | ${f.size} | true | ${name} | ForgeMod`;
  });
  const existing = textarea.value.trim();
  textarea.value = existing ? existing + '\n' + lines.join('\n') : lines.join('\n');
  showToast(`✅ ${files.length} fichier(s) ajouté(s) — copiés dans mods/ et prêts à tester`);
  // Rafraîchit l'onglet Mods pour afficher les fichiers copiés
  await loadRealMods();
}

function adminSimulateUpdate() {
  if (distributionData?.servers?.length) {
    const server = distributionData.servers[0];
    const el = (id) => document.getElementById(id);
    server.instanceVersion = el('admin-instance-version').value.trim();
    server.changelog       = el('admin-changelog').value.trim();
    server.forceUpdate     = el('admin-force-update').checked;
    showUpdateBanner(server.changelog, server.forceUpdate);
  } else {
    const a = adminBuildData();
    instanceData.admin = a;
    const badge = document.getElementById('changelog-version');
    const text  = document.getElementById('changelog-text');
    if (badge) badge.textContent = `v${a.instance_version}`;
    if (text)  text.textContent  = a.changelog;
    showUpdateBanner(a.changelog, a.force_update);
  }
  showTab('instance');
  showToast('Simulation : bannière de MAJ affichée');
}

// ── Historique des sessions ───────────────────────────────────────────────────
const SESSIONS_KEY = 'terranova_sessions';
const SESSIONS_MAX = 10;

function saveSession(exitCode) {
  if (!gameStartTime) return;
  const duration = Math.floor((Date.now() - gameStartTime) / 1000);
  gameStartTime = null;
  const sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
  sessions.unshift({
    date:     new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    duration,
    exitCode,
    crashed:  exitCode !== 0 && exitCode !== null,
  });
  if (sessions.length > SESSIONS_MAX) sessions.length = SESSIONS_MAX;
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  renderSessions();
}

function formatDuration(secs) {
  if (secs < 60) return `${secs}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function renderSessions() {
  const el = document.getElementById('sessions-list');
  if (!el) return;
  const sessions = JSON.parse(localStorage.getItem(SESSIONS_KEY) || '[]');
  if (!sessions.length) {
    el.innerHTML = '<div class="sessions-empty">Aucune session enregistrée.</div>';
    return;
  }
  el.innerHTML = sessions.map(s => `
    <div class="session-row ${s.crashed ? 'crashed' : ''}">
      <span class="session-icon">${s.crashed ? '💥' : '✅'}</span>
      <span class="session-date">${s.date}</span>
      <span class="session-duration">${formatDuration(s.duration)}</span>
      ${s.crashed ? `<span class="session-badge red">Crash ${s.exitCode}</span>` : '<span class="session-badge green">OK</span>'}
    </div>
  `).join('');
}

// ── Init ──
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.key === 'A') {
    adminLoad();
    showTab('admin');
  }
});

window.addEventListener('DOMContentLoaded', async () => {
  loadInstance();
  loadSettings();
  renderSessions();
  startRamPolling();
  startUpdatePolling();
  startServerPolling();

  if (ipc) {
    // Version dynamique depuis app.getVersion()
    ipc.getAppVersion().then(v => {
      const sidebar = document.getElementById('sidebar-version');
      if (sidebar) sidebar.textContent = 'Launcher v' + v;
      const status = document.getElementById('launcher-version-status');
      if (status) status.innerHTML = '<span class="dot-online"></span> Launcher à jour (v' + v + ')';
    }).catch(() => {});

    // Résoudre le chemin AppData réel dès le démarrage
    ipc.getInstanceDir().then(dir => {
      realInstanceDir = dir;
      const el = document.getElementById('info-path');
      if (el) el.textContent = dir;
      loadRealMods();
    }).catch(() => {});

    ipc.onAppUpdateStatus(handleAppUpdateStatus);

    ipc.onGameLaunched((data) => {
      if (data?.last_launch) {
        if (instanceData?.instance) instanceData.instance.last_launch = data.last_launch;
        const el = document.getElementById('info-last');
        if (el) el.textContent = data.last_launch;
      }
    });

    ipc.onPlaytime((data) => {
      if (data?.playtime) {
        if (instanceData?.instance) instanceData.instance.playtime = data.playtime;
        const el = document.getElementById('info-time');
        if (el) el.textContent = data.playtime;
      }
    });

    // Auto-login silencieux : on tente la session en arrière-plan sans afficher le spinner.
    // Si ça réussit → le launcher s'ouvre directement sans jamais montrer l'écran de login.
    // Si ça échoue → on affiche l'écran de login normalement.
    const result = await ipc.autoLogin();

    if (result.success && result.session) {
      setUser({
        name: result.session.profile.name,
        type: 'Premium',
        uuid: result.session.profile.id,
        skin: result.session.profile.skin,
      }, result.session);
      // Masque l'écran de login immédiatement sans animation
      const screen = document.getElementById('login-screen');
      if (screen) screen.classList.add('hidden');
    }
    // Sinon : l'écran de login reste visible (état par défaut)
  }
  // En mode preview navigateur : le login screen reste visible normalement
});
