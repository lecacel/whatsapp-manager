# Petunjuk Update Aplikasi WA Manager untuk User Awam

Dokumen ini menjelaskan cara kerja update aplikasi desktop **WA Manager** dengan bahasa sederhana.

---

## 1. Apakah aplikasi yang sudah production bisa di-update?

Bisa.

Walaupun aplikasi sudah dibagikan ke user atau sudah dipakai di komputer user, aplikasi masih bisa diperbarui jika ada:

- perbaikan bug
- fitur baru
- perubahan tampilan
- peningkatan keamanan
- optimasi performa

Pada project ini sudah disiapkan sistem **auto-update**, sehingga nantinya aplikasi bisa mengecek versi terbaru dari server update.

---

## 2. Cara kerja auto-update secara sederhana

Bayangkan aplikasi WA Manager seperti aplikasi desktop biasa.

Alurnya seperti ini:

1. Developer membuat versi baru aplikasi.
2. Nomor versi di `package.json` dinaikkan.
   - Contoh:
     - versi lama: `1.0.0`
     - versi baru: `1.0.1`
3. Aplikasi di-build ulang.
4. File hasil build di-upload ke server update.
5. Saat user membuka aplikasi WA Manager, aplikasi akan mengecek apakah ada versi baru.
6. Jika ada update, aplikasi bisa download update.
7. Setelah update selesai di-download, aplikasi bisa install update dan restart.

---

## 3. File penting yang sudah disiapkan

### `package.json`

Di file ini sudah ditambahkan konfigurasi update:

```json
"publish": [
  {
    "provider": "generic",
    "url": "https://your-update-server.com/downloads/"
  }
]
```

Saat ini URL tersebut masih contoh/template.

Nanti harus diganti dengan URL server asli tempat file update di-upload.

Contoh:

```json
"url": "https://domain-anda.com/update/wa-manager/"
```

---

### `main.js`

File ini adalah proses utama aplikasi Electron.

Di file ini sudah ditambahkan sistem auto-update menggunakan `electron-updater`.

Fungsi yang sudah tersedia:

- cek update saat aplikasi dibuka
- memberi informasi jika update tersedia
- memberi informasi jika aplikasi sudah versi terbaru
- menampilkan progress download update
- memberi informasi jika update selesai di-download
- install update dan restart aplikasi
- menangani error update

---

### `preload.js`

File ini menjembatani fitur update agar bisa dipakai dari tampilan aplikasi.

API yang sudah tersedia:

```js
window.api.updater.checkForUpdate()
window.api.updater.downloadUpdate()
window.api.updater.installAndRestart()
window.api.app.getVersion()
```

Event update yang sudah tersedia:

```js
window.api.updater.onChecking(callback)
window.api.updater.onAvailable(callback)
window.api.updater.onNotAvailable(callback)
window.api.updater.onProgress(callback)
window.api.updater.onDownloaded(callback)
window.api.updater.onError(callback)
```

---

## 4. Langkah membuat update versi baru

Misalnya aplikasi saat ini versi `1.0.0`, lalu ingin membuat update menjadi versi `1.0.1`.

### Langkah 1: Ubah versi aplikasi

Buka file:

```text
package.json
```

Cari bagian ini:

```json
"version": "1.0.0"
```

Ubah menjadi:

```json
"version": "1.0.1"
```

Untuk update berikutnya, bisa dinaikkan lagi:

```text
1.0.1 -> 1.0.2
1.0.2 -> 1.0.3
```

Jika update besar:

```text
1.0.0 -> 1.1.0
```

Jika aplikasi benar-benar versi besar baru:

```text
1.0.0 -> 2.0.0
```

---

### Langkah 2: Build aplikasi

Jalankan perintah berikut dari folder project `whatsapp-manager`:

```bash
npm run build
```

Jika berhasil, biasanya akan muncul folder:

```text
dist/
```

Di dalam folder `dist/` akan ada file hasil build seperti:

```text
WA Manager Setup 1.0.1.exe
latest.yml
WA Manager Setup 1.0.1.exe.blockmap
```

Nama file bisa sedikit berbeda tergantung hasil build.

---

### Langkah 3: Upload file update ke server

Upload file dari folder `dist/` ke server update.

File yang penting biasanya:

```text
latest.yml
WA Manager Setup 1.0.1.exe
WA Manager Setup 1.0.1.exe.blockmap
```

File `latest.yml` sangat penting karena dipakai aplikasi untuk mengetahui versi terbaru.

Jika `latest.yml` tidak ada di server, aplikasi tidak bisa membaca update terbaru.

---

### Langkah 4: Pastikan URL update benar

Di `package.json`, bagian ini:

```json
"url": "https://your-update-server.com/downloads/"
```

Harus mengarah ke lokasi tempat file update di-upload.

Misalnya file update bisa diakses di:

```text
https://domain-anda.com/update/wa-manager/latest.yml
```

Maka URL di `package.json` sebaiknya:

```json
"url": "https://domain-anda.com/update/wa-manager/"
```

Perhatikan tanda `/` di akhir URL. Sebaiknya tetap ada.

---

## 5. Contoh struktur file di server update

Misalnya URL update adalah:

```text
https://domain-anda.com/update/wa-manager/
```

Maka isi folder server tersebut kira-kira seperti ini:

