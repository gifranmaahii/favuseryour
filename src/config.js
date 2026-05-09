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
  wa: {
    // Regex untuk menangkap pairing code di console (group 1 = code, 8 char alnum)
    // Default: harus mengandung digit (skip kata seperti MASUKKAN/PAIRING/NOMOR).
    // Format yg di-match: XXXX-XXXX atau XXXXXXXX (8 char) yg memuat ≥1 angka.
    pairRegex: process.env.WA_PAIR_REGEX
      || '((?:[A-Z0-9]{4}-[A-Z0-9]{4})|(?=[A-Z0-9]*\\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{8})',
    // Regex untuk mendeteksi bot SUKSES konek (boleh sertakan placeholder {number})
    connectedRegex: process.env.WA_CONNECTED_REGEX
      || '(connected|logged\\s*in|tersambung|online|ready|berhasil\\s*login|open)',
    pairTimeoutMs: Number(process.env.WA_PAIR_TIMEOUT_MS || 60000),
    connectTimeoutMs: Number(process.env.WA_CONNECT_TIMEOUT_MS || 120000),
    // Sequence command yang dikirim untuk minta pairing.
    // Pisahkan dengan '\n' untuk multi-step (menu bot). {number} otomatis diganti.
    // Default: kirim "pair <nomor>" lalu (kalau bot menu) "2" lalu "<nomor>" lagi.
    pairCommand: process.env.WA_PAIR_COMMAND || '',
    // Prompt dari bot yang minta input NOMOR (bukan menu item). Harus diakhiri
    // ":" atau ">" supaya tidak match teks "(Masukkan nomor HP)" di menu.
    promptNumberRegex: process.env.WA_PROMPT_NUMBER_REGEX
      || '(masukkan\\s*nomor.*[:>]\\s*$|input.*number.*[:>]\\s*$|enter.*number.*[:>]\\s*$|nomor\\s*hp.*[:>]\\s*$|phone\\s*number.*[:>]\\s*$)',
    // Prompt menu utama: bila match, otomatis kirim "2".
    promptMenuRegex: process.env.WA_PROMPT_MENU_REGEX
      || '(pilih\\s*metode\\s*login|pilih\\s*menu|select.*option|\\(1\\/2\\)|^[\\s]*\\d+\\.\\s*pairing\\s*code)',
    // Pilihan menu untuk pairing (default 2)
    pairMenuChoice: process.env.WA_PAIR_MENU_CHOICE || '2',
  },
};
