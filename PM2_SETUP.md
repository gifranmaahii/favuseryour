# Setup PM2 untuk Bot Rey (wangsapch)

Bot Rey menggunakan PM2 untuk menjalankan multiple child bots dalam satu panel.

## Langkah Setup

### 1. Copy ecosystem.config.js ke Repo wangsapch

File `ecosystem.config.js.example` sudah dibuat. Copy ke repo wangsapch Anda:

```bash
# Di lokal/RDP Anda
cd path/to/wangsapch
copy ecosystem.config.js.example ecosystem.config.js
```

Atau buat file baru `ecosystem.config.js` dengan isi:

```javascript
module.exports = {
  apps: [
    {
      name: 'main',
      script: './index.js',
      args: '--session=session',
      instances: 1,
      exec_mode: 'fork',
      watch: false,
      max_memory_restart: '512M',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      max_restarts: 5,
      min_uptime: '10s'
    }
  ]
};
```

Push ke GitHub:
```bash
git add ecosystem.config.js
git commit -m "add: ecosystem.config.js untuk PM2"
git push
```

### 2. Ubah Startup Command di Panel Pterodactyl

Buka Panel → Server → Startup → Startup Command:

**Ganti dari:**
```bash
if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; if [[ ! -z ${NODE_PACKAGES} ]]; then /usr/local/bin/npm install ${NODE_PACKAGES}; fi; if [[ ! -z ${UNNODE_PACKAGES} ]]; then /usr/local/bin/npm uninstall ${UNNODE_PACKAGES}; fi; if [ -f /home/container/package.json ]; then /usr/local/bin/npm install; fi; if [[ ! -z ${CUSTOM_ENVIRONMENT_VARIABLES} ]]; then vars=$(echo ${CUSTOM_ENVIRONMENT_VARIABLES} | tr ";" "\n"); for line in $vars; do export $line; done fi; /usr/local/bin/${CMD_RUN}
```

**Menjadi:**
```bash
if [[ -d .git ]] && [[ {{AUTO_UPDATE}} == "1" ]]; then git pull; fi; npm install; npx pm2-runtime ecosystem.config.js
```

### 3. Install PM2 (jika belum ada)

Pastikan PM2 terinstall di container. Bisa via Startup Command juga:

```bash
npm install -g pm2 && npx pm2-runtime ecosystem.config.js
```

### 4. Restart Panel

Klik Restart di panel. Sekarang bot akan jalan dengan PM2.

## Cara Kerja

- Main bot (Bot Rey) jalan sebagai process `main` di PM2
- Saat `/addbot` dipanggil dari Telegram, bot Telegram kirim command `add_bot <nomor> <nama> <hari> <owner>` ke console
- Bot Rey spawn child process baru via `pm2 start` dengan nama `bot_<nomor>`
- Child bot print pairing code ke PM2 logs
- Bot Manager di Bot Rey forward logs ke console panel
- Telegram bot tangkap pairing code dan kirim ke chat

## Troubleshooting

**PM2 tidak jalan:**
```bash
# Cek via console panel
pm2 list
pm2 logs
```

**Bot anak tidak spawn:**
Pastikan `add_bot` command diterima Bot Rey. Cek logs:
```bash
/logs 50
```

**Pairing code tidak muncul:**
Mungkin regex tidak match. Cek format output Bot Rey di panel, lalu sesuaikan `WA_PAIR_REGEX` di `.env`.
