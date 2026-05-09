'use strict';

const axios = require('axios');
const WebSocket = require('ws');
const config = require('./config');

const { baseUrl, apiKey, serverId } = config.pterodactyl;

const http = axios.create({
  baseURL: `${baseUrl}/api/client`,
  headers: {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
  timeout: 20000,
});

// ===== Server power & info =====
async function getResources() {
  const { data } = await http.get(`/servers/${serverId}/resources`);
  return data.attributes; // { current_state, is_suspended, resources: {...} }
}

async function getServerInfo() {
  const { data } = await http.get(`/servers/${serverId}`);
  return data.attributes;
}

async function sendPower(signal) {
  // start | stop | restart | kill
  await http.post(`/servers/${serverId}/power`, { signal });
}

async function sendCommand(command) {
  await http.post(`/servers/${serverId}/command`, { command });
}

// ===== Files API =====
async function listFiles(directory = '/') {
  const { data } = await http.get(`/servers/${serverId}/files/list`, {
    params: { directory },
  });
  return data.data.map((f) => f.attributes);
}

async function readFile(filePath) {
  const { data } = await http.get(`/servers/${serverId}/files/contents`, {
    params: { file: filePath },
    transformResponse: [(d) => d], // keep raw
  });
  return data;
}

async function writeFile(filePath, content) {
  await http.post(
    `/servers/${serverId}/files/write`,
    typeof content === 'string' ? content : JSON.stringify(content, null, 2),
    {
      params: { file: filePath },
      headers: { 'Content-Type': 'text/plain' },
    }
  );
}

async function deleteFiles(root, files) {
  await http.post(`/servers/${serverId}/files/delete`, { root, files });
}

async function renameFile(root, fromName, toName) {
  await http.put(`/servers/${serverId}/files/rename`, {
    root,
    files: [{ from: fromName, to: toName }],
  });
}

async function createFolder(root, name) {
  await http.post(`/servers/${serverId}/files/create-folder`, { root, name });
}

// ===== WebSocket console =====
async function getWebsocketCreds() {
  const { data } = await http.get(`/servers/${serverId}/websocket`);
  return data.data; // { token, socket }
}

/**
 * Connect to console websocket.
 * Calls onLine for every console output line.
 * Returns an object with .send(cmd), .close(), and the ws instance.
 */
async function connectConsole({ onLine, onState, onClose, onError }) {
  const creds = await getWebsocketCreds();
  const ws = new WebSocket(creds.socket, { origin: baseUrl });

  let alive = true;
  let pingTimer = null;
  let currentToken = creds.token;

  const sendRaw = (event, args) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event, args: args || [] }));
    }
  };

  ws.on('open', () => {
    sendRaw('auth', [currentToken]);
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.ping(); } catch (_) {}
      }
    }, 30000);
  });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const ev = msg.event;
    const args = msg.args || [];

    if (ev === 'auth success') {
      // Optional: request console history
      sendRaw('send logs', [null]);
      sendRaw('send stats', [null]);
    } else if (ev === 'token expiring' || ev === 'token expired') {
      try {
        const c = await getWebsocketCreds();
        currentToken = c.token;
        sendRaw('auth', [currentToken]);
      } catch (e) {
        if (onError) onError(e);
      }
    } else if (ev === 'console output') {
      const line = args[0] || '';
      // strip ANSI color codes
      const clean = line.replace(/\x1b\[[0-9;]*m/g, '');
      if (onLine) onLine(clean);
    } else if (ev === 'status') {
      if (onState) onState(args[0]);
    } else if (ev === 'jwt error') {
      if (onError) onError(new Error('jwt error: ' + args[0]));
    }
  });

  ws.on('close', () => {
    alive = false;
    if (pingTimer) clearInterval(pingTimer);
    if (onClose) onClose();
  });

  ws.on('error', (e) => {
    if (onError) onError(e);
  });

  return {
    ws,
    send: (cmd) => sendRaw('send command', [cmd]),
    close: () => {
      try { ws.close(); } catch (_) {}
    },
    isAlive: () => alive,
  };
}

module.exports = {
  http,
  getResources,
  getServerInfo,
  sendPower,
  sendCommand,
  listFiles,
  readFile,
  writeFile,
  deleteFiles,
  renameFile,
  createFolder,
  getWebsocketCreds,
  connectConsole,
};
