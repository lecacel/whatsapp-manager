# WA Manager - WhatsApp Multi Account Desktop App

WA Manager adalah aplikasi desktop Windows untuk mengelola banyak akun WhatsApp dalam satu tempat. Aplikasi ini membantu operasional pesan, broadcast, pemanasan akun, auto reply, dan customer service berbasis AI.

## Fitur Utama

### 1. Multi-Account WhatsApp
- Menghubungkan banyak akun WhatsApp dalam satu aplikasi.
- Setiap akun memiliki sesi dan status koneksi masing-masing.
- Mendukung scan QR Code melalui WhatsApp Web.

### 2. Chat Manager
- Melihat daftar chat dan riwayat pesan.
- Mengirim pesan teks ke kontak atau nomor tujuan.
- Mendukung pengiriman pesan dengan media/lampiran.

### 3. Broadcast Pesan
- Mengirim pesan massal ke banyak nomor tujuan.
- Mendukung pengaturan delay/jeda antar pesan.
- Membantu pengiriman pesan agar lebih teratur dan tidak terlalu agresif.

### 4. Account Warmer
- Mengirim pesan otomatis antar akun WhatsApp yang terhubung.
- Berguna untuk membantu akun baru terlihat lebih aktif secara natural.
- Mendukung pengaturan pasangan akun dan interval pengiriman.

### 5. Auto Reply
- Membalas pesan masuk secara otomatis berdasarkan kata kunci.
- Mendukung beberapa aturan/rule balasan.
- Dapat diaktifkan per akun WhatsApp.

### 6. AI Customer Service
- Terintegrasi dengan Google Gemini AI.
- Membalas pesan pelanggan secara otomatis berdasarkan prompt yang dikonfigurasi.
- Dapat digunakan untuk simulasi customer service, FAQ, dan bantuan pelanggan.

### 7. Serial Key / Lisensi Berjangka
- Mendukung pembatasan penggunaan fitur premium menggunakan serial key.
- Serial key memiliki masa aktif tertentu.
- Lisensi digunakan untuk mengontrol siapa yang dapat memakai fitur premium aplikasi.

### 8. Auto Update
- Mendukung pengecekan update aplikasi.
- Menampilkan informasi versi aplikasi.
- Mendukung proses download dan install update jika update tersedia.

## Fitur Premium

Beberapa fitur aplikasi dapat dibatasi menggunakan sistem lisensi, antara lain:

- Broadcast
- Account Warmer
- Auto Reply
- AI Customer Service

Fitur dasar seperti manajemen akun, chat, informasi aplikasi, update, dan halaman lisensi tetap dapat diakses.

## Spesifikasi Aplikasi

- Platform: Windows Desktop
- Framework: Electron.js
- WhatsApp Engine: whatsapp-web.js
- AI Integration: Google Gemini AI
- Penyimpanan lokal: Electron Store
- Build Installer: electron-builder
- Tipe aplikasi: Desktop app multi-account WhatsApp manager

## Persyaratan Sistem

- Windows 10 / 11
- RAM minimal 4GB, disarankan 8GB atau lebih untuk banyak akun
- Koneksi internet stabil
- WhatsApp aktif pada perangkat pengguna
- API Key Gemini diperlukan jika ingin menggunakan fitur AI Customer Service

## Cara Menjalankan dari Source Code

Install dependency:

```bash
npm install
```

Jalankan aplikasi mode development:

```bash
npm run dev
```

Atau:

```bash
npm start
```

## Cara Build Installer Windows

Jalankan perintah:

```bash
npm run build
```

Jika berhasil, file installer akan tersedia di folder `dist/`.

## Catatan Penggunaan

- Gunakan fitur broadcast dengan jeda pengiriman yang wajar.
- Hindari mengirim pesan massal secara agresif.
- Pastikan akun WhatsApp tidak digunakan bersamaan di WhatsApp Web lain agar sesi tidak mudah terputus.
- Untuk fitur AI Customer Service, pastikan API Key Gemini valid dan prompt sudah dikonfigurasi dengan benar.

## Troubleshooting Umum

- **QR Code tidak muncul:** Pastikan koneksi internet stabil.
- **Akun sering terputus:** Jangan membuka WhatsApp Web lain dengan akun yang sama.
- **Broadcast gagal:** Pastikan akun pengirim sudah terhubung dan nomor tujuan valid.
- **AI tidak membalas:** Pastikan API Key Gemini sudah benar dan fitur AI aktif pada akun terkait.
- **Aplikasi gagal dijalankan:** Pastikan dependency sudah terinstall dengan `npm install`.

---

Dibuat menggunakan Electron.js dan whatsapp-web.js.