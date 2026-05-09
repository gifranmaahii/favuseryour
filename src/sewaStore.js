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

async function load() {
  try {
    const raw = await pter.readFile(FILE);
    if (!raw || !raw.trim()) return {};
    return JSON.parse(raw);
  } catch (e) {
    if (e.response && e.response.status === 404) {
      // not yet created
      return {};
    }
    // try to be tolerant
    if (e.message && /JSON/.test(e.message)) return {};
    throw e;
  }
}

async function save(data) {
  await pter.writeFile(FILE, JSON.stringify(data, null, 2));
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
