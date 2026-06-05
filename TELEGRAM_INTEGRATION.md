# Telegram Integration - Dokumentasi Lengkap

## Status Implementasi ✅

### 1. Backend (SELESAI)
- ✅ `telegram-manager.js` - Manager lengkap dengan GramJS
- ✅ `main.js` - IPC handlers dan event listeners
- ✅ `preload.js` - API bridge untuk renderer
- ✅ `package.json` - Dependency telegram (GramJS)

### 2. Features yang Sudah Terimplementasi
- ✅ Multi-account support
- ✅ Phone authentication dengan kode verifikasi
- ✅ Session persistence (auto-reconnect)
- ✅ Send text messages
- ✅ Send media files
- ✅ Get chats/dialogs
- ✅ Get messages dari chat
- ✅ Real-time message handler
- ✅ License validation integration

## Cara Menggunakan

### 1. Install Dependencies
```bash
cd whatsapp-manager
npm install
```

### 2. Menambahkan Telegram Account
Gunakan API yang sudah ter-expose di `window.api.tg`:

```javascript
// 1. Tambah akun (akan trigger kode verifikasi)
const result = await window.api.tg.addAccount({
  accountId: 'telegram1',
  name: 'Akun Telegram Saya',
  phone: '+6281234567890'
});

// 2. Listen untuk kode verifikasi
window.api.tg.onWaitingCode((data) => {
  console.log('Masukkan kode untuk:', data.phone);
  // Tampilkan modal input kode
});

// 3. Kirim kode verifikasi
await window.api.tg.sendCode({
  accountId: 'telegram1',
  code: '12345' // Kode dari Telegram
});

// 4. Listen untuk koneksi berhasil
window.api.tg.onReady((data) => {
  console.log('Terhubung:', data.info);
});
```

### 3. Mengirim Pesan
```javascript
// Text message
await window.api.tg.sendMessage({
  accountId: 'telegram1',
  chatId: '1234567890', // User/Group ID
  message: 'Hello from MS-ALL!'
});

// Media message
await window.api.tg.sendMessage({
  accountId: 'telegram1',
  chatId: '1234567890',
  message: 'Lihat gambar ini',
  mediaPath: 'C:\\path\\to\\image.jpg'
});
```

### 4. Mendapatkan Chats
```javascript
const result = await window.api.tg.getChats({
  accountId: 'telegram1'
});

if (result.success) {
  result.chats.forEach(chat => {
    console.log(chat.title, chat.unreadCount);
  });
}
```

### 5. Mendapatkan Messages
```javascript
const result = await window.api.tg.getMessages({
  accountId: 'telegram1',
  chatId: '1234567890',
  limit: 50
});

if (result.success) {
  result.messages.forEach(msg => {
    console.log(msg.text, new Date(msg.date * 1000));
  });
}
```

## API Reference

### IPC Channels (Main Process)

#### `tg:add-account`
```javascript
Params: { accountId: string, name: string, phone: string }
Returns: { success: boolean, error?: string }
```

#### `tg:send-code`
```javascript
Params: { accountId: string, code: string }
Returns: { success: boolean, error?: string }
```

#### `tg:get-accounts`
```javascript
Returns: Array<{ id, name, phone, status, info }>
```

#### `tg:send-message`
```javascript
Params: { accountId: string, chatId: string, message: string, mediaPath?: string }
Returns: { success: boolean, messageId?: string, error?: string }
```

#### `tg:get-chats`
```javascript
Params: { accountId: string }
Returns: { success: boolean, chats: Array, error?: string }
```

### Events (Renderer Process)

#### `tg:waiting_code`
```javascript
Data: { accountId: string, phone: string }
```

#### `tg:ready`
```javascript
Data: { accountId: string, info: { phone, firstName, lastName, username } }
```

#### `tg:disconnected`
```javascript
Data: { accountId: string }
```

#### `tg:auth_failure`
```javascript
Data: { accountId: string }
```

#### `tg:error_state`
```javascript
Data: { accountId: string, error: string }
```

## UI Integration (Untuk Developer)

Berikut contoh cara mengintegrasikan UI Telegram ke aplikasi:

### 1. Tambahkan Tab Telegram di Sidebar
```html
<button class="nav-item" data-tab="telegram">
  <span class="nav-icon">📱</span>
  <span class="nav-label">Telegram</span>
  <span class="nav-badge" id="telegramBadge">0</span>
</button>
```

