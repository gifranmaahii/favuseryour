'use strict';

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'chats.json');

function ensure() {
  if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, '[]');
}

function load() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8') || '[]');
  } catch {
    return [];
  }
}

function save(list) {
  ensure();
  fs.writeFileSync(FILE, JSON.stringify(list, null, 2));
}

function add(chatId) {
  const id = Number(chatId);
  if (!Number.isFinite(id)) return;
  const list = load();
  if (!list.includes(id)) {
    list.push(id);
    save(list);
  }
}

function all() {
  return load();
}

function remove(chatId) {
  const id = Number(chatId);
  const list = load().filter((x) => x !== id);
  save(list);
}

module.exports = { add, all, remove };
