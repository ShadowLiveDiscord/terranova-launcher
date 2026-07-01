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
  getInstanceDir:    () => ipcRenderer.invoke('app:getInstanceDir'),
  getAppVersion:     () => ipcRenderer.invoke('app:getVersion'),
  // Jeu
  launch:            (opts) => ipcRenderer.invoke('game:launch', opts),
  killGame:          () => ipcRenderer.send('game:kill'),
  onGameProgress:    (cb) => ipcRenderer.on('game:progress', (_, d) => cb(d)),
  onGameData:        (cb) => ipcRenderer.on('game:data',     (_, d) => cb(d)),
  onGameClose:       (cb) => ipcRenderer.on('game:close',    (_, code) => cb(code)),
  onGameLaunched:    (cb) => ipcRenderer.on('game:launched', (_, data) => cb(data)),
  // Java / RAM
  detectJava:        () => ipcRenderer.invoke('java:detect'),
  getRamStats:       () => ipcRenderer.invoke('ram:stats'),
  // Discord RPC
  discordPlay:       (opts) => ipcRenderer.invoke('discord:play', opts),
  discordStop:       ()     => ipcRenderer.invoke('discord:stop'),
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

function loadInstance() {
  if (fs) {
    try {
      const raw = fs.readFileSync(path.join(__dirname, 'instance.json'), 'utf8');
      instanceData = JSON.parse(raw);
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
  renderMods(i.mods);

  // Statut mods
  const enabled = i.mods.filter(m => m.enabled).length;
  document.getElementById('status-mods').textContent = `${enabled} / ${i.mods.length}`;
  document.getElementById('mods-enabled-count').textContent = `${enabled} / ${i.mods.length} mods actifs`;

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

function renderMods(mods) {
  const icons = ['🌿','⚡','🗺','🏗','🎒','🔮','🚀','🍖','🦁','⚔','⚙','💎'];
  const html = mods.map((m, i) => `
    <div class="mod-item ${m.enabled ? 'active' : ''}">
      <div class="mod-icon">${icons[i % icons.length]}</div>
      <div class="mod-info">
        <span class="mod-name">${m.name}</span>
        <span class="mod-version">${m.version}</span>
      </div>
      <label class="toggle">
        <input type="checkbox" ${m.enabled ? 'checked' : ''} onchange="toggleMod(${i}, this.checked)">
        <span class="toggle-slider"></span>
      </label>
    </div>
  `).join('');
  const el = document.getElementById('mods-list');
  const el2 = document.getElementById('mods-list-global');
  if (el)  el.innerHTML  = html;
  if (el2) el2.innerHTML = html;
}

function toggleMod(index, enabled) {
  instanceData.instance.mods[index].enabled = enabled;
  const total   = instanceData.instance.mods.length;
  const active  = instanceData.instance.mods.filter(m => m.enabled).length;
  document.getElementById('status-mods').textContent       = `${active} / ${total}`;
  document.getElementById('mods-enabled-count').textContent = `${active} / ${total} mods actifs`;
}

// ── Vérification MAJ admin (distante) ──
async function checkAdminUpdate() {
  if (!instanceData) return;
  const manifestUrl = instanceData.admin?.manifest_url;

  // Sans Electron ou sans URL : comparaison locale uniquement
  if (!ipc || !manifestUrl) {
    const localVer = parseInt(instanceData.admin.instance_version || '1');
    if (localVer > parseInt(localInstanceVersion)) {
      showUpdateBanner(instanceData.admin.changelog, instanceData.admin.force_update);
    }
    return;
  }

  try {
    const result = await ipc.checkUpdate(manifestUrl);
    if (!result.success) return;

    const remote    = result.manifest;
    const remoteVer = parseInt(remote?.admin?.instance_version || '0');
    const localVer  = parseInt(localInstanceVersion || '1');

    if (remoteVer > localVer) {
      // Injection des données distantes dans instanceData pour le download
      instanceData.admin.instance_version = remote.admin.instance_version;
      instanceData.admin.changelog        = remote.admin.changelog || '';
      instanceData.admin.files            = remote.admin.files     || [];
      instanceData.admin.force_update     = remote.admin.force_update || false;

      // Rafraîchit le panel changelog avec les données distantes
      const badge  = document.getElementById('changelog-version');
      const text   = document.getElementById('changelog-text');
      const remote2 = document.getElementById('changelog-remote-ver');
      if (badge)   badge.textContent  = `v${remote.admin.instance_version}`;
      if (text)    text.textContent   = remote.admin.changelog || '';
      if (remote2) remote2.textContent = `v${remote.admin.instance_version}`;

      showUpdateBanner(remote.admin.changelog, remote.admin.force_update);
    }
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

    const files       = instanceData.admin.files || [];
    const instanceDir = instanceData.instance.path;
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
  document.getElementById('update-overlay').style.display       = 'none';
  document.getElementById('update-actions').style.display        = 'flex';
  document.getElementById('update-progress-wrap').style.display  = 'none';
  document.getElementById('update-file-status').style.display    = 'none';
  document.getElementById('update-bar').style.width              = '0%';
}

// ── Navigation principale ──
function showTab(name) {
  if (name === 'settings') populateJavaSelect();
  if (name === 'saves')   loadSaves();
  if (name === 'options') loadOptions();
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
function addMod() {
  showToast('Glisser-déposer un .jar disponible dans l\'app Electron');
}

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

    // Écoute de la progression : installation NeoForge + téléchargement assets
    ipc.onGameProgress((p) => {
      if (p.type === 'setup') {
        // Phase auto-install NeoForge (0..80%)
        const v = Math.round((p.pct || 0) * 80);
        bar.style.width = v + '%';
        pct.textContent = v + '%';
        stat.textContent = p.msg || 'Installation...';
      } else if (['download', 'extract', 'assets', 'assets-copy', 'natives', 'classes', 'classes-custom'].includes(p.type)) {
        // Phase vérification/téléchargement des fichiers Minecraft (80..98%)
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
      if (code !== 0 && code !== null) showToast(`Minecraft fermé (code ${code})`);
      if (cancelBtn) cancelBtn.textContent = 'Annuler';
      ipc.discordStop?.();
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
      showToast('Erreur lancement : ' + result.error);
      return;
    }

    // Jeu lancé
    gameRunning = true;
    bar.style.width = '100%'; pct.textContent = '100%';
    stat.textContent = 'Minecraft lancé !';

    // Discord Rich Presence
    ipc.discordPlay?.({
      version:    instanceData.instance.version,
      loader:     instanceData.instance.loader,
      modsCount:  instanceData.instance.mods.filter(m => m.enabled).length,
    });
    if (cancelBtn) cancelBtn.textContent = 'Fermer le launcher';

    // Fermer le launcher si l'option est activée
    const closeOnLaunch = localStorage.getItem('s_close_on_launch');
    if (closeOnLaunch !== '0') {
      setTimeout(() => ipcRenderer?.send('minimize-window'), 1500);
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

// ── Panel Admin ──────────────────────────────────────────────────────────────
function adminLoad() {
  if (!instanceData?.admin) return;
  const a = instanceData.admin;
  const el = (id) => document.getElementById(id);
  el('admin-instance-version').value = a.instance_version || '1';
  el('admin-local-version').value    = a.local_version    || '1';
  el('admin-force-update').checked   = !!a.force_update;
  el('admin-changelog').value        = a.changelog        || '';
  el('admin-files').value = (a.files || []).map(f =>
    `${f.path} | ${f.url} | ${f.sha256} | ${f.size}`
  ).join('\n');
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
    local_version:    instanceData.admin.local_version || '1',
    changelog:        el('admin-changelog').value.trim(),
    force_update:     el('admin-force-update').checked,
    manifest_url:     instanceData.admin.manifest_url,
    files,
  };
}

function adminSave() {
  if (!fs || !path) { showToast('Disponible uniquement dans l\'app Electron'); return; }
  const newAdmin = adminBuildData();
  instanceData.admin = newAdmin;
  const jsonPath = path.join(__dirname, 'instance.json');
  try {
    fs.writeFileSync(jsonPath, JSON.stringify(instanceData, null, 2), 'utf8');
    // Rafraîchit le badge changelog
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
    showToast('Erreur : ' + e.message);
  }
}

function adminPreview() {
  const pre = document.getElementById('admin-json-preview');
  if (pre.style.display === 'none') {
    pre.textContent = JSON.stringify({ admin: adminBuildData() }, null, 2);
    pre.style.display = 'block';
  } else {
    pre.style.display = 'none';
  }
}

async function adminPickMods() {
  if (!ipc?.pickMods) { showToast('Disponible uniquement dans l\'app Electron'); return; }
  const files = await ipc.pickMods();
  if (!files.length) return;

  const textarea = document.getElementById('admin-files');
  const baseUrl  = 'https://github.com/ShadowLiveDiscord/terranova-launcher/releases/download/mods/';
  const lines    = files.map(f =>
    `mods/${f.filename} | ${baseUrl}${f.filename} | ${f.sha256} | ${f.size}`
  );
  const existing = textarea.value.trim();
  textarea.value = existing ? existing + '\n' + lines.join('\n') : lines.join('\n');
  showToast(`✅ ${files.length} fichier(s) ajouté(s) — remplace l'URL par ton hébergement`);
}

function adminSimulateUpdate() {
  const a = adminBuildData();
  instanceData.admin = a;
  const badge  = document.getElementById('changelog-version');
  const text   = document.getElementById('changelog-text');
  if (badge) badge.textContent = `v${a.instance_version}`;
  if (text)  text.textContent  = a.changelog;
  showUpdateBanner(a.changelog, a.force_update);
  showTab('instance');
  showToast('Simulation : bannière de MAJ affichée');
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
  startRamPolling();

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
      // Afficher le vrai chemin dans l'interface info
      const el = document.getElementById('info-path');
      if (el) el.textContent = dir;
    }).catch(() => {});

    ipc.onAppUpdateStatus(handleAppUpdateStatus);

    ipc.onGameLaunched((data) => {
      if (data?.last_launch) {
        if (instanceData?.instance) instanceData.instance.last_launch = data.last_launch;
        const el = document.getElementById('info-last');
        if (el) el.textContent = data.last_launch;
      }
    });

    // Electron : tentative d'auto-login avec session sauvegardée
    const loading     = document.getElementById('login-loading');
    const loadingText = document.getElementById('login-loading-text');
    loading.classList.add('visible');
    loadingText.textContent = 'Vérification de la session...';

    const result = await ipc.autoLogin();

    if (result.success && result.session) {
      setUser({
        name: result.session.profile.name,
        type: 'Premium',
        uuid: result.session.profile.id,
        skin: result.session.profile.skin,
      }, result.session);
      transitionToLauncher();
    } else {
      // Pas de session → afficher le login normalement
      loading.classList.remove('visible');
    }
  }
  // En mode preview navigateur : le login screen reste visible normalement
});
