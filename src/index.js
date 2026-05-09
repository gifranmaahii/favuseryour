'use strict';

const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const pter = require('./pterodactyl');
const hub = require('./consoleHub');
const sewa = require('./sewaStore');
const chats = require('./chatStore');

function notifyTargets() {
  // Jika admin diset, kirim hanya ke admin. Jika tidak, kirim ke semua chat yang pernah berinteraksi.
  if (config.telegram.adminIds.length) return config.telegram.adminIds;
  return chats.all();
}

const bot = new TelegramBot(config.telegram.token, { polling: true });

// =================== AUTH ===================
function isAdmin(userId) {
  // Public mode: jika TELEGRAM_ADMIN_IDS kosong, semua user diizinkan.
  if (!config.telegram.adminIds.length) return true;
  return config.telegram.adminIds.includes(Number(userId));
}

function guard(handler) {
  return async (msg, ...rest) => {
    const uid = msg.from && msg.from.id;
    if (msg.chat && msg.chat.id) chats.add(msg.chat.id);
    if (!isAdmin(uid)) {
      try {
        await bot.sendMessage(
          msg.chat.id,
          `⛔ *Akses ditolak.*\n\nID Telegram Anda: \`${uid}\`\n` +
          `Hubungi pemilik bot untuk ditambahkan, atau kosongkan \`TELEGRAM_ADMIN_IDS\` di \`.env\` agar publik.`,
          { parse_mode: 'Markdown' }
        );
      } catch (_) {}
      return;
    }
    try {
      await handler(msg, ...rest);
    } catch (e) {
      console.error('[handler error]', e.message || e);
      let detail;
      if (e.code === 'ECONNABORTED' || /timeout/i.test(e.message || '')) {
        detail = '⏱️ Panel timeout / lambat merespons. Coba lagi sebentar.';
      } else if (e.response && e.response.data) {
        const d = e.response.data;
        const errs = d.errors && d.errors[0];
        detail = errs ? `${errs.code || ''} ${errs.detail || ''}`.trim() : JSON.stringify(d).slice(0, 400);
      } else {
        detail = e.message || String(e);
      }
      try {
        await bot.sendMessage(msg.chat.id, `❌ ${detail}`);
      } catch (_) {}
    }
  };
}

// =================== HELPERS ===================
const STATE_EMOJI = {
  running: '🟢',
  starting: '🟡',
  stopping: '🟡',
  offline: '🔴',
  unknown: '⚪',
};

function fmtBytes(n) {
  if (!n && n !== 0) return '-';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(2)} ${u[i]}`;
}

function escapeMd(s) {
  return String(s).replace(/([_*`\[\]()])/g, '\\$1');
}

async function sendLong(chatId, text, opts = {}) {
  const MAX = 3800;
  if (text.length <= MAX) return bot.sendMessage(chatId, text, opts);
  for (let i = 0; i < text.length; i += MAX) {
    await bot.sendMessage(chatId, text.slice(i, i + MAX), opts);
  }
}

// =================== COMMANDS ===================

bot.onText(/^\/start(?:@\w+)?$/, async (msg) => {
  const uid = msg.from.id;
  if (msg.chat && msg.chat.id) chats.add(msg.chat.id);
  const publik = !config.telegram.adminIds.length;
  const adminLine = publik
    ? '🌐 Mode *publik* aktif — semua user boleh pakai bot ini.'
    : (isAdmin(uid)
        ? '✅ Anda terdaftar sebagai *admin*.'
        : `⚠️ Anda *belum* admin. ID Anda: \`${uid}\`. Tambahkan ke .env lalu restart.`);

  const text =
`👋 *Favuser Panel Bot*

Bot ini mengontrol panel Pterodactyl & bot WhatsApp Anda.

${adminLine}

Ketik /help untuk melihat semua perintah.`;
  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
});

