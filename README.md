# WA Manager - WhatsApp Multi Account Desktop App

Aplikasi Desktop Windows untuk mengelola banyak akun WhatsApp sekaligus, dilengkapi dengan fitur Broadcast, Warmer, Auto Reply, dan AI Customer Service menggunakan Gemini.

## Fitur Utama

1. **📱 Multi-Account WhatsApp**: Hubungkan banyak nomor WhatsApp sekaligus dalam 1 aplikasi menggunakan WhatsApp Web.
2. **📢 Broadcast Pesan**: Kirim pesan massal dengan fitur delay/jeda waktu agar terhindar dari pemblokiran (anti-spam), bisa melampirkan file/gambar.
3. **🔥 Account Warmer**: Fitur untuk saling berkirim pesan secara otomatis antar akun Anda sendiri untuk "menghangatkan" nomor baru agar terlihat aktif natural.
4. **↩️ Auto Reply**: Balas pesan otomatis berdasarkan kata kunci tertentu.
5. **🤖 AI Customer Service**: Terintegrasi dengan Google Gemini AI untuk membalas pesan pelanggan layaknya Customer Service sungguhan secara otomatis (Gratis menggunakan Gemini API).

## Persyaratan Sistem
- Windows 10 / 11
- Node.js (Versi 18 atau lebih baru)
- RAM Minimal 4GB (Disarankan 8GB untuk multi-akun yang banyak)

---

## Step-by-Step Cara Build menjadi Aplikasi Desktop (Windows .exe)

Ikuti langkah-langkah berikut untuk menjalankan dan mengubah source code ini menjadi aplikasi Windows yang bisa di-install (`.exe`).

### Langkah 1: Buka Terminal / Command Prompt
Buka folder `whatsapp-manager` ini di Visual Studio Code, lalu buka terminal (Ctrl + `).
Atau buka Command Prompt (cmd) dan arahkan ke folder ini:
```bash
cd path/ke/folder/whatsapp-manager
```

### Langkah 2: Install Dependencies (Library yang dibutuhkan)
Jalankan perintah ini untuk mengunduh semua library yang diperlukan (seperti electron, whatsapp-web.js, puppeteer, dll):
```bash
npm install
```
*(Tunggu hingga proses instalasi selesai, mungkin butuh beberapa menit tergantung koneksi internet).*

### Langkah 3: Jalankan Aplikasi Mode Development (Uji Coba)
Sebelum di-build, pastikan aplikasi berjalan normal dengan perintah:
```bash
npm run dev
```
atau
```bash
npm start
```
Aplikasi WA Manager akan terbuka. Anda bisa mencoba menambahkan akun dengan scan QR code.

### Langkah 4: Build Aplikasi menjadi File Installer (.exe)
Jika semuanya sudah berjalan normal, sekarang kita buat installer Windows-nya.
Jalankan perintah berikut:
```bash
npm run build
```

**Catatan selama proses build:**
- Proses ini membutuhkan koneksi internet untuk mengunduh electron-builder binaries.
- Tunggu hingga proses selesai (bisa 2-5 menit).
- Jika berhasil, Anda akan menemukan folder baru bernama `dist/`.

### Langkah 5: Instalasi
Buka folder `dist/` di dalam folder project ini.
Anda akan menemukan file bernama **`WA Manager Setup 1.0.0.exe`**.
File inilah aplikasi desktop Anda. Silakan double-click untuk menginstallnya di komputer Anda atau bagikan ke komputer lain.

---

## Panduan Penggunaan Fitur

### 1. Menambahkan Akun WhatsApp
- Buka tab **Akun**
- Klik **Tambah Akun**
- Masukkan Nama Akun dan ID Akun
- Scan QR Code yang muncul menggunakan WhatsApp di HP Anda (Pilih "Tautkan Perangkat")
- Tunggu status berubah menjadi "Terhubung"

### 2. Broadcast
- Buka tab **Broadcast**
- Pilih akun pengirim (yang sudah terhubung)
- Masukkan daftar nomor tujuan (1 baris = 1 nomor, contoh: 08123456789 atau 628123456789)
- Ketik isi pesan. Opsional: Tambahkan file lampiran.
- Atur delay (Jeda). Semakin lama jeda, semakin aman dari blokir WhatsApp. (Saran: 10-30 detik).
- Klik **Mulai Broadcast**.

### 3. Account Warmer (Pemanasan Akun Baru)
- Syarat: Harus ada **Minimal 2 Akun** yang terhubung di aplikasi.
- Buka tab **Warmer**.
- Pilih pasangan akun yang akan saling chat otomatis.
- Tentukan rentang waktu chat (misal 1 - 5 menit). Aplikasi akan mengirim chat secara random di rentang waktu tersebut.
- Klik **Mulai Warmer**.
- *Biarkan fitur ini berjalan 1-3 hari pada nomor baru sebelum digunakan untuk Broadcast massal.*

### 4. AI Customer Service
- Anda wajib memiliki **API Key Gemini** (Gratis).
- Dapatkan API Key di: [Google AI Studio](https://aistudio.google.com/app/apikey)
- Buka tab **AI CS**, paste API Key tersebut ke kolom yang disediakan.
- Atur *System Prompt*, contoh: `"Kamu adalah Budi, CS dari Toko Sepatu Jaya. Jawab dengan ramah, singkat, dan berbahasa Indonesia."`
- Klik **Simpan Konfigurasi**.
- Aktifkan toggle / switch pada akun WhatsApp yang ingin dipasangkan AI ini.
- AI akan membalas otomatis setiap pesan masuk (kecuali pesan grup).

---

## Troubleshooting (Masalah Umum)

- **QR Code tidak muncul / Loading terus:** Pastikan koneksi internet stabil. Terkadang proses download puppeteer Chromium saat pertama kali jalan butuh waktu lama.
- **Akun sering terputus:** Jangan buka WhatsApp Web / WhatsApp Desktop bawaan secara bersamaan dengan aplikasi ini, karena WhatsApp membatasi jumlah perangkat bertaut yang online bersamaan.
- **Error Build (npm run build):** Pastikan Anda menjalankan perintah ini di Command Prompt biasa (bukan PowerShell dengan Execution Policy terbatas). Jika gagal, coba hapus folder `node_modules` dan jalankan `npm install` lagi.

***
*Dibuat menggunakan Electron.js & whatsapp-web.js*