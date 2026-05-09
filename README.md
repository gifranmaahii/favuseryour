# Favuser Panel Bot

Telegram bot untuk mengontrol panel **Pterodactyl** + bot **WhatsApp** Anda secara penuh dari Telegram. Tidak perlu lagi membuka panel browser.

Bot ini dirancang untuk dijalankan di **RDP / VPS Anda sendiri**, sehingga jika panel error/mati, bot Telegram tetap berjalan dan bisa dipakai untuk recover.

---

## ✨ Fitur

### 🖥️ Server / Bot WhatsApp
- `/status` — cek status (🟢 running / 🔴 offline / 🟡 starting/stopping)
- `/startbot` `/stopbot` `/restartbot` `/kill` — power control
- `/update` — `git pull` otomatis lalu restart
- `/usage` `/info` — pemakaian CPU/RAM/Disk & info server

### 🔑 Login & Pairing
- `/pair <nomor>` — minta pairing code WhatsApp, kode akan otomatis dikirim ke chat Telegram
- `/logout` — hapus folder session lalu restart (siap login ulang)

### 👥 Manajemen Bot Anak (Reseller)
- `/addbot <nomor> <nama> <hari> <owner>` — tambah bot anak + simpan masa sewa
- `/listbots` — daftar bot anak + sisa masa sewa
- `/delbot <nomor|nama>` — hapus bot anak
- `/pruneexpired` — bersihkan semua yang expired
- **Auto-expire**: tiap jam dicek; bot anak yang habis sewa dihapus otomatis & dilogout

### 📋 Konsol & Log
- `/logs [n]` — n baris terakhir console
- `/cmd <perintah>` — kirim perintah mentah ke console panel
- `/notify on|off` — toggle notifikasi otomatis
- **Auto-notify**: setiap kali console muncul `error / disconnect / fatal / crash`, bot Telegram langsung kirim alert

### 📁 File
- `/ls [folder]` — list file panel
- `/cat <path>` — baca isi file
- `/rm <path>` — hapus file

---

## ⚙️ Persiapan

### 1. Clone & install
```bash
git clone https://github.com/gifranmaahii/favuseryour.git
cd favuseryour
npm install
```

### 2. Buat file `.env`
Salin `.env.example` ke `.env`:
```bash
cp .env.example .env
```

Isi:
```
TELEGRAM_BOT_TOKEN=8746746683:AAFmV3k7yCRm6fVOFJvImM7cZIPPng_tcnk
TELEGRAM_ADMIN_IDS=         # <-- isi ID Telegram Anda
PTERODACTYL_BASE_URL=https://public-server.verlang.id
PTERODACTYL_API_KEY=ptlc_XdmcllsLw4C3FXJSQ0ARpLhOhu9vjVU7HzeqD2e7TN6
PTERODACTYL_SERVER_ID=c0a6e650
```

> Cara dapat **TELEGRAM_ADMIN_IDS**: jalankan bot dulu (`npm start`), kirim `/start` ke bot, lalu lihat ID yang muncul di pesan balasan. Tambahkan ke `.env` lalu restart.

### 3. Jalankan
```bash
npm start
```

### 4. (Opsional) Jalankan permanen di RDP
Pakai **PM2**:
```bash
npm install -g pm2
pm2 start src/index.js --name favuser-bot
pm2 save
pm2 startup
```

Atau pakai **NSSM** untuk Windows Service:
```
nssm install FavuserBot "C:\Program Files\nodejs\node.exe" "C:\path\to\src\index.js"
nssm start FavuserBot
```

---

## 📌 Catatan teknis

- **Pairing code**: bot mengirim perintah `pair <nomor>` ke console panel lalu menunggu output yang mengandung pola pairing code (8 karakter). Pastikan bot WhatsApp Anda mendukung perintah `pair` di stdin/console. Jika nama perintahnya berbeda, edit `/pair` handler di `src/index.js` (cari `hub.sendCommand(\`pair ${nomor}\`)`).
- **Addbot/Delbot**: data sewa disimpan ke `sewa.json` di server Pterodactyl Anda (path bisa diubah via `SEWA_FILE_PATH`). Selain itu, bot juga mengirim perintah `addbot ... ` & `delbot ...` ke console (sesuaikan dengan WA bot Anda).
- **Logout**: menghapus folder yang ditunjuk `SESSION_DIR` (default `/session`) lalu restart server.
- **Auto-notify**: pola yang memicu alert dapat diatur lewat `NOTIFY_PATTERNS` di `.env`.

---

## 🔒 Keamanan

- Hanya user dengan ID di `TELEGRAM_ADMIN_IDS` yang bisa pakai bot.
- Jangan pernah commit `.env` ke GitHub (sudah di-`.gitignore`).
- Token & API key di README ini hanya contoh dari instruksi user — segera **rotate** jika sudah pernah ter-publish.

---

## 🧱 Struktur

```
src/
├── index.js          # entrypoint + semua command handler
├── config.js         # load env
├── pterodactyl.js    # wrapper HTTP + WebSocket Pterodactyl
├── consoleHub.js     # singleton WS console + ring buffer + waitFor
└── sewaStore.js      # CRUD bot anak (sewa.json di panel)
```

---

## License
MIT — gifranmaahii