bot.onText(/^\/help(?:@\w+)?$/, guard(async (msg) => {
  const text =
`📖 *Daftar Perintah*

🖥️ *Server / Bot WA*
/status — cek status bot WhatsApp
/startbot — nyalakan bot
/stopbot — matikan bot
/restartbot — restart bot
/kill — paksa kill (kalau hang)
/update — git pull && restart
/usage — pemakaian CPU/RAM/Disk

🔑 *Login & Pairing*
/pair <nomor> — minta kode pairing WhatsApp (main bot)
/logout — hapus session WhatsApp & restart
/logout <nomor> — logout + auto-pair nomor setelah bot running

👥 *Manajemen Bot Anak (Sewa)*
/addbot <nomor> <nama> <hari> <owner> — tambah bot anak via PM2
/listbots — daftar bot anak + sisa sewa
/delbot <nomor|nama> — hapus bot anak via PM2
/pruneexpired — bersihkan bot anak yang expired

⚠️ *Catatan PM2*: Bot Rey pakai PM2 untuk multi-bot.\nPastikan panel pakai startup command: npx pm2-runtime ecosystem.config.js

📋 *Konsol & Log*
/logs [n] — n baris terakhir (default 30)
/cmd <perintah> — kirim perintah mentah ke console
/notify on|off — toggle notifikasi otomatis

📁 *File*
/ls [folder] — list file di panel
/cat <path> — baca isi file
/rm <path> — hapus file
/info — info server`;
  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
}));

// ----- STATUS -----
bot.onText(/^\/status(?:@\w+)?$/, guard(async (msg) => {
  const r = await pter.getResources();
  const state = r.current_state || 'unknown';
  const emoji = STATE_EMOJI[state] || '⚪';
  const res = r.resources || {};
  const text =
`${emoji} *Status:* \`${state}\`
Uptime: \`${Math.floor((res.uptime || 0) / 1000)}s\`
CPU: \`${(res.cpu_absolute || 0).toFixed(2)}%\`
RAM: \`${fmtBytes(res.memory_bytes)}\`
Disk: \`${fmtBytes(res.disk_bytes)}\`
NetRx/Tx: \`${fmtBytes(res.network_rx_bytes)} / ${fmtBytes(res.network_tx_bytes)}\``;
  await bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
}));

bot.onText(/^\/usage(?:@\w+)?$/, guard(async (msg) => {
  const r = await pter.getResources();
  const res = r.resources || {};
  await bot.sendMessage(msg.chat.id,
`📊 *Usage*
CPU: ${(res.cpu_absolute || 0).toFixed(2)}%
RAM: ${fmtBytes(res.memory_bytes)}
Disk: ${fmtBytes(res.disk_bytes)}`,
    { parse_mode: 'Markdown' });
}));

// ----- POWER -----
async function powerCmd(msg, signal, label) {
  await bot.sendMessage(msg.chat.id, `🟡 Mengirim *${label}*...`, { parse_mode: 'Markdown' });
  await pter.sendPower(signal);
  await bot.sendMessage(msg.chat.id, `✅ Perintah *${label}* terkirim.`, { parse_mode: 'Markdown' });
}
bot.onText(/^\/startbot(?:@\w+)?$/, guard((m) => powerCmd(m, 'start', 'START')));
bot.onText(/^\/stopbot(?:@\w+)?$/, guard((m) => powerCmd(m, 'stop', 'STOP')));
bot.onText(/^\/restartbot(?:@\w+)?$/, guard((m) => powerCmd(m, 'restart', 'RESTART')));
bot.onText(/^\/kill(?:@\w+)?$/, guard((m) => powerCmd(m, 'kill', 'KILL')));

// ----- UPDATE (git pull + restart) -----
bot.onText(/^\/update(?:@\w+)?$/, guard(async (msg) => {
  await bot.sendMessage(msg.chat.id, '⏳ Menjalankan `git pull`...', { parse_mode: 'Markdown' });
  // collect output for ~6 seconds after the command
  const collected = [];
  const off = hub.onLine((line) => collected.push(line));
  await hub.sendCommand('git pull');
  await new Promise((r) => setTimeout(r, 6000));
  off();

  const out = collected.slice(-25).join('\n') || '(tidak ada output terlihat)';
  await sendLong(msg.chat.id, '📥 *Output git pull:*\n```\n' + out.slice(-3500) + '\n```', { parse_mode: 'Markdown' });

  await bot.sendMessage(msg.chat.id, '🔁 Merestart server...');
  await pter.sendPower('restart');
  await bot.sendMessage(msg.chat.id, '✅ Update + restart terkirim.');
}));