```text
/update/wa-manager/
├── latest.yml
├── WA Manager Setup 1.0.1.exe
└── WA Manager Setup 1.0.1.exe.blockmap
```

Aplikasi akan membaca:

```text
https://domain-anda.com/update/wa-manager/latest.yml
```

Lalu dari file itu aplikasi tahu file installer terbaru yang harus di-download.

---

## 6. Cara user mendapatkan update

Jika auto-update sudah aktif dan server sudah benar:

1. User membuka aplikasi WA Manager.
2. Aplikasi mengecek update otomatis.
3. Jika ada update, aplikasi menerima info update tersedia.
4. Aplikasi bisa download update.
5. Setelah download selesai, aplikasi bisa restart dan install versi baru.

Untuk saat ini, kode backend update sudah tersedia.

Jika ingin menampilkan tombol atau notifikasi di tampilan aplikasi, bisa dibuat UI seperti:

- tombol "Cek Update"
- tombol "Download Update"
- tombol "Install dan Restart"
- teks progress download

---

## 7. Contoh pemakaian dari tampilan aplikasi

Jika nanti ingin membuat tombol cek update di halaman aplikasi, contoh kode JavaScript-nya:

```js
async function cekUpdate() {
  const result = await window.api.updater.checkForUpdate();

  if (result.success) {
    console.log('Berhasil cek update:', result.updateInfo);
  } else {
    console.error('Gagal cek update:', result.error);
  }
}
```

Contoh download update:

```js
async function downloadUpdate() {
  const result = await window.api.updater.downloadUpdate();

  if (result.success) {
    console.log('Update sedang/sudah di-download');
  } else {
    console.error('Gagal download update:', result.error);
  }
}
```

Contoh install dan restart:

```js
async function installUpdate() {
  await window.api.updater.installAndRestart();
}
```

Contoh mendengar progress download:

```js
window.api.updater.onProgress((progress) => {
  console.log(`Download update: ${progress.percent}%`);
});
```

---

## 8. Hal penting agar update berhasil

### 1. Versi harus dinaikkan

Kalau versi tidak dinaikkan, aplikasi menganggap tidak ada update.

Contoh benar:

```json
"version": "1.0.1"
```

Bukan tetap:

```json
"version": "1.0.0"
```

---

### 2. File `latest.yml` harus ikut di-upload

Jangan hanya upload file `.exe`.

Upload juga:

```text
latest.yml
```

Karena file ini yang dibaca oleh aplikasi untuk mengetahui versi terbaru.

---

### 3. URL update harus bisa diakses publik

User harus bisa mengakses URL update dari komputer mereka.

Contoh:

```text
https://domain-anda.com/update/wa-manager/latest.yml
```

Jika URL tersebut tidak bisa dibuka di browser, auto-update juga kemungkinan gagal.

---

### 4. Jangan hapus data user saat update

Data user biasanya tersimpan di folder data aplikasi, bukan di folder source code.

Update aplikasi sebaiknya hanya mengganti program, bukan menghapus data akun/user.

---

### 5. Test dulu sebelum dibagikan

Sebelum update diberikan ke user umum:

1. Install versi lama.
2. Upload versi baru ke server.
3. Buka aplikasi versi lama.
4. Pastikan aplikasi mendeteksi update.
5. Download update.
6. Install dan restart.
7. Pastikan versi aplikasi berubah.
8. Pastikan data lama masih aman.

---

## 9. Perintah penting

### Menjalankan aplikasi saat development

```bash
npm start
```

### Build aplikasi Windows

```bash
npm run build
```

### Cek versi package

```bash
npm pkg get version
```

### Naikkan versi patch otomatis

Contoh dari `1.0.0` ke `1.0.1`:

```bash
npm version patch
```

### Naikkan versi minor otomatis

Contoh dari `1.0.0` ke `1.1.0`:

```bash
npm version minor
```

### Naikkan versi major otomatis

Contoh dari `1.0.0` ke `2.0.0`:

```bash
npm version major
```

---

## 10. Istilah sederhana

### Production

Aplikasi sudah siap dipakai user asli.

### Build

Proses mengubah source code menjadi aplikasi installer `.exe`.

### Installer

File yang dipakai user untuk memasang aplikasi.

Contoh:

```text
WA Manager Setup 1.0.1.exe
```

### Auto-update

Fitur agar aplikasi bisa memperbarui dirinya sendiri.

### Server update

Tempat menyimpan file update aplikasi.

### `latest.yml`

File informasi update terbaru yang dibaca oleh aplikasi.

### Version

Nomor versi aplikasi.

Contoh:

```text
1.0.0
1.0.1
1.1.0
2.0.0
```

---

## 11. Alur singkat update

Ringkasnya:

```text
Edit fitur
↓
Naikkan version di package.json
↓
npm run build
↓
Upload isi dist/ ke server update
↓
User buka aplikasi
↓
Aplikasi cek update
↓
Download update
↓
Install dan restart
↓
Aplikasi sudah versi baru
```

---

## 12. Catatan kondisi saat ini

Saat ini project sudah disiapkan untuk auto-update, tapi masih menggunakan URL template:

```text
https://your-update-server.com/downloads/
```

Sebelum benar-benar dipakai production, URL tersebut harus diganti dengan URL server update asli.