### 2. Tambahkan Content Tab
```html
<div class="tab-content" id="tab-telegram">
  <div class="content-header">
    <h1>Telegram Accounts</h1>
    <button class="btn btn-primary" id="btnAddTelegramAccount">
      Tambah Akun Telegram
    </button>
  </div>
  
  <div id="telegramAccountsGrid" class="accounts-grid"></div>
</div>
```

### 3. Modal untuk Add Account
```html
<div class="modal" id="addTelegramAccountModal">
  <div class="modal-content">
    <div class="modal-header">
      <h2>Tambah Akun Telegram</h2>
      <button class="modal-close" onclick="closeModal('addTelegramAccountModal')">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>Nama Akun</label>
        <input type="text" id="tgAccountName" class="form-control">
      </div>
      <div class="form-group">
        <label>Nomor Telepon (dengan kode negara)</label>
        <input type="text" id="tgAccountPhone" class="form-control" placeholder="+6281234567890">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal('addTelegramAccountModal')">Batal</button>
      <button class="btn btn-primary" id="btnConfirmAddTelegramAccount">Tambah</button>
    </div>
  </div>
</div>
```

### 4. Modal untuk Verification Code
```html
<div class="modal" id="telegramCodeModal">
  <div class="modal-content">
    <div class="modal-header">
      <h2>Verifikasi Telegram</h2>
    </div>
    <div class="modal-body">
      <p>Masukkan kode verifikasi yang dikirim ke <span id="tgPhoneDisplay"></span></p>
      <div class="form-group">
        <input type="text" id="tgVerificationCode" class="form-control" placeholder="12345" maxlength="5">
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="cancelTelegramAuth()">Batal</button>
      <button class="btn btn-primary" id="btnSubmitTelegramCode">Verifikasi</button>
    </div>
  </div>
</div>
```

### 5. JavaScript Event Handlers (di renderer.js)
```javascript
// State
let pendingTelegramAccountId = null;
let currentTelegramAccounts = [];

// Add account handler
document.getElementById('btnAddTelegramAccount')?.addEventListener('click', () => {
  openModal('addTelegramAccountModal');
});

document.getElementById('btnConfirmAddTelegramAccount')?.addEventListener('click', async () => {
  const name = document.getElementById('tgAccountName').value.trim();
  const phone = document.getElementById('tgAccountPhone').value.trim();
  
  if (!name || !phone) {
    showToast('Nama dan nomor telepon wajib diisi', 'error');
    return;
  }
  
  const accountId = 'tg_' + Date.now();
  pendingTelegramAccountId = accountId;
  
  closeModal('addTelegramAccountModal');
  
  const result = await window.api.tg.addAccount({ accountId, name, phone });
  
  if (!result.success) {
    showToast('Gagal menambah akun: ' + result.error, 'error');
    pendingTelegramAccountId = null;
  }
});

// Code verification handler
window.api.tg.onWaitingCode((data) => {
  document.getElementById('tgPhoneDisplay').textContent = data.phone;
  openModal('telegramCodeModal');
});

document.getElementById('btnSubmitTelegramCode')?.addEventListener('click', async () => {
  const code = document.getElementById('tgVerificationCode').value.trim();
  
  if (!code) {
    showToast('Masukkan kode verifikasi', 'error');
    return;
  }
  
  if (!pendingTelegramAccountId) {
    showToast('Tidak ada akun yang menunggu verifikasi', 'error');
    return;
  }
  
  const result = await window.api.tg.sendCode({
    accountId: pendingTelegramAccountId,
    code
  });
  
  if (result.success) {
    document.getElementById('tgVerificationCode').value = '';
  } else {
    showToast('Kode verifikasi salah', 'error');
  }
});

// Ready handler
window.api.tg.onReady((data) => {
  closeModal('telegramCodeModal');
  showToast(`Akun Telegram "${data.info.firstName}" terhubung!`, 'success');
  pendingTelegramAccountId = null;
  refreshTelegramAccounts();
});

// Error handlers
window.api.tg.onAuthFailure((data) => {
  closeModal('telegramCodeModal');
  showToast('Autentikasi gagal', 'error');
  pendingTelegramAccountId = null;
});

window.api.tg.onErrorState((data) => {
  showToast('Error: ' + data.error, 'error');
});

// Refresh accounts
async function refreshTelegramAccounts() {
  currentTelegramAccounts = await window.api.tg.getAccounts();
  renderTelegramAccounts();
  updateTelegramBadge();
}

function renderTelegramAccounts() {
  const grid = document.getElementById('telegramAccountsGrid');
  if (!grid) return;
  
  if (currentTelegramAccounts.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📱</span>
        <h3>Belum ada akun Telegram</h3>
        <p>Klik "Tambah Akun Telegram" untuk menambahkan akun baru</p>
      </div>
    `;
    return;
  }
  
  grid.innerHTML = currentTelegramAccounts.map(acc => `
    <div class="account-card">
      <div class="account-card-header">
        <span class="account-name">${escapeHtml(acc.name)}</span>
        <span class="account-status ${acc.status}">${getTelegramStatusLabel(acc.status)}</span>
      </div>
      <div class="account-info">
        <p><strong>Nomor:</strong> ${escapeHtml(acc.phone)}</p>
        ${acc.info ? `
          <p><strong>Nama:</strong> ${escapeHtml(acc.info.firstName)} ${escapeHtml(acc.info.lastName || '')}</p>
          ${acc.info.username ? `<p><strong>Username:</strong> @${escapeHtml(acc.info.username)}</p>` : ''}
        ` : '<p>Belum terkoneksi</p>'}
      </div>
      <div class="account-actions">
        ${acc.status === 'ready' ? `<button class="btn btn-small btn-secondary" onclick="logoutTelegramAccount('${acc.id}')">Logout</button>` : ''}
        <button class="btn btn-small btn-danger" onclick="removeTelegramAccount('${acc.id}')">Hapus</button>
      </div>
    </div>
  `).join('');
}

