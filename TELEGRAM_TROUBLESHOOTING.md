# Telegram Integration Troubleshooting

## Error Umum dan Solusinya

### 1. Error: Cannot find module 'telegram'

**Penyebab:** Package `telegram` (GramJS) belum terinstall atau corrupt.

**Solusi:**
```bash
cd whatsapp-manager
npm install telegram@latest --save
```

### 2. Error: MODULE_NOT_FOUND saat import

**Penyebab:** Import path tidak sesuai dengan versi library.

**Solusi:**
```bash
# Hapus node_modules dan install ulang
cd whatsapp-manager
rmdir /s /q node_modules
del package-lock.json
npm install
```

### 3. Error: FLOOD_WAIT atau API_ID_INVALID

**Penyebab:** 
- API credentials invalid
- Terlalu banyak request ke Telegram

**Solusi:**
1. Dapatkan API credentials sendiri dari https://my.telegram.org/apps
2. Ubah `apiId` dan `apiHash` di `telegram-manager.js` constructor:
```javascript
this.apiId = YOUR_API_ID; // Ganti dengan API ID Anda
this.apiHash = 'YOUR_API_HASH'; // Ganti dengan API Hash Anda
```

### 4. Error: Connection timeout atau network error

**Penyebab:** Firewall atau jaringan memblokir koneksi ke Telegram.

**Solusi:**
1. Pastikan firewall tidak memblokir aplikasi
2. Coba menggunakan VPN jika di negara yang memblokir Telegram
3. Periksa koneksi internet

### 5. Error saat authenticate: SESSION_PASSWORD_NEEDED

**Penyebab:** Akun Telegram menggunakan 2FA (Two-Factor Authentication).

**Solusi:**
Tambahkan handler untuk password 2FA di method `initializeClient`:
```javascript
password: async () => {
  // Emit event untuk meminta password 2FA
  account.status = 'waiting_password';
  this.emit('waiting_password', { accountId });
  
  return new Promise((resolve) => {
    account._passwordResolver = resolve;
  });
}
```

### 6. Error: Cannot read property 'message' of undefined

**Penyebab:** Event handler menerima event yang tidak sesuai format.

**Solusi:** Sudah ditangani dengan validasi di `_setupMessageHandler`.

## Instalasi Manual

Jika masalah persist, coba instalasi manual:

```bash
cd whatsapp-manager

# Install dependencies satu per satu
npm install telegram@2.22.2 --save
npm install input@1.0.1 --save
npm install big-integer@1.6.52 --save

# Rebuild native modules untuk Electron
npm install --save-dev electron-rebuild
npx electron-rebuild
```

## Testing Telegram Connection

Buat file test sederhana untuk memverifikasi instalasi:

```javascript
// test-telegram.js
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');

console.log('Telegram library loaded successfully!');
console.log('TelegramClient:', typeof TelegramClient);
console.log('StringSession:', typeof StringSession);
```

Jalankan:
```bash
node test-telegram.js
```

## Mendapatkan API Credentials

1. Buka https://my.telegram.org/
2. Login dengan nomor telepon Telegram Anda
3. Klik "API development tools"
4. Isi form aplikasi:
   - App title: MS-ALL
   - Short name: msall
   - Platform: Desktop
5. Dapatkan `api_id` dan `api_hash`
6. Update di `telegram-manager.js`

## Verifikasi Instalasi Package

Cek apakah package terinstall dengan benar:

```bash
cd whatsapp-manager
npm list telegram
```

Harusnya menampilkan:
```
ms-all@1.0.31 C:\Users\USER\Documents\TestingSaja\whatsapp-manager
└── telegram@2.22.2
```

## Error Logs

Jika error masih terjadi, periksa:
1. Developer Console di aplikasi (Ctrl+Shift+I)
2. Terminal/CMD tempat menjalankan aplikasi
3. File log di `%APPDATA%\ms-all\logs\`

## Error Build: node-gyp rebuild bufferutil

**Penyebab:** Electron-builder mencoba rebuild native modules (bufferutil, utf-8-validate) yang tidak diperlukan.

**Solusi:**

### Opsi 1: Jalankan Script Fix (Recommended)
```bash
fix-build.bat
```

### Opsi 2: Manual Fix
```bash
cd whatsapp-manager

# Hapus build artifacts
rmdir /s /q node_modules\bufferutil\build
rmdir /s /q node_modules\utf-8-validate\build

# Install sebagai optional
npm install --save-optional bufferutil utf-8-validate

# Clean builder cache
rmdir /s /q "%USERPROFILE%\AppData\Local\electron-builder\Cache"

# Build ulang
npm run build
```

### Opsi 3: Build dengan Flag Ignore
```bash
npm run build -- --config.npmRebuild=false
```

**Catatan Penting:**
- Error node-gyp rebuild **TIDAK** mempengaruhi fungsi aplikasi
- Electron-builder akan menggunakan prebuilt binaries
- Native modules ini opsional dan tidak critical untuk aplikasi
- Build tetap berhasil meskipun ada warning/error ini

## Support

Jika masalah tidak terselesaikan:
1. Screenshoot error message lengkap
2. Copy paste output dari `npm list telegram`
3. Versi Node.js: `node --version`
4. Versi Electron: lihat di package.json
5. Jalankan `fix-build.bat` untuk memperbaiki masalah build
