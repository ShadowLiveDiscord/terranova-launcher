'use strict';

// ── Pour activer le Rich Presence, crée une application sur
//    https://discord.com/developers/applications et remplace cet ID.
const DISCORD_CLIENT_ID = '1389349534261161994';

let rpcClient    = null;
let startTime    = null;
let rpcConnected = false;

async function connect() {
  if (rpcConnected) return;

  try {
    const { Client } = require('discord-rpc');
    rpcClient = new Client({ transport: 'ipc' });

    rpcClient.on('ready', () => {
      rpcConnected = true;
    });

    rpcClient.on('disconnected', () => {
      rpcConnected = false;
      rpcClient    = null;
    });

    await rpcClient.login({ clientId: DISCORD_CLIENT_ID });
  } catch {
    // Discord non ouvert ou non installé — silencieux
    rpcClient    = null;
    rpcConnected = false;
  }
}

async function setPlaying(opts = {}) {
  await connect();
  if (!rpcConnected || !rpcClient) return;

  startTime = startTime || Date.now();

  try {
    await rpcClient.setActivity({
      details:        `TerraNova — ${opts.loader || 'NeoForge 21.1.233'}`,
      state:          `${opts.modsCount || 0} mods actifs`,
      startTimestamp: startTime,
      largeImageKey:  'terranova',
      largeImageText: 'TerraNova Launcher',
      smallImageKey:  'minecraft',
      smallImageText: `Minecraft ${opts.version || '1.21.1'}`,
      instance:       false,
    });
  } catch {}
}

async function clearActivity() {
  startTime = null;
  if (!rpcConnected || !rpcClient) return;
  try {
    await rpcClient.clearActivity();
  } catch {}
}

async function destroy() {
  rpcConnected = false;
  startTime    = null;
  if (rpcClient) {
    try { await rpcClient.destroy(); } catch {}
    rpcClient = null;
  }
}

module.exports = { setPlaying, clearActivity, destroy };