function updateTelegramBadge() {
  const readyCount = currentTelegramAccounts.filter(a => a.status === 'ready').length;
  const badge = document.getElementById('telegramBadge');
  if (badge) badge.textContent = readyCount;
}

function getTelegramStatusLabel(status) {
  const labels = {
    initializing: '⏳ Memulai...',
    waiting_code: '🔢 Menunggu Kode',
    authenticating: '🔐 Autentikasi...',
    ready: '✅ Terhubung',
    disconnected: '❌ Terputus',
    error: '⚠️ Error'
  };
  return labels[status] || status;
}

window.logoutTelegramAccount = async function(accountId) {
  if (!confirm('Yakin ingin logout?')) return;
  const result = await window.api.tg.logout({ accountId });
  if (result.success) {
    showToast('Logout berhasil', 'success');
    refreshTelegramAccounts();
  }
};

window.removeTelegramAccount = async function(accountId) {
  if (!confirm('Yakin ingin menghapus akun ini?')) return;
  const result = await window.api.tg.removeAccount({ accountId });
  if (result.success) {
    showToast('Akun berhasil dihapus', 'success');
    refreshTelegramAccounts();
  }
};

window.cancelTelegramAuth = async function() {
  if (pendingTelegramAccountId) {
    await window.api.tg.removeAccount({ accountId: pendingTelegramAccountId });
    pendingTelegramAccountId = null;
  }
  closeModal('telegramCodeModal');
};

// Init on tab switch
if (currentTab === 'telegram') {
  refreshTelegramAccounts();
}
```

## Troubleshooting

### Error: "Cannot find module 'telegram'"
**Solusi:** Jalankan `npm install` di folder whatsapp-manager

### Error: "Phone number is required"
**Solusi:** Pastikan nomor telepon diisi dengan format internasional (+6281234567890)

### Error: "PHONE_CODE_INVALID"
**Solusi:** Kode verifikasi yang dimasukkan salah atau sudah expired. Minta kode baru.

### Session tidak tersimpan
**Solusi:** Periksa electron-store, session otomatis disimpan setelah autentikasi berhasil.

## Production Considerations

### 1. API Credentials
Untuk production, dapatkan API ID dan Hash sendiri dari https://my.telegram.org

Ganti di `telegram-manager.js`:
```javascript
this.apiId = YOUR_API_ID;
this.apiHash = 'YOUR_API_HASH';
```

### 2. Error Handling
Tambahkan proper error handling dan retry logic untuk koneksi yang tidak stabil.

### 3. Rate Limiting
Telegram memiliki rate limits. Implementasikan queue system untuk bulk messaging.

### 4. Security
Session strings sangat sensitif. Pastikan electron-store di-encrypt.

## Support

Untuk pertanyaan dan dukungan, hubungi developer.

---

**Status:** ✅ SIAP DIGUNAKAN
**Library:** GramJS (telegram package)
**License Required:** Ya, untuk fitur messaging
