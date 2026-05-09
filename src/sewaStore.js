'use strict';

const path = require('path');
const pter = require('./pterodactyl');
const config = require('./config');

const FILE = config.paths.sewaFile;

function nowMs() { return Date.now(); }
function daysFromNow(days) { return nowMs() + Number(days) * 24 * 60 * 60 * 1000; }
function fmtDate(ms) {
  if (!ms) return '-';
  const d = new Date(ms);
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}
function remainingDays(expMs) {
  if (!expMs) return '-';
  const ms = expMs - nowMs();
  if (ms <= 0) return 'EXPIRED';
  const d = Math.floor(ms / (24 * 60 * 60 * 1000));
  const h = Math.floor((ms % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  return `${d} hari ${h} jam`;
}

function isMissingFileError(e) {
  if (!e || !e.response) return false;
  const s = e.response.status;
  if (s === 404) return true;
  // Pterodactyl kadang return 500 DaemonConnectionException untuk file yg belum ada
  // atau saat server offline. Kita treat sebagai "file kosong" agar bot tetap jalan.
  if (s === 500) {
    const data = e.response.data;
    const text = typeof data === 'string' ? data : JSON.stringify(data || {});
    return /DaemonConnection|not.?found|no such file|ENOENT/i.test(text);
  }
  return false;
}

async function load() {
  try {
    const raw = await pter.readFile(FILE);
    if (!raw || !raw.trim()) return {};
    return JSON.parse(raw);
  } catch (e) {
    if (isMissingFileError(e)) return {};
    if (e.message && /JSON/.test(e.message)) return {};
    // Tolerant fallback: log saja, kembalikan kosong agar bot tidak crash.
    console.warn('[sewaStore] load() warning:', e.message);
    return {};
  }
}

async function save(data) {
  try {
    await pter.writeFile(FILE, JSON.stringify(data, null, 2));
  } catch (e) {
    const detail = e.response && e.response.data ? JSON.stringify(e.response.data).slice(0, 300) : e.message;
    throw new Error(`Gagal menyimpan ${FILE}: ${detail}. Pastikan server panel ON & path benar.`);
  }
}

async function addBot({ number, name, days, owner }) {
  const data = await load();
  if (data[number]) {
    throw new Error(`Bot dengan nomor ${number} sudah terdaftar.`);
  }
  data[number] = {
    name,
    owner,
    days: Number(days),
    createdAt: nowMs(),
    expiredAt: daysFromNow(days),
    status: 'pending',
  };
  await save(data);
  return data[number];
}

async function delBot(query) {
  const data = await load();
  // match by number or name
  let key = null;
  if (data[query]) key = query;
  else {
    for (const k of Object.keys(data)) {
      if (data[k].name && data[k].name.toLowerCase() === String(query).toLowerCase()) {
        key = k; break;
      }
    }
  }
  if (!key) throw new Error(`Bot "${query}" tidak ditemukan.`);
  const removed = { number: key, ...data[key] };
  delete data[key];
  await save(data);
  return removed;
}

async function listBots() {
  const data = await load();
  return Object.entries(data).map(([number, v]) => ({ number, ...v }));
}

async function pruneExpired() {
  const data = await load();
  const now = nowMs();
  const expired = [];
  for (const [k, v] of Object.entries(data)) {
    if (v.expiredAt && v.expiredAt <= now) {
      expired.push({ number: k, ...v });
      delete data[k];
    }
  }
  if (expired.length) await save(data);
  return expired;
}

module.exports = {
  load,
  save,
  addBot,
  delBot,
  listBots,
  pruneExpired,
  fmtDate,
  remainingDays,
};
