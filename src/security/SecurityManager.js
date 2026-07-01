'use strict';

const { safeStorage } = require('electron');

// ── Chiffrement des tokens sensibles via DPAPI (Windows) ─────────────────────
// safeStorage utilise le trousseau OS (DPAPI sur Windows, Keychain sur Mac).
// Les données chiffrées sont illisibles par un autre utilisateur ou processus.

function encryptToken(plaintext) {
  if (!safeStorage.isEncryptionAvailable()) return plaintext;
  return safeStorage.encryptString(plaintext).toString('base64');
}

function decryptToken(stored) {
  if (!safeStorage.isEncryptionAvailable()) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'));
  } catch {
    return null; // token corrompu ou issu d'un autre user → force re-login
  }
}

// ── Sanitisation des JVM args ─────────────────────────────────────────────────
// Bloque les flags dangereux : injection d'agent, ouverture de debugger réseau,
// manipulation de la JVM security policy.
const BLOCKED_PREFIXES = [
  '-javaagent:',      // injection de bytecode arbitraire
  '-agentlib:jdwp',   // debugger réseau (JDWP)
  '-agentpath:',      // agent natif arbitraire
  '-Djava.security.manager=', // désactivation du security manager
  '-XX:+DisableExplicitGC',   // peut masquer des fuites mémoire critiques
];

// Caractères interdits dans les valeurs de flags (prévient l'injection shell)
const DANGEROUS_CHARS = /[;&|`$<>]/;

function sanitizeJvmArgs(raw) {
  if (!raw || typeof raw !== 'string') return [];

  return raw
    .split(/\s+/)
    .filter(Boolean)
    .filter(arg => {
      if (DANGEROUS_CHARS.test(arg)) return false;
      if (BLOCKED_PREFIXES.some(p => arg.toLowerCase().startsWith(p.toLowerCase()))) return false;
      return true;
    });
}

// ── CSP pour la BrowserWindow principale ─────────────────────────────────────
// Autorise : scripts locaux, fetch vers les API Mojang/Microsoft/NeoForge,
// images depuis Mojang CDN (skins), fonts Google.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",  // unsafe-inline requis pour le renderer inline
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https://textures.minecraft.net https://crafatar.com",
  "connect-src 'self' " + [
    'https://login.live.com',
    'https://user.auth.xboxlive.com',
    'https://xsts.auth.xboxlive.com',
    'https://api.minecraftservices.com',
    'https://piston-meta.mojang.com',
    'https://launchermeta.mojang.com',
    'https://maven.neoforged.net',
    'https://maven.minecraftforge.net',
    'https://libraries.minecraft.net',
    'https://resources.download.minecraft.net',
  ].join(' '),
].join('; ');

function applyCSP(session) {
  session.webRequest.onHeadersReceived((details, callback) => {
    // Appliquer la CSP seulement aux pages locales du launcher (file://)
    // Ne pas toucher aux pages externes (Microsoft OAuth, Xbox, etc.)
    if (!details.url.startsWith('file://')) {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
      },
    });
  });
}

module.exports = { encryptToken, decryptToken, sanitizeJvmArgs, applyCSP };
