'use strict';

require('dotenv').config();

function req(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

const adminIds = (process.env.TELEGRAM_ADMIN_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => Number(s))
  .filter((n) => Number.isFinite(n));

module.exports = {
  telegram: {
    token: req('TELEGRAM_BOT_TOKEN'),
    adminIds,
  },
  pterodactyl: {
    baseUrl: req('PTERODACTYL_BASE_URL').replace(/\/+$/, ''),
    apiKey: req('PTERODACTYL_API_KEY'),
    serverId: req('PTERODACTYL_SERVER_ID'),
  },
  paths: {
    sewaFile: process.env.SEWA_FILE_PATH || '/sewa.json',
    sessionDir: process.env.SESSION_DIR || '/session',
  },
  watcher: {
    enabled: (process.env.ENABLE_CONSOLE_WATCHER || 'true').toLowerCase() === 'true',
    patterns: (process.env.NOTIFY_PATTERNS || 'error|disconnect|fatal|crash')
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean),
  },
};
