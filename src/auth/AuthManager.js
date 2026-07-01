'use strict';

const { BrowserWindow, session } = require('electron');
const fetch = require('node-fetch');
const Store = require('electron-store');
const { encryptToken, decryptToken } = require('../security/SecurityManager');

// ─── Constantes OAuth Microsoft (MSA live.com flow) ──────────────────────────
const CLIENT_ID    = '00000000402b5328';
const REDIRECT_URI = 'https://login.live.com/oauth20_desktop.srf';
const SCOPES       = 'XboxLive.signin offline_access';

const AUTH_URL = 'https://login.live.com/oauth20_authorize.srf'
  + `?client_id=${CLIENT_ID}`
  + `&response_type=code`
  + `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`
  + `&scope=${encodeURIComponent(SCOPES)}`
  + `&prompt=select_account`;

const store = new Store({ name: 'auth' });

// ─── Étape 1 : Fenêtre OAuth → récupération du code ──────────────────────────
function openMicrosoftAuthWindow() {
  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 520,
      height: 600,
      resizable: false,
      frame: true,
      title: 'Connexion Microsoft - TerraNova',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    });

    win.loadURL(AUTH_URL);
    win.show();

    // Surveille les redirections pour capturer le code
    win.webContents.on('will-redirect', (event, url) => {
      handleRedirect(url, win, resolve, reject);
    });

    win.webContents.on('will-navigate', (event, url) => {
      handleRedirect(url, win, resolve, reject);
    });

    win.on('closed', () => {
      reject(new Error('AUTH_WINDOW_CLOSED'));
    });
  });
}

function handleRedirect(url, win, resolve, reject) {
  if (!url.startsWith(REDIRECT_URI)) return;

  try {
    const parsed = new URL(url);
    const code  = parsed.searchParams.get('code');
    const error = parsed.searchParams.get('error');

    if (error) {
      win.close();
      reject(new Error(`MS_AUTH_ERROR: ${error} — ${parsed.searchParams.get('error_description')}`));
      return;
    }

    if (code) {
      win.close();
      resolve(code);
    }
  } catch (e) {
    win.close();
    reject(e);
  }
}

// ─── Étape 2 : Code → Microsoft Access Token + Refresh Token ─────────────────
async function getMicrosoftTokens(code) {
  const res = await fetch('https://login.live.com/oauth20_token.srf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:    CLIENT_ID,
      code,
      grant_type:   'authorization_code',
      redirect_uri: REDIRECT_URI,
      scope:        SCOPES,
    }),
  });

  if (!res.ok) throw new Error(`MS_TOKEN_ERROR: ${res.status} ${await res.text()}`);
  return res.json();
  // { access_token, refresh_token, expires_in, token_type }
}

// ─── Étape 2b : Refresh Token → nouveaux tokens MS ───────────────────────────
async function refreshMicrosoftToken(refreshToken) {
  const res = await fetch('https://login.live.com/oauth20_token.srf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     CLIENT_ID,
      grant_type:    'refresh_token',
      refresh_token: refreshToken,
      scope:         SCOPES,
    }),
  });

  if (!res.ok) throw new Error(`MS_REFRESH_ERROR: ${res.status} ${await res.text()}`);
  return res.json();
}

// ─── Étape 3 : MS Access Token → Xbox Live Token (XBL) ───────────────────────
async function getXBLToken(msAccessToken) {
  const res = await fetch('https://user.auth.xboxlive.com/user/authenticate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    },
    body: JSON.stringify({
      Properties: {
        AuthMethod: 'RPS',
        SiteName:   'user.auth.xboxlive.com',
        RpsTicket:  `d=${msAccessToken}`,
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType:    'JWT',
    }),
  });

  if (!res.ok) throw new Error(`XBL_ERROR: ${res.status}`);
  const data = await res.json();
  return {
    token:    data.Token,
    userHash: data.DisplayClaims.xui[0].uhs,
  };
}

// ─── Étape 4 : XBL Token → XSTS Token ────────────────────────────────────────
async function getXSTSToken(xblToken) {
  const res = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept':       'application/json',
    },
    body: JSON.stringify({
      Properties: {
        SandboxId:  'RETAIL',
        UserTokens: [xblToken],
      },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType:    'JWT',
    }),
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    // 2148916233 = compte Xbox non créé
    // 2148916238 = mineur sans autorisation parentale
    const xErr = data.XErr;
    if (xErr === 2148916233) throw new Error('XSTS_NO_XBOX_ACCOUNT');
    if (xErr === 2148916238) throw new Error('XSTS_CHILD_ACCOUNT');
    throw new Error(`XSTS_ERROR: ${res.status} XErr=${xErr}`);
  }

  const data = await res.json();
  return data.Token;
}