// ----- PAIR helpers -----
function pairRegexFor(number) {
  return new RegExp(config.wa.pairRegex, 'i');
}
function connectedRegexFor(number) {
  const tpl = config.wa.connectedRegex.replace(/\{number\}/g, number);
  return new RegExp(tpl, 'i');
}

async function requestPairingCode(chatId, number, opts = {}) {
  await hub.ensureConnected();

  const menuRe = new RegExp(config.wa.promptMenuRegex, 'i');
  const numRe = new RegExp(config.wa.promptNumberRegex, 'i');

  // State machine: 'await_menu' -> 'menu_picked' -> 'number_sent' -> 'done'
  // Mencegah false trigger saat menu cetak teks "(Masukkan nomor HP)" sebelum user pilih opsi.
  // skipMenu=true dipakai oleh /addbot karena bot Rey langsung minta nomor (tanpa menu).
  let state = opts.skipMenu ? 'menu_picked' : 'await_menu';

  const log = (msg) => console.log(`[pair ${number}] ${msg}`);

  const tryAdvance = async (line) => {
    if (state === 'done') return;
    if (state === 'await_menu' && menuRe.test(line)) {
      state = 'menu_picked';
      log(`menu detected -> sending "${config.wa.pairMenuChoice}"`);
      try { await hub.sendCommand(config.wa.pairMenuChoice); } catch (_) {}
      return;
    }
    if (state === 'menu_picked' && numRe.test(line)) {
      state = 'number_sent';
      log(`number prompt detected -> sending number`);
      try { await hub.sendCommand(number); } catch (_) {}
    }
  };

  // Scan buffer existing dulu (mungkin menu sudah tercetak sebelum kita listen)
  const recent = hub.getRecent(50);
  for (const ln of recent) await tryAdvance(ln);

  const off = hub.onLine((line) => { tryAdvance(line); });

  try {
    // Kalau pairCommand di-set (manual), kirim itu juga (mis. legacy bot yg pakai "pair <nomor>")
    if (config.wa.pairCommand && config.wa.pairCommand.trim()) {
      const seq = config.wa.pairCommand.replace(/\{number\}/g, number).split('\n');
      for (const c of seq) {
        if (c.trim()) await hub.sendCommand(c);
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    // Kalau bot SUDAH di state menu (mungkin baru restart & menunggu), kirim choice setelah delay
    // sebagai fallback jika kita melewatkan event menu (bot tidak print prompt setelah konek WS).
    const menuFallback = setTimeout(async () => {
      if (state === 'await_menu') {
        log('fallback: send menu choice (no prompt detected)');
        try { await hub.sendCommand(config.wa.pairMenuChoice); state = 'menu_picked'; } catch (_) {}
      }
    }, 5000);
    // Setelah menu picked, kalau bot tidak juga prompt nomor, kirim nomor sebagai fallback (sekali)
    let numberFallbackFired = false;
    const numberFallback = setInterval(async () => {
      if (state === 'menu_picked' && !numberFallbackFired) {
        numberFallbackFired = true;
        log('fallback: send number (no number prompt detected)');
        try { await hub.sendCommand(number); state = 'number_sent'; } catch (_) {}
      }
    }, 8000);

    let m, line;
    try {
      // freshOnly: hanya match baris BARU setelah command dikirim
      const res = await hub.waitFor(pairRegexFor(number), config.wa.pairTimeoutMs, { freshOnly: true });
      m = res.match; line = res.line;
    } finally {
      clearTimeout(menuFallback);
      clearInterval(numberFallback);
    }
    state = 'done';
    // Preserve case asli — WA terima case-insensitive tapi tampilkan apa adanya.
    const codeRaw = m[1].replace(/\s/g, '');
    const codePlain = codeRaw.replace(/-/g, '');
    const codeDashed = codePlain.length === 8 ? `${codePlain.slice(0, 4)}-${codePlain.slice(4)}` : codeRaw;
    const ctx = hub.getRecent(8).join('\n');
    await bot.sendMessage(
      chatId,
      `🔑 *Pairing Code* untuk \`${number}\`:\n\n` +
      `      Persis dari panel : \`${codeRaw}\`\n` +
      `      Format dash       : \`${codeDashed}\`\n` +
      `      Tanpa dash        : \`${codePlain}\`\n\n` +
      `Buka WA → *Linked Devices* → *Link with phone number* → masukkan kode di atas (coba salah satu format).\n` +
      `_⏰ Kode WA expired ±60 detik. Segera input!_\n\n` +
      `_Baris match:_ \`${escapeMd(line.slice(0, 200))}\`\n\n` +
      `_Console (8 baris terakhir):_\n\`\`\`\n${ctx.slice(-1500)}\n\`\`\``,
      { parse_mode: 'Markdown' }
    );
    return codeDashed;
  } finally {
    off();
  }
}

// Fungsi untuk menangkap pairing code dari PM2 logs (child bot)
// BotManager print: "[bot_<nomor>] KODE PAIRING: XXXX-XXXX"
async function requestPairingCodeFromPM2(chatId, number, name) {
  await hub.ensureConnected();
  
  const botName = `bot_${number}`;
  const pm2LogRe = new RegExp(
    `\\[${botName}\\].*?(?:pairing[\\s_]*code|kode[\\s_]*pairing).*?((?:[A-Za-z0-9]{4}-[A-Za-z0-9]{4})|(?=[A-Za-z0-9]*\\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{8})`,
    'i'
  );
  
  // Juga tangkap format langsung dari botManager
  const directRe = new RegExp(
    `(?:pairing[\\s_]*code|kode[\\s_]*pairing).*?((?:[A-Za-z0-9]{4}-[A-Za-z0-9]{4})|(?=[A-Za-z0-9]*\\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{8})`,
    'i'
  );
  
  const combinedRe = new RegExp(
    `(?:\\[${botName}\\])?.*?(?:pairing[\\s_]*code|kode[\\s_]*pairing).*?((?:[A-Za-z0-9]{4}-[A-Za-z0-9]{4})|(?=[A-Za-z0-9]*\\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{8})`,
    'i'
  );
  
  const { match: m, line } = await hub.waitFor(combinedRe, config.wa.pairTimeoutMs, { freshOnly: true });
  const codeRaw = m[1].replace(/\s/g, '');
  const codePlain = codeRaw.replace(/-/g, '');
  const codeDashed = codePlain.length === 8 ? `${codePlain.slice(0, 4)}-${codePlain.slice(4)}` : codeRaw;
  
  await bot.sendMessage(
    chatId,
    `🔑 *Pairing Code* untuk bot anak \`${number}\` (${escapeMd(name)}):\n\n` +
    `      Format dash: \`${codeDashed}\`\n` +
    `      Tanpa dash : \`${codePlain}\`\n\n` +
    `Masukkan kode di WhatsApp → Linked Devices → Link with phone number.`,
    { parse_mode: 'Markdown' }
  );
  
  return codeDashed;
}

// ----- PAIR -----
bot.onText(/^\/pair(?:@\w+)?\s+(\S+)\s*$/, guard(async (msg, match) => {
  const nomor = match[1].replace(/\D/g, '');
  if (!nomor) return bot.sendMessage(msg.chat.id, '❌ Nomor tidak valid.');
  await bot.sendMessage(msg.chat.id, `📱 Meminta pairing code untuk \`${nomor}\`...`, { parse_mode: 'Markdown' });
  try {
    await requestPairingCode(msg.chat.id, nomor);
  } catch (e) {
    await bot.sendMessage(msg.chat.id, `⚠️ Timeout / gagal: ${e.message}\nCek /logs.`);
  }
}));

// ----- LOGOUT -----
async function doLogout(chatId) {
  await bot.sendMessage(chatId, '🚪 Logout: menghapus folder session...');
  const sessionDir = config.paths.sessionDir.replace(/^\/+|\/+$/g, '');
  try {
    const parent = '/' + sessionDir.split('/').slice(0, -1).join('/');
    const name = sessionDir.split('/').pop();
    await pter.deleteFiles(parent || '/', [name]);
  } catch (e) {
    await bot.sendMessage(chatId, `⚠️ Gagal hapus via API: ${e.message}\nMencoba via console...`);
    try { await hub.sendCommand(`rm -rf ${config.paths.sessionDir}`); } catch (_) {}
  }
  await pter.sendPower('restart');
}

async function waitRunning(chatId, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  let lastState = null;
  let progressMsgAt = 0;
  while (Date.now() < deadline) {
    try {
      const r = await pter.getResources();
      if (r.current_state === 'running') return true;
      if (r.current_state !== lastState) {
        lastState = r.current_state;
      }
      // Kirim progress tiap 30s supaya user tahu masih jalan
      if (Date.now() - progressMsgAt > 30000) {
        progressMsgAt = Date.now();
        try { await bot.sendMessage(chatId, `⏳ Masih menunggu (panel: \`${lastState}\`)...`, { parse_mode: 'Markdown' }); } catch (_) {}
      }
    } catch (_) {}
    await new Promise((res) => setTimeout(res, 3000));
  }
  return false;
}

bot.onText(/^\/logout(?:@\w+)?(?:\s+(\S+))?$/, guard(async (msg, match) => {
  const nomor = match[1] ? match[1].replace(/\D/g, '') : null;

  await doLogout(msg.chat.id);

  if (!nomor) {
    return bot.sendMessage(msg.chat.id,
      '✅ Session dihapus & bot direstart.\n\n' +
      'Untuk login ulang sekaligus, gunakan: `/logout <nomor>` atau `/pair <nomor>`.',
      { parse_mode: 'Markdown' });
  }

  await bot.sendMessage(msg.chat.id, '⏳ Menunggu bot kembali running untuk pairing...');
  const ok = await waitRunning(msg.chat.id);
  if (!ok) {
    return bot.sendMessage(msg.chat.id, '⚠️ Bot tidak kunjung running. Coba /pair ' + nomor + ' manual.');
  }
  // beri waktu bot WA untuk print menu
  await new Promise((r) => setTimeout(r, 4000));
  await bot.sendMessage(msg.chat.id, `📱 Memulai pairing untuk \`${nomor}\`...`, { parse_mode: 'Markdown' });
  try {
    await requestPairingCode(msg.chat.id, nomor);
  } catch (e) {
    await bot.sendMessage(msg.chat.id, `⚠️ Pairing gagal: ${e.message}\nCek /logs.`);
  }
}));

// ----- ADDBOT -----
bot.onText(/^\/addbot(?:@\w+)?\s+(\S+)\s+(\S+)\s+(\d+)\s+(.+)$/, guard(async (msg, match) => {
  const number = match[1].replace(/\D/g, '');
  const name = match[2];
  const days = Number(match[3]);
  const owner = match[4].trim();
  if (!number || !name || !days) {
    return bot.sendMessage(msg.chat.id, '❌ Format: /addbot <nomor> <nama> <hari> <owner>');
  }

  // Pakai state dari WebSocket (real-time) lebih dulu, fallback ke API.
  let curState = hub.lastState && hub.lastState !== 'unknown' ? hub.lastState : null;
  if (!curState) {
    try { curState = (await pter.getResources()).current_state; } catch (_) {}
  }
  if (curState === 'offline' || curState === 'stopping') {
    return bot.sendMessage(msg.chat.id,
      `⚠️ Bot WA sedang *${curState}*. Jalankan /startbot dulu lalu coba lagi.`,
      { parse_mode: 'Markdown' });
  }
  // running / starting / unknown → lanjut, biarkan pair flow yg handle dgn timeout sendiri

  // Cegah duplikat sebelum lakukan apapun
  const existing = await sewa.load();
  if (existing[number]) {
    return bot.sendMessage(msg.chat.id, `⚠️ Bot dengan nomor \`${number}\` sudah terdaftar.`, { parse_mode: 'Markdown' });
  }

  await bot.sendMessage(msg.chat.id,
    `🟡 Menambahkan bot anak \`${number}\` (${escapeMd(name)})...\n` +
    `1️⃣ Mengirim perintah ke panel\n2️⃣ Meminta pairing code\n3️⃣ Menunggu bot konek`,
    { parse_mode: 'Markdown' });

  await hub.ensureConnected();

  // Bot Rey pakai PM2 untuk spawn child bot.
  // Format command: add_bot <phone> <name> <days> <owner>
  // Bot Rey akan spawn PM2 process baru dan print pairing code ke PM2 logs.
  const cmd = `add_bot ${number} ${name} ${days} ${owner}`;
  await bot.sendMessage(msg.chat.id, `📤 Mengirim command: \`${cmd}\``, { parse_mode: 'Markdown' });
  hub.sendCommand(cmd).catch(() => {});

  // Tunggu sebentar supaya PM2 sempat spawn process
  await new Promise(r => setTimeout(r, 3000));

  // Stage 1: pairing code dari PM2 logs (bukan console langsung)
  // Bot Rey print kode ke PM2 logs, kita perlu tangkap dari situ
  let code;
  try {
    code = await requestPairingCodeFromPM2(msg.chat.id, number, name);
  } catch (e) {
    return bot.sendMessage(msg.chat.id,
      `❌ Gagal mendapatkan pairing code.\n` +
      `Kemungkinan: 1) PM2 belum jalan di panel, 2) Bot Rey tidak support command add_bot.\n` +
      `Cek /logs dan pastikan panel pakai startup command: \`npx pm2-runtime ecosystem.config.js\``, { parse_mode: 'Markdown' });
  }

  // Stage 2: tunggu sampai konek
  await bot.sendMessage(msg.chat.id,
    `⌛ Menunggu bot \`${number}\` selesai login (max ${config.wa.connectTimeoutMs / 1000}s)...\n` +
    `Masukkan kode \`${code}\` di WhatsApp Anda sekarang.`,
    { parse_mode: 'Markdown' });

  let connectedLine = null;
  try {
    const res = await hub.waitFor(connectedRegexFor(number), config.wa.connectTimeoutMs);
    connectedLine = res.line;
  } catch (e) {
    return bot.sendMessage(msg.chat.id,
      `⚠️ Pairing code sudah dikirim, tetapi bot \`${number}\` belum terdeteksi konek dalam ${config.wa.connectTimeoutMs / 1000}s.\n\n` +
      `Bot anak *belum disimpan* sebagai aktif. Kalau Anda yakin sudah konek, jalankan ulang /addbot atau tambah manual setelah cek /logs.`,
      { parse_mode: 'Markdown' });
  }

  // Stage 3: simpan ke sewa.json
  let rec;
  try {
    rec = await sewa.addBot({ number, name, days, owner });
    // tandai status active
    const all = await sewa.load();
    if (all[number]) { all[number].status = 'active'; await sewa.save(all); }
  } catch (e) {
    return bot.sendMessage(msg.chat.id,
      `⚠️ Bot konek tetapi gagal menyimpan sewa: ${e.message}`);
  }

  await bot.sendMessage(msg.chat.id,
`✅ *Bot anak ditambahkan & aktif*
Nomor: \`${number}\`
Nama: \`${name}\`
Owner: \`${owner}\`
Sewa: ${days} hari (sampai ${sewa.fmtDate(rec.expiredAt)})

_Connect log:_ \`${escapeMd(String(connectedLine).slice(0, 150))}\``,
    { parse_mode: 'Markdown' });
}));

bot.onText(/^\/addbot(?:@\w+)?$/, guard(async (msg) => {
  await bot.sendMessage(msg.chat.id, 'Format: `/addbot <nomor> <nama> <hari> <owner>`', { parse_mode: 'Markdown' });
}));

// ----- LISTBOTS -----
bot.onText(/^\/listbots(?:@\w+)?$/, guard(async (msg) => {
  const list = await sewa.listBots();
  if (!list.length) return bot.sendMessage(msg.chat.id, '📭 Belum ada bot anak.');
  const lines = list.map((b, i) =>
    `${i + 1}. *${escapeMd(b.name || '-')}* — \`${b.number}\`\n` +
    `   Owner: ${escapeMd(b.owner || '-')}\n` +
    `   Sisa: ${sewa.remainingDays(b.expiredAt)} _(exp: ${sewa.fmtDate(b.expiredAt)})_`
  );
  await sendLong(msg.chat.id, `👥 *Daftar Bot Anak (${list.length})*\n\n` + lines.join('\n\n'), { parse_mode: 'Markdown' });
}));

// ----- DELBOT -----
bot.onText(/^\/delbot(?:@\w+)?\s+(.+)$/, guard(async (msg, match) => {
  const q = match[1].trim();
  const removed = await sewa.delBot(q);
  hub.sendCommand(`delete_bot ${removed.number}`).catch(() => {});
  await bot.sendMessage(msg.chat.id, `🗑️ Bot anak \`${removed.number}\` (${escapeMd(removed.name || '-')}) dihapus.`, { parse_mode: 'Markdown' });
}));

bot.onText(/^\/delbot(?:@\w+)?$/, guard(async (msg) => {
  await bot.sendMessage(msg.chat.id, 'Format: `/delbot <nomor|nama>`', { parse_mode: 'Markdown' });
}));

// ----- PRUNE EXPIRED -----
bot.onText(/^\/pruneexpired(?:@\w+)?$/, guard(async (msg) => {
  const expired = await sewa.pruneExpired();
  if (!expired.length) return bot.sendMessage(msg.chat.id, '✅ Tidak ada bot expired.');
  for (const b of expired) {
    hub.sendCommand(`delete_bot ${b.number}`).catch(() => {});
  }
  await bot.sendMessage(msg.chat.id,
    `🧹 ${expired.length} bot expired dihapus:\n` +
    expired.map((b) => `- \`${b.number}\` (${escapeMd(b.name || '-')})`).join('\n'),
    { parse_mode: 'Markdown' }
  );
}));

// ----- LOGS -----
bot.onText(/^\/logs(?:@\w+)?(?:\s+(\d+))?$/, guard(async (msg, match) => {
  const n = Math.min(Number(match[1] || 30), 200);
  await hub.ensureConnected();
  // Allow buffer to fill if just connected
  if (hub.getRecent(1).length === 0) await new Promise((r) => setTimeout(r, 1500));
  const lines = hub.getRecent(n);
  if (!lines.length) return bot.sendMessage(msg.chat.id, '📭 Belum ada output console.');
  const text = '📋 *Log (' + lines.length + ' baris):*\n```\n' + lines.join('\n').slice(-3500) + '\n```';
  await sendLong(msg.chat.id, text, { parse_mode: 'Markdown' });
}));

// ----- RAW COMMAND -----
bot.onText(/^\/cmd(?:@\w+)?\s+([\s\S]+)$/, guard(async (msg, match) => {
  const cmd = match[1];
  await hub.ensureConnected();
  const collected = [];
  const off = hub.onLine((l) => collected.push(l));
  await hub.sendCommand(cmd);
  await new Promise((r) => setTimeout(r, 3000));
  off();
  const out = collected.slice(-20).join('\n') || '(no output)';
  await sendLong(msg.chat.id, '```\n' + out.slice(-3500) + '\n```', { parse_mode: 'Markdown' });
}));

// ----- NOTIFY toggle -----
let notifyEnabled = config.watcher.enabled;
bot.onText(/^\/notify(?:@\w+)?\s+(on|off)$/i, guard(async (msg, match) => {
  notifyEnabled = match[1].toLowerCase() === 'on';
  await bot.sendMessage(msg.chat.id, `🔔 Notifikasi otomatis: *${notifyEnabled ? 'ON' : 'OFF'}*`, { parse_mode: 'Markdown' });
}));

// ----- FILE OPS -----
bot.onText(/^\/ls(?:@\w+)?(?:\s+(\S+))?$/, guard(async (msg, match) => {
  const dir = match[1] || '/';
  const files = await pter.listFiles(dir);
  const lines = files.map((f) =>
    `${f.is_file ? '📄' : '📁'} ${f.name}` + (f.is_file ? `  (${fmtBytes(f.size)})` : '/')
  );
  await sendLong(msg.chat.id, `📂 *${escapeMd(dir)}*\n\n` + (lines.join('\n') || '(kosong)'),
    { parse_mode: 'Markdown' });
}));

bot.onText(/^\/cat(?:@\w+)?\s+(\S+)$/, guard(async (msg, match) => {
  const path = match[1];
  const content = await pter.readFile(path);
  await sendLong(msg.chat.id, '```\n' + String(content).slice(0, 3500) + '\n```', { parse_mode: 'Markdown' });
}));

bot.onText(/^\/rm(?:@\w+)?\s+(\S+)$/, guard(async (msg, match) => {
  const p = match[1];
  const idx = p.lastIndexOf('/');
  const root = idx <= 0 ? '/' : p.slice(0, idx);
  const name = p.slice(idx + 1);
  await pter.deleteFiles(root, [name]);
  await bot.sendMessage(msg.chat.id, `🗑️ Dihapus: \`${p}\``, { parse_mode: 'Markdown' });
}));

bot.onText(/^\/info(?:@\w+)?$/, guard(async (msg) => {
  const s = await pter.getServerInfo();
  await bot.sendMessage(msg.chat.id,
`🖥️ *${escapeMd(s.name || '-')}*
Identifier: \`${s.identifier}\`
Node: \`${s.node || '-'}\`
Limits: RAM ${s.limits ? s.limits.memory : '-'}MB | Disk ${s.limits ? s.limits.disk : '-'}MB | CPU ${s.limits ? s.limits.cpu : '-'}%`,
    { parse_mode: 'Markdown' });
}));

// =================== AUTO-NOTIFY ===================
function setupAutoNotify() {
  if (!config.watcher.enabled) return;
  const re = new RegExp('(' + config.watcher.patterns.join('|') + ')', 'i');
  let lastNotifyAt = 0;

  hub.onLine((line) => {
    if (!notifyEnabled) return;
    if (!re.test(line)) return;
    const now = Date.now();
    if (now - lastNotifyAt < 5000) return; // anti-spam
    lastNotifyAt = now;
    const trimmed = line.slice(0, 400);
    for (const id of notifyTargets()) {
      bot.sendMessage(id, `🚨 *Console alert:*\n\`\`\`\n${trimmed}\n\`\`\``, { parse_mode: 'Markdown' })
        .catch(() => {});
    }
  });

  hub.onState((state) => {
    if (!notifyEnabled) return;
    const emoji = STATE_EMOJI[state] || '⚪';
    for (const id of notifyTargets()) {
      bot.sendMessage(id, `${emoji} Status server berubah: *${state}*`, { parse_mode: 'Markdown' })
        .catch(() => {});
    }
  });
}

// =================== EXPIRY CRON ===================
function startExpiryCron() {
  const checkExpiry = async () => {
    try {
      const list = await sewa.listBots();
      const now = Date.now();
      for (const b of list) {
        if (!b.expiredAt) continue;
        const left = b.expiredAt - now;
        // 1 day warning
        if (left > 0 && left < 24 * 60 * 60 * 1000 && !b.warnedExpiry) {
          const all = await sewa.load();
          if (all[b.number]) { all[b.number].warnedExpiry = true; await sewa.save(all); }
          for (const id of notifyTargets()) {
            bot.sendMessage(id,
              `⚠️ Bot anak \`${b.number}\` (${b.name}) akan expired < 24 jam.`,
              { parse_mode: 'Markdown' }).catch(() => {});
          }
        }
      }
      const expired = await sewa.pruneExpired();
      for (const b of expired) {
        hub.sendCommand(`delete_bot ${b.number}`).catch(() => {});
        for (const id of notifyTargets()) {
          bot.sendMessage(id,
            `⛔ Sewa \`${b.number}\` (${b.name}) *expired* — otomatis dihapus & logout.`,
            { parse_mode: 'Markdown' }).catch(() => {});
        }
      }
    } catch (e) {
      console.error('[expiry cron]', e.message);
    }
  };
  setInterval(checkExpiry, 60 * 60 * 1000); // every hour
  setTimeout(checkExpiry, 30000); // first run shortly after boot
}

// =================== STARTUP ===================
(async () => {
  console.log('[boot] Starting Favuser Panel Bot...');
  if (!config.telegram.adminIds.length) {
    console.log('[boot] 🌐 Mode publik aktif (TELEGRAM_ADMIN_IDS kosong) — semua user diizinkan.');
  } else {
    console.log('[boot] Admin IDs:', config.telegram.adminIds.join(', '));
  }

  setupAutoNotify();
  startExpiryCron();

  // Pre-connect console (best-effort)
  hub.ensureConnected().catch((e) => {
    console.warn('[boot] console connect failed (akan retry):', e.message);
  });

  // Notify (admin atau semua chat yang pernah pakai bot) saat online
  for (const id of notifyTargets()) {
    bot.sendMessage(id, '🤖 Favuser Panel Bot online. Ketik /help.').catch(() => {});
  }

  console.log('[boot] Bot ready.');
})();

bot.on('polling_error', (e) => console.error('[polling]', e.message));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));
