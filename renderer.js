const { ipcRenderer } = typeof require !== 'undefined' ? require('electron') : { ipcRenderer: null };
const fs   = typeof require !== 'undefined' ? require('fs')   : null;
const path = typeof require !== 'undefined' ? require('path') : null;

// ipcRenderer.invoke disponible uniquement dans Electron
const ipc = ipcRenderer ? {
  autoLogin:        () => ipcRenderer.invoke('auth:autoLogin'),
  login:            () => ipcRenderer.invoke('auth:login'),
  logout:           () => ipcRenderer.invoke('auth:logout'),
  checkUpdate:      (url) => ipcRenderer.invoke('update:check', { url }),
  startUpdate:      (instanceDir, files) => ipcRenderer.invoke('update:start', { instanceDir, files }),
  onProgress:       (cb) => ipcRenderer.on('update:progress', (_, data) => cb(data)),
  checkAppUpdate:   () => ipcRenderer.invoke('app-update:check'),
  downloadAppUpdate: () => ipcRenderer.invoke('app-update:download'),
  installAppUpdate:  () => ipcRenderer.send('app-update:install'),
  onAppUpdateStatus: (cb) => ipcRenderer.on('app-update:status', (_, data) => cb(data)),
  openPath:         (p) => ipcRenderer.invoke('shell:openPath', p),
  openExternal:     (url) => ipcRenderer.invoke('shell:openExternal', url),
  openFolderDialog: () => ipcRenderer.invoke('dialog:openFolder'),
} : null;

// ── Titlebar ──
document.getElementById('btn-minimize')?.addEventListener('click', () => ipcRenderer?.send('minimize-window'));
document.getElementById('btn-maximize')?.addEventListener('click', () => ipcRenderer?.send('maximize-window'));
document.getElementById('btn-close')?.addEventListener('click',    () => ipcRenderer?.send('close-window'));

// ── Chargement de l'instance ──
let instanceData = null;
let localInstanceVersion = localStorage.getItem('localInstanceVersion') || '1';

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
    instance: { name: 'Mon Instance', version: '1.20.4', loader: 'Forge 47.2.0', java: '17', description: '', mods_count: 0, resource_packs: 0, shaders: '-', ram_mb: 4096, path: 'C:\\TerraNova\\instances\\mon-instance', last_launch: '-', playtime: '-', mods: [] },
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

// ── Vérification MAJ admin ──
function checkAdminUpdate() {
  if (!instanceData) return;
  const adminVersion = instanceData.admin.instance_version;
  if (parseInt(adminVersion) > parseInt(localInstanceVersion)) {
    showUpdateBanner(instanceData.admin.changelog, instanceData.admin.force_update);
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
  const p = instanceData?.instance?.path || 'C:\\TerraNova\\instances\\mon-instance';
  if (ipc) ipc.openPath(p);
  else showToast('📁 ' + p);
}

function openSavesFolder() {
  const base = instanceData?.instance?.path || 'C:\\TerraNova\\instances\\mon-instance';
  const p = base.replace(/\\/g, '\\') + '\\saves';
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

function launchGame() {
  const overlay = document.getElementById('launch-overlay');
  overlay.classList.add('active');
  const bar  = document.getElementById('progress-bar');
  const stat = document.getElementById('launch-status-text');
  const pct  = document.getElementById('progress-pct');
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
  bar.style.width = '0%'; pct.textContent = '0%'; stat.textContent = 'Initialisation...';
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
  ipcRenderer?.send('launch-game', {});
}

function cancelLaunch() {
  clearInterval(launchInterval);
  document.getElementById('launch-overlay').classList.remove('active');
}

function quitApp() { ipcRenderer?.send('close-window'); }
function checkUpdate() { checkAdminUpdate(); }

// ── Mise à jour automatique du launcher (electron-updater) ───────────────────
let appUpdateState = 'idle'; // idle | available | downloading | downloaded

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

    case 'error':
      appUpdateState = 'idle';
      // Pas de bannière : l'erreur est silencieuse (pas de release publiée = normal)
      break;

    // 'checking' / 'not-available' : pas de bannière, rien à faire
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

// ── Simuler une MAJ admin ──
function simulateAdminUpdate() {
  instanceData.admin.instance_version = '99';
  instanceData.admin.changelog = 'Ajout de 5 nouveaux mods, mise à jour vers Forge 47.3.0, nouveau pack BSL v9.0.';
  checkAdminUpdate();
}

// ── Session utilisateur ──
let currentUser = null;

// ── Rendu du skin (style Nebula/Helios) ───────────────────────────────────────
// Pas de service tiers (crafatar...) : on dessine le visage directement depuis
// la texture officielle Mojang (skin.url renvoyé par l'API Minecraft) via canvas.
function drawSkinFace(skinUrl, canvas, onSuccess, onError) {
  if (!skinUrl || !canvas) { onError?.(); return; }
  const img = new Image();
  img.onload = () => {
    try {
      const ctx  = canvas.getContext('2d');
      const size = canvas.width;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, size, size);
      // Couche de base du visage : pixels (8,8) à (16,16)
      ctx.drawImage(img, 8, 8, 8, 8, 0, 0, size, size);
      // Couche "casque" (overlay) : pixels (40,8) à (48,16), uniquement sur les skins 64x64
      if (img.naturalHeight >= 64) {
        ctx.drawImage(img, 40, 8, 8, 8, 0, 0, size, size);
      }
      onSuccess?.();
    } catch (e) {
      onError?.();
    }
  };
  img.onerror = () => onError?.();
  img.src = skinUrl;
}

function setUser(profile) {
  currentUser = profile;
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
      });
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
    });
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

// ── Init ──
window.addEventListener('DOMContentLoaded', async () => {
  loadInstance();
  loadSettings();

  if (ipc) {
    ipc.onAppUpdateStatus(handleAppUpdateStatus);

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
      });
      transitionToLauncher();
    } else {
      // Pas de session → afficher le login normalement
      loading.classList.remove('visible');
    }
  }
  // En mode preview navigateur : le login screen reste visible normalement
});