// ─── Étape 5 : XSTS + UserHash → Minecraft Access Token ──────────────────────
async function getMinecraftToken(xstsToken, userHash) {
  const res = await fetch('https://api.minecraftservices.com/authentication/login_with_xbox', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identityToken: `XBL3.0 x=${userHash};${xstsToken}`,
    }),
  });

  if (!res.ok) throw new Error(`MC_AUTH_ERROR: ${res.status}`);
  return res.json();
  // { access_token, expires_in, token_type, username (UUID), roles }
}

// ─── Étape 6 : Minecraft Access Token → Profil (UUID + pseudo) ───────────────
async function getMinecraftProfile(mcAccessToken) {
  const res = await fetch('https://api.minecraftservices.com/minecraft/profile', {
    headers: { Authorization: `Bearer ${mcAccessToken}` },
  });

  if (res.status === 404) throw new Error('MC_NO_GAME'); // compte sans Minecraft
  if (!res.ok) throw new Error(`MC_PROFILE_ERROR: ${res.status}`);
  return res.json();
  // { id (UUID), name (pseudo), skins: [...], capes: [...] }
}

// ─── Authentification complète ────────────────────────────────────────────────
async function authenticate() {
  const code      = await openMicrosoftAuthWindow();
  const msTokens  = await getMicrosoftTokens(code);
  const { token: xblToken, userHash } = await getXBLToken(msTokens.access_token);
  const xstsToken = await getXSTSToken(xblToken);
  const mcTokens  = await getMinecraftToken(xstsToken, userHash);
  const profile   = await getMinecraftProfile(mcTokens.access_token);

  const session = {
    profile: {
      id:   profile.id,
      name: profile.name,
      skin: profile.skins?.[0]?.url ?? null,
    },
    tokens: {
      msRefreshToken:  msTokens.refresh_token,
      mcAccessToken:   mcTokens.access_token,
      mcTokenExpires:  Date.now() + mcTokens.expires_in * 1000,
    },
    addedAt: Date.now(),
  };

  saveSession(session);
  return session;
}

// ─── Auto-login si session existante encore valide ───────────────────────────
async function autoLogin() {
  const session = loadSession();
  if (!session) return null;

  // Si le token MC est encore valide (marge de 5 min)
  if (session.tokens.mcTokenExpires - Date.now() > 5 * 60 * 1000) {
    // Re-fetch le profil si le skin est absent (session stockée par ancienne version)
    if (!session.profile.skin) {
      try {
        const profile = await getMinecraftProfile(session.tokens.mcAccessToken);
        session.profile.skin = profile.skins?.[0]?.url ?? null;
        saveSession(session);
      } catch {}
    }
    return session;
  }

  // Sinon, refresh via le MS refresh token
  try {
    const msTokens  = await refreshMicrosoftToken(session.tokens.msRefreshToken);
    const { token: xblToken, userHash } = await getXBLToken(msTokens.access_token);
    const xstsToken = await getXSTSToken(xblToken);
    const mcTokens  = await getMinecraftToken(xstsToken, userHash);

    session.tokens.msRefreshToken = msTokens.refresh_token;
    session.tokens.mcAccessToken  = mcTokens.access_token;
    session.tokens.mcTokenExpires = Date.now() + mcTokens.expires_in * 1000;

    // Refresh le profil pour mettre à jour le skin
    try {
      const profile = await getMinecraftProfile(mcTokens.access_token);
      session.profile.skin = profile.skins?.[0]?.url ?? session.profile.skin;
    } catch {}

    saveSession(session);
    return session;
  } catch (e) {
    console.error('AutoLogin refresh failed:', e.message);
    clearSession();
    return null;
  }
}

// ─── Persistance (tokens chiffrés via safeStorage / DPAPI) ───────────────────
function saveSession(sess) {
  const toStore = {
    ...sess,
    tokens: {
      ...sess.tokens,
      msRefreshToken: encryptToken(sess.tokens.msRefreshToken),
      mcAccessToken:  encryptToken(sess.tokens.mcAccessToken),
    },
  };
  store.set('session', toStore);
}

function loadSession() {
  const sess = store.get('session', null);
  if (!sess) return null;

  const msRefreshToken = decryptToken(sess.tokens.msRefreshToken);
  const mcAccessToken  = decryptToken(sess.tokens.mcAccessToken);

  // Si le déchiffrement échoue (token corrompu / autre machine), force re-login
  if (!msRefreshToken || !mcAccessToken) {
    store.delete('session');
    return null;
  }

  return {
    ...sess,
    tokens: { ...sess.tokens, msRefreshToken, mcAccessToken },
  };
}

function clearSession() {
  store.delete('session');
}

module.exports = { authenticate, autoLogin, clearSession };
