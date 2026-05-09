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
/pair <nomor> — minta kode pairing WhatsApp
/logout — hapus session WhatsApp & restart

👥 *Manajemen Bot Anak (Sewa)*
/addbot <nomor> <nama> <hari> <owner>
/listbots — daftar bot anak + sisa sewa
/delbot <nomor|nama> — hapus bot anak
/pruneexpired — bersihkan bot anak yang expired

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

async function requestPairingCode(chatId, number) {
  await hub.ensureConnected();

  // Auto-respond ke prompt menu / prompt nomor selama proses pairing
  const menuRe = new RegExp(config.wa.promptMenuRegex, 'i');
  const numRe = new RegExp(config.wa.promptNumberRegex, 'i');
  let lastSentAt = 0;
  const sendOnce = async (cmd, key) => {
    const now = Date.now();
    if (now - lastSentAt < 800) return; // anti-double
    lastSentAt = now;
    console.log(`[pair] auto-respond (${key}): ${cmd}`);
    try { await hub.sendCommand(cmd); } catch (_) {}
  };
  const off = hub.onLine((line) => {
    if (menuRe.test(line)) sendOnce('2', 'menu');
    if (numRe.test(line)) sendOnce(number, 'number');
  });

  try {
    // Kirim sequence command awal (multi-line via '\n')
    const seq = config.wa.pairCommand.replace(/\{number\}/g, number).split('\n');
    for (const c of seq) {
      if (c.trim()) await hub.sendCommand(c);
      await new Promise((r) => setTimeout(r, 400));
    }

    // freshOnly: hanya match baris baru setelah command dikirim, bukan kode lama dari buffer
    const { match: m, line } = await hub.waitFor(pairRegexFor(number), config.wa.pairTimeoutMs, { freshOnly: true });
    const codeRaw = m[1].replace(/\s/g, '').toUpperCase();
    const codePlain = codeRaw.replace(/-/g, '');
    const codeDashed = codePlain.length === 8 ? `${codePlain.slice(0, 4)}-${codePlain.slice(4)}` : codeRaw;
    const ctx = hub.getRecent(8).join('\n');
    await bot.sendMessage(
      chatId,
      `🔑 *Pairing Code* untuk \`${number}\`:\n\n` +
      `      Format dash: \`${codeDashed}\`\n` +
      `      Tanpa dash : \`${codePlain}\`\n\n` +
      `Buka WA → *Linked Devices* → *Link with phone number* → masukkan salah satu format di atas.\n` +
      `_⏰ Kode WA expired ±60 detik. Segera input!_\n\n` +
      `_Console (8 baris terakhir):_\n\`\`\`\n${ctx.slice(-1500)}\n\`\`\``,
      { parse_mode: 'Markdown' }
    );
    return codeDashed;
  } finally {
    off();
  }
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
bot.onText(/^\/logout(?:@\w+)?$/, guard(async (msg) => {
  await bot.sendMessage(msg.chat.id, '🚪 Logout: menghapus folder session...');
  // Try delete via files API
  const sessionDir = config.paths.sessionDir.replace(/^\/+|\/+$/g, '');
  try {
    // Resolve parent
    const parent = '/' + sessionDir.split('/').slice(0, -1).join('/');
    const name = sessionDir.split('/').pop();
    await pter.deleteFiles(parent || '/', [name]);
  } catch (e) {
    await bot.sendMessage(msg.chat.id, `⚠️ Gagal hapus via API: ${e.message}\nMencoba via console...`);
    await hub.sendCommand(`rm -rf ${config.paths.sessionDir}`);
  }
  await pter.sendPower('restart');
  await bot.sendMessage(msg.chat.id, '✅ Session dihapus & bot direstart. Silakan /pair untuk login ulang.');
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

  // Cek bot WA harus running. Kalau starting → tunggu, kalau offline/stopping → block.
  try {
    let r = await pter.getResources();
    if (r.current_state === 'offline' || r.current_state === 'stopping') {
      return bot.sendMessage(msg.chat.id,
        `⚠️ Bot WA sedang *${r.current_state}*. Jalankan /startbot dulu lalu coba lagi.`,
        { parse_mode: 'Markdown' });
    }
    if (r.current_state === 'starting') {
      await bot.sendMessage(msg.chat.id, '⏳ Panel masih *starting*, menunggu sampai 🟢 running...', { parse_mode: 'Markdown' });
      const deadline = Date.now() + 90000;
      while (Date.now() < deadline) {
        await new Promise((res) => setTimeout(res, 4000));
        try { r = await pter.getResources(); } catch (_) {}
        if (r.current_state === 'running') break;
        if (r.current_state === 'offline') {
          return bot.sendMessage(msg.chat.id, '❌ Panel berubah jadi *offline*. Coba /startbot lagi.', { parse_mode: 'Markdown' });
        }
      }
      if (r.current_state !== 'running') {
        await bot.sendMessage(msg.chat.id, `⚠️ Panel masih \`${r.current_state}\` setelah 90s — lanjut tetap mencoba addbot.`, { parse_mode: 'Markdown' });
      }
    }
  } catch (_) {}

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
  // Trigger spawn di WA bot (kalau supported). Lalu pair.
  hub.sendCommand(`addbot ${number} ${name} ${days} ${owner}`).catch(() => {});

  // Stage 1: pairing code
  let code;
  try {
    code = await requestPairingCode(msg.chat.id, number);
  } catch (e) {
    return bot.sendMessage(msg.chat.id,
      `❌ Gagal mendapatkan pairing code (timeout ${config.wa.pairTimeoutMs / 1000}s).\n` +
      `Bot anak *belum* tersimpan. Cek /logs untuk error.\n` +
      `Pastikan WA bot mendukung perintah \`pair <nomor>\` di console.`,
      { parse_mode: 'Markdown' });
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
  hub.sendCommand(`delbot ${removed.number}`).catch(() => {});
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
    hub.sendCommand(`delbot ${b.number}`).catch(() => {});
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
        hub.sendCommand(`delbot ${b.number}`).catch(() => {});
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
