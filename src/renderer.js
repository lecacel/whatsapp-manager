// ============================================================
// WA Manager - Renderer Process
// ============================================================

let currentAccounts = [];
let currentTab = 'accounts';
let autoReplyRules = [];
let aiConfig = {};
let isLicenseActive = false;

// WhatsApp Webview state
const WA_WEBVIEW_URL = 'https://web.whatsapp.com/';
const WA_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
let waWebviewTabs = [];
let archivedWaWebviewTabs = [];
let activeWaWebviewId = null;
let waWebviewCounter = 0;
let waWebviewInitialized = false;
let waPendingFocusTimeouts = {};
let waIsRenamingTabId = null;
const WA_NOTIFICATION_SOUNDS = {
  bell: { label: 'Bell', frequency: 880, type: 'sine' },
  chime: { label: 'Chime', frequency: 660, type: 'triangle' },
  ping: { label: 'Ping', frequency: 1046, type: 'sine' },
  pop: { label: 'Pop', frequency: 520, type: 'square' },
  alert: { label: 'Alert', frequency: 740, type: 'sawtooth' }
};
let waNotificationAudioContext = null;


// Chat state
let chatAccountId = null;
let chatCurrentContact = null;
let chatMessages = {};
let chatContacts = {};
let chatUnread = {};
let chatLoadingAccounts = new Set();
let chatSelectedMedia = null;
let pendingQrAccountId = null;

// ============================================================
// Utility
// ============================================================
function showToast(message, type = 'info') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

function closeAllModals(exceptId = null) {
  document.querySelectorAll('.modal.show').forEach((modal) => {
    if (modal.id !== exceptId) modal.classList.remove('show');
  });
}

function setWebviewsInteractive(interactive) {
  if (!interactive) {
    Object.keys(waPendingFocusTimeouts).forEach((key) => {
      clearTimeout(waPendingFocusTimeouts[key]);
      delete waPendingFocusTimeouts[key];
    });
  }

  document.querySelectorAll('webview').forEach((webview) => {
    if (interactive) {
      webview.style.pointerEvents = '';
      webview.style.visibility = '';
      webview.removeAttribute('tabindex');
      webview.removeAttribute('inert');
      return;
    }
    webview.style.pointerEvents = 'none';
    webview.style.visibility = 'hidden';
    webview.setAttribute('tabindex', '-1');
    webview.setAttribute('inert', '');
    try { webview.blur(); } catch (e) {}
  });

  if (!interactive) {
    if (window.api?.app?.focusWindow) {
      window.api.app.focusWindow().catch(() => {});
    }
    try { window.focus(); } catch (e) {}
    try { document.body.focus(); } catch (e) {}
  }
}

function syncModalInteractionState() {
  const hasOpenModal = !!document.querySelector('.modal.show');
  setWebviewsInteractive(!hasOpenModal);
}

function forceInputFocus(modal, shouldSelect = false) {
  const firstInput = modal.querySelector('input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled])');
  if (!firstInput) return;

  modal.querySelectorAll('input, textarea, select, button').forEach((el) => {
    el.disabled = false;
    if (el.matches('input, textarea')) el.readOnly = false;
    el.removeAttribute('readonly');
    el.removeAttribute('aria-disabled');
    el.tabIndex = el.dataset.originalTabindex ? Number(el.dataset.originalTabindex) : 0;
  });

  firstInput.focus({ preventScroll: true });
  if (document.activeElement !== firstInput) {
    firstInput.click();
    firstInput.focus({ preventScroll: true });
  }
  if (shouldSelect && typeof firstInput.select === 'function') firstInput.select();
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  closeAllModals(id);
  modal.classList.add('show');
  modal.removeAttribute('aria-hidden');
  syncModalInteractionState();
  requestAnimationFrame(() => {
    forceInputFocus(modal, true);
    setTimeout(() => forceInputFocus(modal), 80);
    setTimeout(() => forceInputFocus(modal), 250);
    setTimeout(() => forceInputFocus(modal), 500);
  });
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('show');
  modal.setAttribute('aria-hidden', 'true');
  syncModalInteractionState();
}
window.closeModal = closeModal;

window.cancelQrModal = async function() {
  const accountId = pendingQrAccountId;
  pendingQrAccountId = null;
  closeModal('qrModal');
  if (accountId) {
    try {
      await window.api.wa.removeAccount({ accountId });
      await refreshAccounts(true);
    } catch (err) {
      console.warn('Gagal membersihkan akun QR pending:', err);
    }
  }
};

document.querySelectorAll('.modal-content').forEach((content) => {
  content.addEventListener('click', (event) => event.stopPropagation());
});

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&')
    .replaceAll('<', '<')
    .replaceAll('>', '>')
    .replaceAll('"', '"')
    .replaceAll("'", '&#039;');
}

function formatTime(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleDateString('id-ID') + ' ' + d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function withTimeout(promise, ms, message = 'Operasi timeout') {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeoutId));
}

function statusLabel(status) {
  const labels = {
    initializing: '⏳ Memulai...',
    qr: '📷 Scan QR',
    authenticated: '🔑 Terautentikasi',
    ready: '✅ Terhubung',
    disconnected: '❌ Terputus',
    error: '⚠️ Error',
    auth_failure: '🔒 Auth Gagal'
  };
  return labels[status] || status;
}

// ============================================================
// Tabs
// ============================================================
document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

async function switchTab(tab) {
  if (!isLicenseActive && ['chat', 'broadcast', 'warmer', 'autoreply', 'ai'].includes(tab)) {
    showToast('Fitur ini termasuk layanan premium. Silakan aktifkan Serial Key terlebih dahulu.', 'error');
    tab = 'settings';
  }

  currentTab = tab;
  document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
  const navBtn = document.querySelector(`.nav-item[data-tab="${tab}"]`);
  if (navBtn) navBtn.classList.add('active');
  document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
  const tabContent = document.getElementById(`tab-${tab}`);
  if (tabContent) tabContent.classList.add('active');

  const mainContent = document.querySelector('.main-content');
  if (mainContent) {
    if (tab === 'chat') {
      mainContent.classList.add('is-chat-active');
    } else {
      mainContent.classList.remove('is-chat-active');
    }
  }

  await refreshAccounts(false, { silent: tab === 'ai', timeoutMs: tab === 'ai' ? 3000 : 8000 });
  syncModalInteractionState();

  if (tab === 'accounts') renderAccounts();
  if (tab === 'chat') refreshChatTab();
  if (tab === 'broadcast') refreshBroadcastTab();
  if (tab === 'warmer') refreshWarmerTab();
  if (tab === 'autoreply') refreshAutoReplyTab();
  if (tab === 'ai') refreshAITab();
  if (tab === 'settings') refreshSettingsTab();
  if (tab === 'about') refreshAboutTab();
}

// ============================================================
// Accounts
// ============================================================
document.getElementById('btnAddAccount').addEventListener('click', () => {
  pendingQrAccountId = null;
  closeAllModals();
  const accountNameInput = document.getElementById('accountName');
  const accountIdInput = document.getElementById('accountId');
  accountNameInput.value = '';
  accountIdInput.value = '';
  accountNameInput.disabled = false;
  accountIdInput.disabled = false;
  accountNameInput.readOnly = false;
  accountIdInput.readOnly = false;
  openModal('addAccountModal');
});

document.getElementById('btnConfirmAddAccount').addEventListener('click', async () => {
  const btn = document.getElementById('btnConfirmAddAccount');
  const name = document.getElementById('accountName').value.trim();
  let accountId = document.getElementById('accountId').value.trim();
  if (!name) {
    showToast('Masukkan nama akun', 'error');
    return;
  }
  if (!accountId) {
    accountId = name.toLowerCase().replace(/[^a-z0-9]/g, '_');
  }
  btn.disabled = true;
  pendingQrAccountId = accountId;
  closeModal('addAccountModal');
  openModal('qrModal');
  document.getElementById('qrCodeContainer').innerHTML = `
    <div class="loading-spinner"></div>
    <p style="color: var(--text-secondary); margin-top: 10px;">Menginisialisasi akun "${escapeHtml(name)}"...</p>
    <p style="color: var(--text-muted); font-size: 12px; margin-top: 5px;">Tunggu sampai QR muncul.</p>
  `;
  try {
    const result = await window.api.wa.addAccount({ accountId, name });
    if (!result.success) {
      pendingQrAccountId = null;
      closeModal('qrModal');
      openModal('addAccountModal');
      showToast(`Gagal tambah akun: ${result.error}`, 'error');
    }
  } catch (err) {
    pendingQrAccountId = null;
    closeModal('qrModal');
    openModal('addAccountModal');
    showToast(`Gagal tambah akun: ${err.message || err}`, 'error');
  } finally {
    btn.disabled = false;
  }
});

async function refreshAccounts(shouldRender = true, options = {}) {
  const { silent = false, timeoutMs = 8000 } = options;
  try {
    const accounts = await withTimeout(window.api.wa.getAccounts(), timeoutMs, 'Memuat akun timeout');
    currentAccounts = Array.isArray(accounts) ? accounts : [];
    updateAccountBadge();
    if (shouldRender && currentTab === 'accounts') renderAccounts();
  } catch (err) {
    console.error('Gagal memuat akun:', err);
    currentAccounts = [];
    updateAccountBadge();
    if (shouldRender && currentTab === 'accounts') renderAccounts();
    if (!silent) showToast(`Gagal memuat akun: ${err.message || err}`, 'error');
  }
}

function updateAccountBadge() {
  const readyCount = currentAccounts.filter((a) => a.status === 'ready').length;
  const badge = document.getElementById('accountBadge');
  if (badge) badge.textContent = readyCount;
}

function renderAccounts() {
  const grid = document.getElementById('accountsGrid');
  if (!grid) return;
  if (currentAccounts.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📱</span>
        <h3>Belum ada akun</h3>
        <p>Klik "Tambah Akun" untuk menambahkan akun WhatsApp baru</p>
      </div>
    `;
    return;
  }
  grid.innerHTML = currentAccounts.map((acc) => `
    <div class="account-card">
      <div class="account-card-header">
        <span class="account-name">${escapeHtml(acc.name)}</span>
        <span class="account-status ${escapeHtml(acc.status)}">${statusLabel(acc.status)}</span>
      </div>
      <div class="account-info">
        <p><strong>ID:</strong> ${escapeHtml(acc.id)}</p>
        ${acc.info ? `
          <p><strong>Nomor:</strong> ${escapeHtml(acc.info.phone || '-')}</p>
          <p><strong>Nama WA:</strong> ${escapeHtml(acc.info.pushname || '-')}</p>
        ` : (acc.status === 'authenticated' ? '<p>🔄 Sedang sinkronisasi data...</p>' : '<p>Belum terkoneksi</p>')}
      </div>
      <div class="account-actions">
        ${acc.status === 'ready' ? `<button class="btn btn-small btn-secondary" onclick="logoutAccount('${escapeHtml(acc.id)}')">🔓 Logout</button>` : ''}
        <button class="btn btn-small btn-danger" onclick="removeAccount('${escapeHtml(acc.id)}')">🗑️ Hapus</button>
      </div>
    </div>
  `).join('');
}

window.logoutAccount = async function(accountId) {
  const result = await window.api.wa.logout({ accountId });
  if (result.success) {
    showToast('Akun berhasil logout', 'success');
    refreshAccounts();
  } else {
    showToast(`Gagal logout: ${result.error}`, 'error');
  }
};

window.removeAccount = async function(accountId) {
  if (!confirm('Yakin ingin menghapus akun ini?')) return;
  const result = await window.api.wa.removeAccount({ accountId });
  if (result.success) {
    if (pendingQrAccountId === accountId) pendingQrAccountId = null;
    showToast('Akun berhasil dihapus', 'success');
    refreshAccounts();
  } else {
    showToast(`Gagal hapus akun: ${result.error}`, 'error');
  }
};

// ============================================================
// WhatsApp Events
// ============================================================
window.api.wa.onQR(({ accountId, qr }) => {
  const container = document.getElementById('qrCodeContainer');
  if (container) {
    container.innerHTML = `
      <img src="https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(qr)}" alt="QR Code">
      <p style="color: var(--text-secondary); margin-top: 12px;">Scan QR ini dengan WhatsApp di HP Anda</p>
      <p style="color: var(--text-muted); font-size: 12px;">Akun: ${escapeHtml(accountId)}</p>
    `;
    openModal('qrModal');
  }
  refreshAccounts();
});

window.api.wa.onReady(({ accountId, info }) => {
  if (pendingQrAccountId === accountId) pendingQrAccountId = null;
  closeModal('qrModal');
  showToast(`Akun "${accountId}" terhubung (${info?.pushname || ''})`, 'success');
  refreshAccounts();
});

window.api.wa.onAuthenticated && window.api.wa.onAuthenticated(({ accountId }) => {
  showToast(`Akun "${accountId}" terautentikasi, sinkronisasi data...`, 'info');
  refreshAccounts();
});

window.api.wa.onDisconnected(({ accountId }) => {
  if (pendingQrAccountId === accountId) pendingQrAccountId = null;
  showToast(`Akun "${accountId}" terputus`, 'warning');
  refreshAccounts();
});

window.api.wa.onAuthFailure(({ accountId }) => {
  if (pendingQrAccountId === accountId) pendingQrAccountId = null;
  closeModal('qrModal');
  showToast(`Autentikasi gagal untuk "${accountId}"`, 'error');
  refreshAccounts();
});

window.api.wa.onErrorState(({ accountId, error }) => {
  if (pendingQrAccountId === accountId) pendingQrAccountId = null;
  closeModal('qrModal');
  showToast(`Akun "${accountId}" error: ${error || 'gagal terhubung'}`, 'error');
  refreshAccounts();
});

window.api.wa.onMessage(({ accountId, message }) => {
  console.log(`[${accountId}]`, message);
  const chatId = message.from;
  ensureChatState(accountId);
  if (!chatMessages[accountId][chatId]) chatMessages[accountId][chatId] = [];
  const exists = chatMessages[accountId][chatId].find(m => m.id === message.id);
  if (!exists) {
    chatMessages[accountId][chatId].push({
      id: message.id, body: message.body, fromMe: false,
      timestamp: message.timestamp * 1000 || Date.now(), from: message.from
    });
  }
  upsertChatContact(accountId, {
    id: chatId,
    name: chatId.replace('@c.us', '').replace('@g.us', ''),
    number: chatId.replace('@c.us', '').replace('@g.us', ''),
    phone: chatId.replace('@c.us', '').replace('@g.us', ''),
    preview: message.body, timestamp: Date.now()
  });
  if (chatCurrentContact && chatCurrentContact.accountId === accountId && chatCurrentContact.chatId === chatId) {
    const msg = {
      id: message.id, body: message.body, fromMe: false,
      timestamp: message.timestamp * 1000 || Date.now(),
      hasMedia: message.hasMedia, type: message.type,
      filename: message.filename || '', mimetype: message.mimetype || ''
    };
    if (accountId === chatAccountId && currentTab === 'chat') {
      appendBubble(msg);
      scrollChatToBottom();
    }
  } else {
    if (!chatUnread[accountId]) chatUnread[accountId] = {};
    chatUnread[accountId][chatId] = (chatUnread[accountId][chatId] || 0) + 1;
  }
  if (accountId === chatAccountId && currentTab === 'chat') {
    renderChatList(document.getElementById('chatSearch')?.value.trim());
  }
});

function appendBubble(msg) {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return;
  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${msg.fromMe ? 'from-me' : 'from-them'}`;
  bubble.textContent = msg.body || msg.caption || '[Media]';
  chatMessages.appendChild(bubble);
}

function scrollChatToBottom() {
  const chatMessages = document.getElementById('chatMessages');
  if (!chatMessages) return;
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderChatList() {
  const chatList = document.getElementById('chatList');
  if (!chatList) return;
  chatList.innerHTML = '<div class="empty-state">Chat list tersedia melalui WhatsApp Web.</div>';
}

// ============================================================
// Broadcast
// ============================================================
function refreshBroadcastTab() {
  const container = document.getElementById('broadcastAccounts');
  if (!container) return;
  const readyAccounts = currentAccounts.filter((a) => a.status === 'ready');
  if (!readyAccounts.length) {
    container.innerHTML = '<p class="text-muted">Hubungkan minimal 1 akun untuk broadcast.</p>';
    return;
  }
  container.innerHTML = readyAccounts.map(a => `
    <div class="toggle-item">
      <label class="checkbox-label">
        <input type="checkbox" name="broadcastAccount" value="${escapeHtml(a.id)}">
        ${escapeHtml(a.name)}
      </label>
    </div>
  `).join('');
  loadBroadcastLog();
}

// WhatsApp Text Formatting Functions
function wrapSelectedText(textarea, before, after) {
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = textarea.value.substring(start, end);
  const newText = textarea.value.substring(0, start) + before + selectedText + after + textarea.value.substring(end);
  textarea.value = newText;
  textarea.focus();
  textarea.setSelectionRange(start + before.length, end + before.length);
}

// Emoticon/Emoji data
const commonEmojis = [
  '😊', '😂', '❤️', '👍', '🙏', '😍', '😭', '🔥', '✨', '💯',
  '🎉', '👏', '🤔', '😅', '😎', '🥰', '😘', '🤗', '🙌', '💪',
  '✅', '❌', '⭐', '💡', '📱', '💰', '🎁', '🏆', '📢', '⚡',
  '🌟', '💖', '😉', '🤩', '😇', '🙂', '😄', '😃', '😀', '🤝',
  '👌', '👀', '💼', '📊', '📈', '💵', '🎯', '🚀', '⏰', '📅',
  '📞', '✉️', '📧', '🌈', '☀️', '🌙', '⭐', '💫', '🎊', '🎈'
];

let emojiPickerVisible = false;

// Toolbar button handlers
document.getElementById('btnBoldText')?.addEventListener('click', () => {
  const textarea = document.getElementById('broadcastMessage');
  wrapSelectedText(textarea, '*', '*');
});

document.getElementById('btnItalicText')?.addEventListener('click', () => {
  const textarea = document.getElementById('broadcastMessage');
  wrapSelectedText(textarea, '_', '_');
});

document.getElementById('btnStrikeText')?.addEventListener('click', () => {
  const textarea = document.getElementById('broadcastMessage');
  wrapSelectedText(textarea, '~', '~');
});

document.getElementById('btnMonospaceText')?.addEventListener('click', () => {
  const textarea = document.getElementById('broadcastMessage');
  wrapSelectedText(textarea, '```', '```');
});

document.getElementById('btnQuoteText')?.addEventListener('click', () => {
  const textarea = document.getElementById('broadcastMessage');
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const selectedText = textarea.value.substring(start, end);
  const lines = selectedText.split('\n');
  const quotedLines = lines.map(line => '> ' + line).join('\n');
  const newText = textarea.value.substring(0, start) + quotedLines + textarea.value.substring(end);
  textarea.value = newText;
  textarea.focus();
});

document.getElementById('btnCodeText')?.addEventListener('click', () => {
  const textarea = document.getElementById('broadcastMessage');
  wrapSelectedText(textarea, '`', '`');
});

document.getElementById('btnEmojiPicker')?.addEventListener('click', () => {
  const picker = document.getElementById('emojiPicker');
  if (!picker) return;
  
  if (emojiPickerVisible) {
    picker.style.display = 'none';
    emojiPickerVisible = false;
  } else {
    if (picker.children.length === 0) {
      commonEmojis.forEach(emoji => {
        const item = document.createElement('div');
        item.className = 'emoji-item';
        item.textContent = emoji;
        item.onclick = () => {
          const textarea = document.getElementById('broadcastMessage');
          const pos = textarea.selectionStart;
          textarea.value = textarea.value.substring(0, pos) + emoji + textarea.value.substring(pos);
          textarea.focus();
          textarea.setSelectionRange(pos + emoji.length, pos + emoji.length);
        };
        picker.appendChild(item);
      });
    }
    picker.style.display = 'grid';
    emojiPickerVisible = true;
  }
});

// Close emoji picker when clicking outside
document.addEventListener('click', (e) => {
  const picker = document.getElementById('emojiPicker');
  const btn = document.getElementById('btnEmojiPicker');
  if (picker && btn && emojiPickerVisible) {
    if (!picker.contains(e.target) && e.target !== btn) {
      picker.style.display = 'none';
      emojiPickerVisible = false;
    }
  }
});

// File preview handler
document.getElementById('broadcastFile')?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  const preview = document.getElementById('broadcastFilePreview');
  if (!preview) return;
  
  if (file) {
    const sizeInMB = (file.size / (1024 * 1024)).toFixed(2);
    const icon = file.type.startsWith('image/') ? '🖼️' : 
                 file.type.startsWith('video/') ? '🎥' : 
                 file.type.startsWith('audio/') ? '🎵' : '📄';
    
    preview.innerHTML = `
      <div class="file-preview-icon">${icon}</div>
      <div class="file-preview-info">
        <div class="file-preview-name">${escapeHtml(file.name)}</div>
        <div class="file-preview-size">${sizeInMB} MB</div>
      </div>
      <button class="file-preview-remove" onclick="clearBroadcastFile()">✕ Hapus</button>
    `;
    preview.style.display = 'flex';
  } else {
    preview.style.display = 'none';
    preview.innerHTML = '';
  }
});

window.clearBroadcastFile = function() {
  const fileInput = document.getElementById('broadcastFile');
  const preview = document.getElementById('broadcastFilePreview');
  if (fileInput) fileInput.value = '';
  if (preview) {
    preview.style.display = 'none';
    preview.innerHTML = '';
  }
};

document.getElementById('btnStartBroadcast')?.addEventListener('click', async () => {
  const accountEls = document.querySelectorAll('input[name="broadcastAccount"]:checked');
  const accountIds = Array.from(accountEls).map(el => el.value);
  const recipientsText = document.getElementById('broadcastNumbers').value.trim();
  const message = document.getElementById('broadcastMessage').value.trim();
  const fileInput = document.getElementById('broadcastFile');
  const minDelay = parseInt(document.getElementById('broadcastMinDelay').value || '5', 10);
  const maxDelay = parseInt(document.getElementById('broadcastMaxDelay').value || '15', 10);
  
  if (!accountIds.length) return showToast('Pilih minimal 1 akun pengirim', 'error');
  if (!recipientsText) return showToast('Masukkan nomor tujuan', 'error');
  if (!message && !fileInput.files.length) return showToast('Masukkan pesan atau file', 'error');
  
  const recipients = recipientsText.split('\n').map(n => n.trim()).filter(Boolean);
  let mediaPath = null;
  
  if (fileInput.files.length) {
    const file = fileInput.files[0];
    // In Electron, we need to read the file and send it to main process
    // file.path is available in Electron but might be empty in some cases
    if (file.path) {
      mediaPath = file.path;
    } else {
      showToast('File path tidak dapat diakses. Pastikan Anda memilih file dari sistem file lokal.', 'error');
      return;
    }
  }
  
  const result = await window.api.broadcast.start({
    accountIds, recipients, message, mediaPath,
    minDelay: minDelay * 1000, maxDelay: maxDelay * 1000
  });
  
  if (result.success) {
    showToast('Broadcast dimulai', 'success');
    // Clear form after successful start
    document.getElementById('broadcastMessage').value = '';
    document.getElementById('broadcastNumbers').value = '';
    clearBroadcastFile();
  } else {
    showToast('Gagal: ' + result.error, 'error');
  }
});

async function loadBroadcastLog() {
  const log = await window.api.broadcast.getList();
  const container = document.getElementById('broadcastLog');
  if (!container) return;
  if (!log || !log.length) {
    container.innerHTML = '<div class="empty-state small"><p>Belum ada riwayat</p></div>';
    return;
  }
  container.innerHTML = log.map(l => `<div class="log-entry">${escapeHtml(l.name)}: ${l.status}</div>`).join('');
}

// ============================================================
// Warmer
// ============================================================
function refreshWarmerTab() {
  renderWarmerPairs();
  updateWarmerStatus();
  loadWarmerLog();
}

function renderWarmerPairs() {
  const container = document.getElementById('warmerAccountPairs');
  if (!container) return;
  const readyAccounts = currentAccounts.filter((a) => a.status === 'ready');
  if (readyAccounts.length < 2) {
    container.innerHTML = '<p class="text-muted">Butuh minimal 2 akun terhubung untuk warmer.</p>';
    return;
  }
  container.innerHTML = `
    <div class="warmer-pair">
      <select class="form-control" id="warmerAcc1">
        ${readyAccounts.map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)}</option>`).join('')}
      </select>
      <span>↔️</span>
      <select class="form-control" id="warmerAcc2">
        ${readyAccounts.map((a, i) => `<option value="${escapeHtml(a.id)}" ${i === 1 ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}
      </select>
    </div>
  `;
}

document.getElementById('btnStartWarmer')?.addEventListener('click', async () => {
  const acc1 = document.getElementById('warmerAcc1')?.value;
  const acc2 = document.getElementById('warmerAcc2')?.value;
  if (acc1 === acc2) return showToast('Pilih 2 akun berbeda', 'error');
  const minInterval = parseInt(document.getElementById('warmerMinInterval').value || '2', 10) * 1000;
  const maxInterval = parseInt(document.getElementById('warmerMaxInterval').value || '6', 10) * 1000;
  const humanMode = document.getElementById('warmerHumanMode').checked;
  const result = await window.api.warmer.start({
    accountPairs: [[acc1, acc2]], minInterval, maxInterval, humanMode
  });
  if (result.success) {
    showToast('Warmer aktif', 'success');
    updateWarmerStatus();
  }
});

document.getElementById('btnStopWarmer')?.addEventListener('click', async () => {
  await window.api.warmer.stop();
  updateWarmerStatus();
});

async function updateWarmerStatus() {
  const status = await window.api.warmer.getStatus();
  const bar = document.getElementById('warmerStatusBar');
  if (!bar) return;
  bar.innerHTML = `<span class="status-dot ${status.running ? 'active' : 'inactive'}"></span> <span>${status.running ? 'Warmer Aktif' : 'Warmer Tidak Aktif'}</span>`;
  document.getElementById('btnStartWarmer').disabled = !!status.running;
  document.getElementById('btnStopWarmer').disabled = !status.running;
}

async function loadWarmerLog() {
  const log = await window.api.warmer.getLog();
  const container = document.getElementById('warmerLog');
  if (container) {
    container.innerHTML = log.map(l => `<div class="log-entry">${formatTime(l.time)}: ${escapeHtml(l.from)} -> ${escapeHtml(l.to)}: ${escapeHtml(l.message)}</div>`).join('');
  }
}

// ============================================================
// Auto Reply Management
// ============================================================
document.getElementById('btnAddRule')?.addEventListener('click', () => {
  document.getElementById('ruleModalTitle').textContent = 'Tambah Rule Baru';
  document.getElementById('ruleEditId').value = '';
  document.getElementById('ruleName').value = '';
  document.getElementById('ruleKeywords').value = '';
  document.getElementById('ruleMatchType').value = 'contains';
  document.getElementById('ruleReply').value = '';
  document.getElementById('rulePriority').value = '0';
  document.getElementById('ruleReplyInGroups').checked = false;
  openModal('addRuleModal');
});

document.getElementById('btnSaveRule')?.addEventListener('click', async () => {
  const id = document.getElementById('ruleEditId').value;
  const name = document.getElementById('ruleName').value.trim();
  const keywords = document.getElementById('ruleKeywords').value.split(',').map(k => k.trim()).filter(Boolean);
  const matchType = document.getElementById('ruleMatchType').value;
  const reply = document.getElementById('ruleReply').value.trim();
  const priority = parseInt(document.getElementById('rulePriority').value || '0', 10);
  const replyInGroups = document.getElementById('ruleReplyInGroups').checked;
  if (!name || !keywords.length || !reply) {
    showToast('Nama, kata kunci, dan balasan wajib diisi', 'error');
    return;
  }
  const ruleData = { name, keywords, matchType, reply, priority, replyInGroups };
  try {
    if (id) {
      await window.api.autoReply.updateRule({ ...ruleData, id });
      showToast('Rule berhasil diperbarui', 'success');
    } else {
      await window.api.autoReply.addRule(ruleData);
      showToast('Rule berhasil ditambahkan', 'success');
    }
    closeModal('addRuleModal');
    refreshAutoReplyTab();
  } catch (err) {
    showToast('Gagal menyimpan rule: ' + err.message, 'error');
  }
});

async function refreshAutoReplyTab() {
  autoReplyRules = await window.api.autoReply.getRules();
  renderAutoReplyAccountToggles();
  renderAutoReplyRules();
  renderAutoReplyLog();
}

async function renderAutoReplyAccountToggles() {
  const container = document.getElementById('autoReplyAccountToggles');
  if (!container) return;
  try {
    if (!currentAccounts.length) {
      currentAccounts = await window.api.wa.getAccounts();
      updateAccountBadge();
    }
    const enabledAccountIds = new Set(await window.api.autoReply.getEnabledAccounts());
    const accountsToRender = currentAccounts.filter(a => a.status === 'ready' || enabledAccountIds.has(a.id));
    if (!accountsToRender.length) {
      container.innerHTML = '<p class="text-muted">Tidak ada akun yang terhubung.</p>';
      return;
    }
    container.innerHTML = accountsToRender.map((acc) => `
      <label class="account-toggle">
        <input type="checkbox" ${enabledAccountIds.has(acc.id) ? 'checked' : ''} onchange="toggleAutoReply('${escapeHtml(acc.id)}', this.checked)">
        <span>
          <strong>${escapeHtml(acc.name || acc.id)}</strong>
          <small>${escapeHtml(acc.status || 'unknown')}</small>
        </span>
      </label>
    `).join('');
  } catch (err) {
    console.error('Failed to render auto reply accounts:', err);
    container.innerHTML = '<p class="text-muted">Gagal memuat akun.</p>';
  }
}

window.toggleAutoReply = async function(accountId, enabled) {
  try {
    await window.api.autoReply.toggle({ accountId, enabled });
    showToast(`Auto reply ${enabled ? 'diaktifkan' : 'dimatikan'} untuk ${accountId}`, 'success');
  } catch (err) {
    showToast('Gagal mengubah status auto reply', 'error');
  }
};

window.editRule = function(id) {
  const rule = autoReplyRules.find(r => r.id === id);
  if (!rule) return;
  document.getElementById('ruleModalTitle').textContent = 'Edit Rule';
  document.getElementById('ruleEditId').value = rule.id;
  document.getElementById('ruleName').value = rule.name;
  document.getElementById('ruleKeywords').value = rule.keywords.join(', ');
  document.getElementById('ruleMatchType').value = rule.matchType || 'contains';
  document.getElementById('ruleReply').value = rule.reply;
  document.getElementById('rulePriority').value = rule.priority || 0;
  document.getElementById('ruleReplyInGroups').checked = !!rule.replyInGroups;
  openModal('addRuleModal');
};

window.deleteRule = async function(ruleId) {
  if (!confirm('Hapus rule ini?')) return;
  try {
    await window.api.autoReply.deleteRule({ ruleId });
    showToast('Rule berhasil dihapus', 'success');
    refreshAutoReplyTab();
  } catch (err) {
    showToast('Gagal menghapus rule', 'error');
  }
};

function renderAutoReplyRules() {
  const container = document.getElementById('autoReplyRules');
  if (!container) return;
  if (!autoReplyRules.length) {
    container.innerHTML = '<div class="empty-state small"><p>Belum ada rule. Klik "Tambah Rule" untuk membuat.</p></div>';
    return;
  }
  container.innerHTML = autoReplyRules.map(r => `
    <div class="rule-card">
      <div class="rule-info">
        <strong>${escapeHtml(r.name)}</strong>
        <span class="rule-keywords">${escapeHtml(r.keywords.join(', '))}</span>
      </div>
      <div class="rule-actions">
        <button class="btn btn-icon" onclick="editRule('${r.id}')">✏️</button>
        <button class="btn btn-icon" onclick="deleteRule('${r.id}')">🗑️</button>
      </div>
    </div>
  `).join('');
}

async function renderAutoReplyLog() {
  const container = document.getElementById('autoReplyLog');
  if (!container) return;
  const logs = await window.api.autoReply.getLog();
  if (!logs || !logs.length) {
    container.innerHTML = '<div class="empty-state small"><p>Belum ada aktivitas</p></div>';
    return;
  }
  container.innerHTML = logs.map(l => `
    <div class="log-entry">
      <span class="log-time">${formatTime(l.time)}</span>
      <span class="log-acc">[${escapeHtml(l.accountId)}]</span>
      <span class="log-msg">Matched: <strong>${escapeHtml(l.ruleName)}</strong></span>
    </div>
  `).join('');
}

// ============================================================
// WhatsApp Webview Multi Account
// ============================================================
function getWaWebviewState() {
  return {
    tabs: waWebviewTabs.map((t) => ({
      id: t.id, title: t.title, customTitle: t.customTitle || '',
      unreadCount: t.unreadCount || 0, hasNewMessage: !!t.hasNewMessage,
      soundKey: t.soundKey || 'bell', partition: t.partition
    })),
    archivedTabs: archivedWaWebviewTabs, activeId: activeWaWebviewId, counter: waWebviewCounter
  };
}

async function saveWaWebviewState() {
  try {
    if (window.api.store) await window.api.store.set('wa_webview_tabs', getWaWebviewState());
  } catch (err) {
    console.warn('Gagal menyimpan state WhatsApp Webview:', err);
  }
}

async function loadWaWebviewState() {
  if (waWebviewInitialized) return;
  waWebviewInitialized = true;
  try {
    if (!window.api.store) { createWaWebviewTab(); return; }
    const saved = await window.api.store.get('wa_webview_tabs');
    if (saved) {
      archivedWaWebviewTabs = Array.isArray(saved.archivedTabs) ? saved.archivedTabs.filter(tab => tab && tab.partition) : [];
    }
    if (saved && Array.isArray(saved.tabs) && saved.tabs.length > 0) {
      waWebviewCounter = Number.isInteger(saved.counter) ? saved.counter : saved.tabs.length + archivedWaWebviewTabs.length;
      saved.tabs.forEach((tab, index) => {
        createWaWebviewTab({
          id: tab.id, title: tab.title || `Akun ${index + 1}`, customTitle: tab.customTitle || '',
          unreadCount: tab.unreadCount || 0, hasNewMessage: !!tab.hasNewMessage,
          soundKey: tab.soundKey || 'bell', partition: tab.partition, save: false, activate: false
        });
      });
      const activeExists = saved.activeId && waWebviewTabs.some((tab) => tab.id === saved.activeId);
      if (waWebviewTabs.length > 0) activateWaWebviewTab(activeExists ? saved.activeId : waWebviewTabs[0].id, false);
    } else {
      createWaWebviewTab();
    }
  } catch (err) {
    console.warn('Gagal memuat state WhatsApp Webview:', err);
    if (waWebviewTabs.length === 0) createWaWebviewTab();
  }
}

function refreshChatTab() {
  if (!waWebviewInitialized) loadWaWebviewState();
  renderWaWebviewTabs();
  if (!waWebviewTabs.length) {
    const empty = document.getElementById('waWebviewEmpty');
    if (empty) empty.style.display = 'flex';
  } else if (!activeWaWebviewId) {
    activateWaWebviewTab(waWebviewTabs[0].id);
  }
}

function createWaWebviewTab(options = {}) {
  try {
    const id = options.id || `wa-webview-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    if (waWebviewTabs.some((tab) => tab.id === id)) return;
    const stage = document.getElementById('waWebviewStage');
    if (!stage) return;
    const tabNumber = waWebviewTabs.length + 1;
    const archivedTab = !options.partition && archivedWaWebviewTabs.length > 0 ? archivedWaWebviewTabs.shift() : null;
    const title = options.title || archivedTab?.title || `Akun ${tabNumber}`;
    let partition = options.partition || archivedTab?.partition;
    if (!partition) {
      waWebviewCounter++;
      partition = `persist:wa-webview-account-${waWebviewCounter}`;
    }
    const webview = document.createElement('webview');
    webview.id = id;
    webview.className = 'wa-webview';
    webview.setAttribute('partition', partition);
    webview.setAttribute('allowpopups', 'true');
    webview.setAttribute('allowusermedia', 'true');
    webview.setAttribute('audiocapture', 'true');
    webview.setAttribute('videocapture', 'true');
    webview.setAttribute('useragent', WA_USER_AGENT);
    webview.setAttribute('webpreferences', 'contextIsolation=true, nodeIntegration=false, javascript=true, enableRemoteModule=false, devTools=false, webSecurity=false, allowRunningInsecureContent=false');
    webview.style.display = 'none';
    webview.addEventListener('did-start-loading', () => updateWaWebviewStatus(id, 'loading'));
    webview.addEventListener('did-stop-loading', () => updateWaWebviewStatus(id, 'ready'));
    webview.addEventListener('did-fail-load', (event) => {
      if (event.errorCode !== -3) {
        updateWaWebviewStatus(id, 'error');
        console.warn(`Webview ${id} failed to load:`, event.errorCode, event.errorDescription);
      }
    });
    webview.addEventListener('page-title-updated', (event) => {
      const rawTitle = String(event.title || '').trim();
      const unreadMatch = rawTitle.match(/^\((\d+)\)/);
      const unreadCount = unreadMatch ? Number(unreadMatch[1]) : 0;
      let cleanTitle = rawTitle.replace(/^\(\d+\)\s*/, '').replace('WhatsApp', '').replace('(', '').replace(')', '').trim();
      const tab = waWebviewTabs.find((item) => item.id === id);
      if (!tab) return;
      let changed = false;
      const previousUnreadCount = tab.unreadCount || 0;
      if (tab.unreadCount !== unreadCount) {
        tab.unreadCount = unreadCount;
        tab.hasNewMessage = unreadCount > 0 && tab.id !== activeWaWebviewId;
        if (unreadCount > previousUnreadCount && tab.id !== activeWaWebviewId) {
          playWaTabNotificationSound(tab);
          showToast(`Pesan baru di ${tab.customTitle || tab.title || 'tab WhatsApp'}`, 'info');
          if (window.api?.notification?.flashFrame) window.api.notification.flashFrame();
        }
        changed = true;
      }
      if (cleanTitle && cleanTitle.length > 0 && cleanTitle.length <= 30 && tab.title !== cleanTitle) {
        tab.title = cleanTitle;
        changed = true;
      }
      if (changed) { renderWaWebviewTabs(); saveWaWebviewState(); }
    });
    stage.appendChild(webview);
    webview.setAttribute('src', WA_WEBVIEW_URL);
    waWebviewTabs.push({
      id, title, customTitle: options.customTitle || archivedTab?.customTitle || '',
      unreadCount: options.unreadCount || archivedTab?.unreadCount || 0,
      hasNewMessage: !!(options.hasNewMessage || archivedTab?.hasNewMessage),
      soundKey: options.soundKey || archivedTab?.soundKey || 'bell',
      partition, webview, status: 'loading'
    });
    renderWaWebviewTabs();
    if (options.activate !== false) activateWaWebviewTab(id, options.save !== false);
    if (options.save !== false) saveWaWebviewState();
  } catch (err) {
    console.error('Error in createWaWebviewTab:', err);
    showToast('Gagal membuka tab: ' + err.message, 'error');
  }
}

function renderWaWebviewTabs() {
  const tabsContainer = document.getElementById('waWebviewTabs');
  if (!tabsContainer) return;
  if (waIsRenamingTabId) return;
  tabsContainer.innerHTML = waWebviewTabs.map((tab, index) => {
    const displayTitle = tab.customTitle || tab.title || `Akun ${index + 1}`;
    const unreadBadge = tab.unreadCount > 0 ? `<span class="wa-webview-tab-unread">${escapeHtml(tab.unreadCount)}</span>` : '';
    const redDot = tab.hasNewMessage || tab.unreadCount > 0 ? '<span class="wa-webview-tab-red-dot" title="Ada pesan baru"></span>' : '';
    const soundOptions = Object.entries(WA_NOTIFICATION_SOUNDS).map(([key, sound]) => (
      `<option value="${escapeHtml(key)}" ${tab.soundKey === key ? 'selected' : ''}>${escapeHtml(sound.label)}</option>`
    )).join('');
    return `
      <div class="wa-webview-tab ${tab.id === activeWaWebviewId ? 'active' : ''} ${redDot ? 'has-new-message' : ''}" role="button" tabindex="0" data-tab-id="${escapeHtml(tab.id)}" title="Klik ikon pensil untuk edit nama tab" onclick="activateWaWebviewTab('${escapeHtml(tab.id)}')" onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateWaWebviewTab('${escapeHtml(tab.id)}'); }">
        <span class="wa-webview-tab-status ${escapeHtml(tab.status || 'ready')}"></span>
        ${redDot}${unreadBadge}
        <span class="wa-webview-tab-title">${escapeHtml(displayTitle)}</span>
        <select class="wa-webview-tab-sound" title="Suara notifikasi tab ini" onclick="event.stopPropagation();" onchange="event.stopPropagation(); setWaWebviewTabSound('${escapeHtml(tab.id)}', this.value)">
          ${soundOptions}
        </select>
        <span class="wa-webview-tab-rename" role="button" tabindex="0" title="Edit nama tab" onclick="event.preventDefault(); event.stopPropagation(); startInlineRenameWaWebviewTab('${escapeHtml(tab.id)}')" onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); startInlineRenameWaWebviewTab('${escapeHtml(tab.id)}'); }">✎</span>
        <span class="wa-webview-tab-close" role="button" tabindex="0" title="Tutup tab" onclick="event.preventDefault(); event.stopPropagation(); closeWaWebviewTab('${escapeHtml(tab.id)}')" onkeydown="if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); closeWaWebviewTab('${escapeHtml(tab.id)}'); }">&times;</span>
      </div>
    `;
  }).join('');
  const empty = document.getElementById('waWebviewEmpty');
  if (empty) empty.style.display = waWebviewTabs.length ? 'none' : 'flex';
}

function clearTaskbarNewMessageBadgeIfNeeded() {
  const hasUnread = waWebviewTabs.some((tab) => (tab.unreadCount || 0) > 0 || tab.hasNewMessage);
  if (!hasUnread && window.api?.notification?.clearBadge) {
    window.api.notification.clearBadge().catch(() => {});
  }
}

function activateWaWebviewTab(id, shouldSave = true) {
  const selectedTab = waWebviewTabs.find((tab) => tab.id === id);
  if (!selectedTab) return;
  if (waPendingFocusTimeouts[id]) {
    clearTimeout(waPendingFocusTimeouts[id]);
    delete waPendingFocusTimeouts[id];
  }
  activeWaWebviewId = id;
  selectedTab.hasNewMessage = false;
  if (selectedTab.unreadCount > 0) selectedTab.unreadCount = 0;
  waWebviewTabs.forEach((tab) => {
    if (tab.webview) {
      if (tab.id === id) {
        tab.webview.classList.add('active');
        tab.webview.style.setProperty('display', 'flex', 'important');
        waPendingFocusTimeouts[id] = setTimeout(() => {
          delete waPendingFocusTimeouts[id];
          try { tab.webview.focus(); } catch(e) {}
        }, 100);
      } else {
        tab.webview.classList.remove('active');
        tab.webview.style.display = 'none';
        try { tab.webview.blur(); } catch(e) {}
      }
    }
  });
  renderWaWebviewTabs();
  syncModalInteractionState();
  clearTaskbarNewMessageBadgeIfNeeded();
  if (shouldSave) saveWaWebviewState();
}
window.activateWaWebviewTab = activateWaWebviewTab;

function commitWaWebviewTabRename(id, value) {
  const tab = waWebviewTabs.find((item) => item.id === id);
  if (!tab) return;
  waIsRenamingTabId = null;
  const trimmed = String(value || '').trim().slice(0, 40);
  tab.customTitle = trimmed;
  renderWaWebviewTabs();
  saveWaWebviewState();
  syncModalInteractionState();
  if (trimmed) {
    showToast(`Nama tab diubah menjadi "${trimmed}"`, 'success');
  } else {
    showToast('Nama custom tab dihapus', 'info');
  }
}

function startInlineRenameWaWebviewTab(id) {
  const tab = waWebviewTabs.find((item) => item.id === id);
  if (!tab) return;
  Object.keys(waPendingFocusTimeouts).forEach((key) => {
    clearTimeout(waPendingFocusTimeouts[key]);
    delete waPendingFocusTimeouts[key];
  });
  const escapedId = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : String(id).replaceAll('"', '\\"');
  const tabButton = document.querySelector(`.wa-webview-tab[data-tab-id="${escapedId}"]`);
  const titleEl = tabButton?.querySelector('.wa-webview-tab-title');
  if (!tabButton || !titleEl) return;
  doInlineRename(titleEl, id);
}

function doInlineRename(titleEl, id) {
  const tab = waWebviewTabs.find((item) => item.id === id);
  if (!tab) return;
  const currentName = tab.customTitle || tab.title || '';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'wa-webview-tab-title-input';
  input.value = currentName;
  input.maxLength = 40;
  input.setAttribute('aria-label', 'Nama tab WhatsApp');
  let committed = false;
  const commit = () => { if (committed) return; committed = true; commitWaWebviewTabRename(id, input.value); };
  const cancel = () => { if (committed) return; committed = true; waIsRenamingTabId = null; renderWaWebviewTabs(); syncModalInteractionState(); };
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('mousedown', (event) => event.stopPropagation());
  input.addEventListener('pointerdown', (event) => event.stopPropagation());
  input.addEventListener('dblclick', (event) => event.stopPropagation());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') { event.preventDefault(); commit(); }
    if (event.key === 'Escape') { event.preventDefault(); cancel(); }
  });
  input.addEventListener('blur', commit);
  titleEl.replaceWith(input);
  waIsRenamingTabId = id;
  setWebviewsInteractive(false);
  requestAnimationFrame(() => { input.focus({ preventScroll: true }); input.select(); });
}
window.startInlineRenameWaWebviewTab = startInlineRenameWaWebviewTab;

function closeWaWebviewTab(id) {
  const index = waWebviewTabs.findIndex((tab) => tab.id === id);
  if (index === -1) return;
  if (waPendingFocusTimeouts[id]) {
    clearTimeout(waPendingFocusTimeouts[id]);
    delete waPendingFocusTimeouts[id];
  }
  const [removed] = waWebviewTabs.splice(index, 1);
  if (removed.webview) removed.webview.remove();
  if (removed.partition) {
    archivedWaWebviewTabs.push({
      title: removed.title, customTitle: removed.customTitle || '',
      unreadCount: removed.unreadCount || 0, hasNewMessage: !!removed.hasNewMessage,
      soundKey: removed.soundKey || 'bell', partition: removed.partition
    });
  }
  if (activeWaWebviewId === id) {
    activeWaWebviewId = null;
    const fallback = waWebviewTabs[index] || waWebviewTabs[index - 1] || waWebviewTabs[0];
    if (fallback) activateWaWebviewTab(fallback.id, false);
  }
  renderWaWebviewTabs();
  saveWaWebviewState();
}
window.closeWaWebviewTab = closeWaWebviewTab;

function setWaWebviewTabSound(id, soundKey) {
  const tab = waWebviewTabs.find((item) => item.id === id);
  if (!tab || !WA_NOTIFICATION_SOUNDS[soundKey]) return;
  tab.soundKey = soundKey;
  playWaTabNotificationSound(tab);
  saveWaWebviewState();
  showToast(`Suara notifikasi "${tab.customTitle || tab.title || 'tab'}" diubah ke ${WA_NOTIFICATION_SOUNDS[soundKey].label}`, 'success');
}
window.setWaWebviewTabSound = setWaWebviewTabSound;

function playWaTabNotificationSound(tab) {
  try {
    const sound = WA_NOTIFICATION_SOUNDS[tab?.soundKey] || WA_NOTIFICATION_SOUNDS.bell;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    if (!waNotificationAudioContext) waNotificationAudioContext = new AudioContext();
    if (waNotificationAudioContext.state === 'suspended') waNotificationAudioContext.resume().catch(() => {});
    const now = waNotificationAudioContext.currentTime;
    const oscillator = waNotificationAudioContext.createOscillator();
    const gain = waNotificationAudioContext.createGain();
    oscillator.type = sound.type;
    oscillator.frequency.setValueAtTime(sound.frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(120, sound.frequency * 0.72), now + 0.16);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    oscillator.connect(gain);
    gain.connect(waNotificationAudioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.26);
  } catch (err) {
    console.warn('Gagal memainkan suara notifikasi tab:', err);
  }
}

function updateWaWebviewStatus(id, status) {
  const tab = waWebviewTabs.find((item) => item.id === id);
  if (!tab) return;
  tab.status = status;
  renderWaWebviewTabs();
}

function initWaWebviewListeners() {
  const btnHeader = document.getElementById('btnAddWaWebview');
  const btnEmpty = document.getElementById('btnCreateFirstWaWebview');
  btnHeader?.addEventListener('click', () => createWaWebviewTab());
  btnEmpty?.addEventListener('click', () => createWaWebviewTab());
}

// ============================================================
// AI CS
// ============================================================
async function refreshAITab() {
  renderAIAccountToggles();
  try {
    aiConfig = await window.api.ai.getConfig();
  } catch (err) {
    console.error('Gagal memuat konfigurasi AI:', err);
    aiConfig = {};
    showToast(`Gagal memuat konfigurasi AI: ${err.message || err}`, 'error');
  }
  const providerSelect = document.getElementById('aiProvider');
  if (providerSelect) {
    providerSelect.value = aiConfig.provider || 'gemini';
    const geminiSection = document.getElementById('geminiConfigSection');
    const openaiSection = document.getElementById('openaiConfigSection');
    const updateSections = (provider) => {
      if (geminiSection) geminiSection.style.display = provider === 'gemini' ? 'block' : 'none';
      if (openaiSection) openaiSection.style.display = provider === 'openai' ? 'block' : 'none';
    };
    updateSections(providerSelect.value);
    providerSelect.onchange = (e) => updateSections(e.target.value);
  }
  const input = document.getElementById('aiApiKey');
  if (input) input.value = aiConfig.apiKey || '';
  const modelSelect = document.getElementById('aiModel');
  if (modelSelect) modelSelect.value = aiConfig.model || 'gemini-2.5-flash';
  const openAIBaseUrlInput = document.getElementById('aiOpenAIBaseUrl');
  if (openAIBaseUrlInput) openAIBaseUrlInput.value = aiConfig.openaiBaseUrl || '';
  const openaiApiKeyInput = document.getElementById('aiOpenAIApiKey');
  if (openaiApiKeyInput) openaiApiKeyInput.value = aiConfig.openaiApiKey || '';
  const openaiModelInput = document.getElementById('aiOpenAIModel');
  if (openaiModelInput) openaiModelInput.value = aiConfig.openaiModel || '';
  const autoFallbackInput = document.getElementById('aiAutoFallback');
  if (autoFallbackInput) autoFallbackInput.checked = aiConfig.autoFallback !== false;
  const promptInput = document.getElementById('aiSystemPrompt');
  if (promptInput) promptInput.value = aiConfig.systemPrompt || '';
  const maxTokensInput = document.getElementById('aiMaxTokens');
  if (maxTokensInput) maxTokensInput.value = aiConfig.maxTokens || 500;
  renderAILog();
}

async function renderAIAccountToggles() {
  const container = document.getElementById('aiAccountToggles');
  if (!container) return;
  container.innerHTML = '<p class="text-muted">Memuat akun...</p>';
  let accounts = Array.isArray(currentAccounts) ? [...currentAccounts] : [];
  let accountLoadError = null;
  if (!accounts.length) {
    try {
      const loadedAccounts = await withTimeout(window.api.wa.getAccounts(), 5000, 'Memuat akun timeout');
      accounts = Array.isArray(loadedAccounts) ? loadedAccounts : [];
      currentAccounts = accounts;
      updateAccountBadge();
    } catch (err) {
      accountLoadError = err;
      console.error('Failed to get WA accounts for AI toggles:', err);
    }
  }
  let enabledAccountIds = new Set();
  try {
    const enabledList = await withTimeout(window.api.ai.getEnabledAccounts(), 5000, 'Memuat daftar akun AI aktif timeout');
    if (Array.isArray(enabledList)) enabledAccountIds = new Set(enabledList);
  } catch (err) {
    console.warn('Failed to get enabled AI accounts, using empty set:', err);
  }
  const accountsToRender = accounts;
  if (!accountsToRender.length) {
    container.innerHTML = accountLoadError
      ? '<p class="text-muted">Gagal memuat akun. Coba buka tab Akun atau restart aplikasi.</p>'
      : '<p class="text-muted">Belum ada akun WhatsApp. Tambahkan akun terlebih dahulu di menu Akun.</p>';
    return;
  }
  container.innerHTML = accountsToRender.map((acc) => `
    <label class="account-toggle">
      <input type="checkbox" ${enabledAccountIds.has(acc.id) ? 'checked' : ''} onchange="toggleAI('${escapeHtml(acc.id)}', this.checked)">
      <span>
        <strong>${escapeHtml(acc.name || acc.id)}</strong>
        <small>${escapeHtml(statusLabel(acc.status || 'unknown'))}</small>
      </span>
    </label>
  `).join('');
}

window.toggleAI = async function(accountId, enabled) {
  try {
    await window.api.ai.toggle({ accountId, enabled });
    showToast(`AI CS ${enabled ? 'diaktifkan' : 'dimatikan'} untuk ${accountId}`, 'success');
  } catch (err) {
    showToast('Gagal mengubah status AI CS', 'error');
  }
};

async function renderAILog() {
  const container = document.getElementById('aiLog');
  if (!container) return;
  let logs = [];
  try { logs = await window.api.ai.getLog(); } catch (err) {
    console.error('Gagal memuat log AI:', err);
    container.innerHTML = '<div class="empty-state small"><p>Gagal memuat log AI.</p></div>';
    return;
  }
  if (!logs || !logs.length) {
    container.innerHTML = '<div class="empty-state small"><p>Belum ada aktivitas</p></div>';
    return;
  }
  container.innerHTML = logs.map(l => `
    <div class="log-entry">
      <div class="log-header">
        <span class="log-time">${formatTime(l.time)}</span>
        <span class="log-acc">[${escapeHtml(l.accountId)}]</span>
        <span class="log-to">To: ${escapeHtml(l.contactName || l.from)}</span>
        <span class="log-status status-${l.status}">${l.status === 'sent' ? '✅' : '❌'}</span>
      </div>
      <div class="log-body">
        <div class="log-msg"><strong>User:</strong> ${escapeHtml(l.userMessage)}</div>
        <div class="log-reply"><strong>AI:</strong> ${escapeHtml(l.aiResponse || (l.error ? 'Error: ' + l.error : '...'))}</div>
      </div>
    </div>
  `).join('');
}

document.getElementById('btnSaveAIConfig')?.addEventListener('click', async () => {
  const provider = document.getElementById('aiProvider').value;
  const apiKey = document.getElementById('aiApiKey').value.trim();
  const model = document.getElementById('aiModel').value;
  const openaiBaseUrl = document.getElementById('aiOpenAIBaseUrl').value.trim();
  const openaiApiKey = document.getElementById('aiOpenAIApiKey').value.trim();
  const openaiModel = document.getElementById('aiOpenAIModel').value.trim();
  const autoFallback = document.getElementById('aiAutoFallback').checked;
  const systemPrompt = document.getElementById('aiSystemPrompt').value.trim();
  const maxTokens = parseInt(document.getElementById('aiMaxTokens').value || '500', 10);
  if (provider === 'gemini' && !apiKey) {
    showToast('Gemini API Key wajib diisi jika menggunakan Gemini sebagai provider utama', 'error');
    return;
  }
  if (provider === 'openai' && !openaiApiKey) {
    showToast('OpenAI API Key wajib diisi jika menggunakan OpenAI Compatible sebagai provider utama', 'error');
    return;
  }
  try {
    await window.api.ai.setConfig({ provider, apiKey, model, openaiBaseUrl, openaiApiKey, openaiModel, autoFallback, systemPrompt, maxTokens });
    showToast('Konfigurasi AI berhasil disimpan', 'success');
  } catch (err) {
    showToast('Gagal menyimpan konfigurasi: ' + err.message, 'error');
  }
});

document.getElementById('btnTestAI')?.addEventListener('click', async () => {
  const message = document.getElementById('aiTestMessage').value.trim();
  if (!message) return;
  const btn = document.getElementById('btnTestAI');
  const resultDiv = document.getElementById('aiTestResult');
  const responseP = document.getElementById('aiTestResponse');
  btn.disabled = true;
  resultDiv.style.display = 'block';
  responseP.textContent = 'Berpikir...';
  try {
    const result = await window.api.ai.test({ message });
    if (result.success) responseP.textContent = result.response;
    else responseP.textContent = 'Error: ' + result.error;
  } catch (err) {
    responseP.textContent = 'Error: ' + err.message;
  } finally {
    btn.disabled = false;
  }
});

// ============================================================
// License / Serial Key
// ============================================================
async function checkLicenseStatus() {
  try {
    const result = await window.api.license.check();
    isLicenseActive = result.active;
    const dot = document.getElementById('licenseDot');
    const statusText = document.getElementById('licenseStatusText');
    const details = document.getElementById('licenseDetails');
    const expiryEl = document.getElementById('licenseExpiry');
    const daysLeftEl = document.getElementById('licenseDaysLeft');
    const machineIdDisplay = document.getElementById('machineIdDisplay');
    if (machineIdDisplay) machineIdDisplay.value = result.machineId;
    if (result.active) {
      dot?.classList.remove('inactive');
      dot?.classList.add('active');
      if (statusText) statusText.textContent = 'Lisensi Aktif';
      if (details) details.style.display = 'block';
      if (expiryEl) expiryEl.textContent = formatDate(result.expiresAt);
      if (daysLeftEl) daysLeftEl.textContent = result.daysLeft;
    } else {
      dot?.classList.remove('active');
      dot?.classList.add('inactive');
      if (statusText) statusText.textContent = result.error || 'Lisensi Tidak Aktif';
      if (details) details.style.display = 'none';
    }
    updateFeatureRestrictions();
  } catch (err) {
    console.error('Gagal mengecek lisensi:', err);
  }
}

function updateFeatureRestrictions() {
  const restrictedTabs = ['chat', 'broadcast', 'warmer', 'autoreply', 'ai'];
  restrictedTabs.forEach(tab => {
    const navBtn = document.querySelector(`.nav-item[data-tab="${tab}"]`);
    if (navBtn) {
      if (isLicenseActive) { navBtn.style.opacity = '1'; navBtn.style.cursor = 'pointer'; navBtn.title = ''; }
      else { navBtn.style.opacity = '0.5'; navBtn.style.cursor = 'not-allowed'; navBtn.title = 'Fitur ini memerlukan Serial Key aktif'; }
    }
  });
  if (!isLicenseActive && restrictedTabs.includes(currentTab)) {
    showToast('Akses dibatasi. Silakan aktifkan Serial Key.', 'error');
    switchTab('settings');
  }
}

async function refreshSettingsTab() {
  await checkLicenseStatus();
  refreshUpdateTab();
  refreshNotificationSoundPath();
}

async function refreshLicenseTab() {
  await checkLicenseStatus();
}

// ============================================================
// Custom Notification Sound
// ============================================================
let customNotificationFilePath = null;

async function refreshNotificationSoundPath() {
  try {
    const saved = await window.api.store.get('custom_notification_sound');
    customNotificationFilePath = saved || null;
    const pathInput = document.getElementById('notificationSoundPath');
    if (pathInput) pathInput.value = customNotificationFilePath || '';
  } catch (err) {
    console.warn('Gagal memuat suara notifikasi custom:', err);
  }
}

async function pickNotificationSound() {
  try {
    const result = await window.api.dialog.openFile({
      properties: ['openFile'],
      filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac', 'wma'] }]
    });
    if (result.canceled || !result.filePaths?.length) return;
    const filePath = result.filePaths[0];
    customNotificationFilePath = filePath;
    await window.api.store.set('custom_notification_sound', filePath);
    const pathInput = document.getElementById('notificationSoundPath');
    if (pathInput) pathInput.value = filePath;
    showToast('Suara notifikasi custom berhasil dipilih', 'success');
  } catch (err) {
    showToast(`Gagal memilih file: ${err.message}`, 'error');
  }
}

async function testNotificationSound() {
  if (!customNotificationFilePath) {
    showToast('Belum ada suara custom yang dipilih', 'warning');
    return;
  }
  try {
    const result = await window.api.notification.playSound(customNotificationFilePath);
    if (result?.success !== false) showToast('Memainkan suara notifikasi...', 'info');
    else showToast('Gagal memainkan suara: ' + (result.error || 'unknown error'), 'error');
  } catch (err) {
    showToast(`Gagal memainkan suara: ${err.message}`, 'error');
  }
}

async function resetNotificationSound() {
  customNotificationFilePath = null;
  await window.api.store.set('custom_notification_sound', null);
  const pathInput = document.getElementById('notificationSoundPath');
  if (pathInput) pathInput.value = '';
  showToast('Suara notifikasi direset ke default', 'success');
}

function initSettingsListeners() {
  document.getElementById('btnPickNotificationSound')?.addEventListener('click', pickNotificationSound);
  document.getElementById('btnTestNotificationSound')?.addEventListener('click', testNotificationSound);
  document.getElementById('btnResetNotificationSound')?.addEventListener('click', resetNotificationSound);
}

function initLicenseListeners() {
  const btnActivate = document.getElementById('btnActivateLicense');
  const btnCopyId = document.getElementById('btnCopyMachineId');
  const serialInput = document.getElementById('serialKeyInput');
  btnActivate?.addEventListener('click', async () => {
    const key = serialInput.value.trim();
    if (!key) { showToast('Masukkan Serial Key', 'error'); return; }
    btnActivate.disabled = true;
    btnActivate.textContent = '⏳ Memproses...';
    try {
      const result = await window.api.license.activate({ key });
      if (result.success) { showToast('Aktivasi Berhasil!', 'success'); serialInput.value = ''; await checkLicenseStatus(); }
      else showToast(result.error || 'Aktivasi Gagal', 'error');
    } catch (err) {
      showToast(`Error: ${err.message}`, 'error');
    } finally {
      btnActivate.disabled = false;
      btnActivate.textContent = '🚀 Aktifkan Sekarang';
    }
  });
  btnCopyId?.addEventListener('click', () => {
    const machineId = document.getElementById('machineIdDisplay').value;
    navigator.clipboard.writeText(machineId);
    showToast('Machine ID disalin ke clipboard', 'success');
  });
}

// ============================================================
// Update & About
// ============================================================
function setUpdateStatus(message, status = 'idle') {
  const statusEl = document.getElementById('updateStatusMessage');
  if (!statusEl) return;
  statusEl.innerHTML = `<span class="status-dot ${escapeHtml(status)}"></span><span>${escapeHtml(message)}</span>`;
}

function setUpdateProgress(percent = 0) {
  const container = document.getElementById('updateProgressContainer');
  const fill = document.getElementById('updateProgressFill');
  const text = document.getElementById('updateProgressText');
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  if (container) container.style.display = 'flex';
  if (fill) fill.style.width = `${safePercent.toFixed(1)}%`;
  if (text) text.textContent = `${safePercent.toFixed(1)}%`;
}

function setUpdateButtons({ checking = false, updateAvailable = false, downloaded = false } = {}) {
  const btnCheck = document.getElementById('btnCheckUpdate');
  const btnDownload = document.getElementById('btnDownloadUpdate');
  const btnInstall = document.getElementById('btnInstallRestart');
  if (btnCheck) btnCheck.disabled = checking;
  if (btnDownload) btnDownload.disabled = checking || !updateAvailable || downloaded;
  if (btnInstall) btnInstall.disabled = !downloaded;
}

async function refreshUpdateTab() {
  try {
    if (window.api?.app?.getVersion) {
      const version = await window.api.app.getVersion();
      const currentVersionEl = document.getElementById('updateCurrentVersion');
      if (currentVersionEl) currentVersionEl.textContent = `v${version}`;
    }
  } catch (err) { console.warn('Gagal memuat versi aplikasi:', err); }
}

async function refreshAboutTab() {
  try {
    if (window.api?.app?.getVersion) {
      const version = await window.api.app.getVersion();
      document.querySelectorAll('.app-version').forEach((el) => { el.textContent = `v${version}`; });
      const aboutVersion = document.getElementById('aboutVersion');
      if (aboutVersion) aboutVersion.textContent = `v${version}`;
    }
  } catch (err) { console.warn('Gagal memuat versi about:', err); }
}

function initUpdaterListeners() {
  const btnCheck = document.getElementById('btnCheckUpdate');
  const btnDownload = document.getElementById('btnDownloadUpdate');
  const btnInstall = document.getElementById('btnInstallRestart');

  btnCheck?.addEventListener('click', async () => {
    if (!window.api?.updater?.checkForUpdate) { setUpdateStatus('Fitur update belum tersedia di aplikasi ini.', 'error'); showToast('Fitur update belum tersedia', 'error'); return; }
    try {
      setUpdateButtons({ checking: true });
      setUpdateStatus('Sedang mengecek update...', 'checking');
      const result = await window.api.updater.checkForUpdate();
      if (result?.success === false) { setUpdateButtons(); setUpdateStatus(result.error || 'Gagal mengecek update.', 'error'); showToast(result.error || 'Gagal mengecek update', 'error'); }
    } catch (err) { setUpdateButtons(); setUpdateStatus(err.message || 'Gagal mengecek update.', 'error'); showToast(`Gagal mengecek update: ${err.message || err}`, 'error'); }
  });

  btnDownload?.addEventListener('click', async () => {
    if (!window.api?.updater?.downloadUpdate) return;
    try {
      setUpdateStatus('Sedang download update...', 'loading'); setUpdateProgress(0);
      setUpdateButtons({ updateAvailable: true });
      const result = await window.api.updater.downloadUpdate();
      if (result?.success === false) { setUpdateButtons({ updateAvailable: true }); setUpdateStatus(result.error || 'Gagal download update.', 'error'); showToast(result.error || 'Gagal download update', 'error'); }
    } catch (err) { setUpdateButtons({ updateAvailable: true }); setUpdateStatus(err.message || 'Gagal download update.', 'error'); showToast(`Gagal download update: ${err.message || err}`, 'error'); }
  });

  btnInstall?.addEventListener('click', async () => {
    if (!window.api?.updater?.installAndRestart) return;
    if (!confirm('Install update sekarang dan restart aplikasi?')) return;
    await window.api.updater.installAndRestart();
  });

  window.api?.updater?.onChecking?.(() => { setUpdateButtons({ checking: true }); setUpdateStatus('Sedang mengecek update...', 'checking'); });
  window.api?.updater?.onAvailable?.((info) => {
    const latestVersionEl = document.getElementById('updateLatestVersion');
    if (latestVersionEl && info?.version) latestVersionEl.textContent = `v${info.version}`;
    setUpdateButtons({ updateAvailable: true }); setUpdateStatus('Update tersedia. Silakan download update.', 'available');
    showToast(`Update tersedia${info?.version ? `: v${info.version}` : ''}`, 'success');
  });
  window.api?.updater?.onNotAvailable?.((info) => {
    const latestVersionEl = document.getElementById('updateLatestVersion');
    if (latestVersionEl && info?.version) latestVersionEl.textContent = `v${info.version}`;
    setUpdateButtons(); setUpdateStatus('Aplikasi sudah versi terbaru.', 'idle');
    showToast('Aplikasi sudah versi terbaru', 'success');
  });
  window.api?.updater?.onProgress?.((progress) => {
    setUpdateButtons({ updateAvailable: true }); setUpdateStatus('Sedang download update...', 'loading'); setUpdateProgress(progress?.percent || 0);
  });
  window.api?.updater?.onDownloaded?.((info) => {
    const latestVersionEl = document.getElementById('updateLatestVersion');
    if (latestVersionEl && info?.version) latestVersionEl.textContent = `v${info.version}`;
    setUpdateProgress(100); setUpdateButtons({ updateAvailable: true, downloaded: true });
    setUpdateStatus('Update selesai di-download. Klik Install & Restart.', 'downloaded');
    showToast('Update selesai di-download', 'success');
  });
  window.api?.updater?.onError?.((error) => {
    setUpdateButtons(); setUpdateStatus(error?.message || error?.error || 'Terjadi error update.', 'error');
    showToast(`Error update: ${error?.message || error?.error || error}`, 'error');
  });
}

// ============================================================
// Init
// ============================================================
function ensureChatState(accountId) {
  if (!chatMessages[accountId]) chatMessages[accountId] = {};
  if (!chatContacts[accountId]) chatContacts[accountId] = [];
  if (!chatUnread[accountId]) chatUnread[accountId] = {};
}

function upsertChatContact(accountId, contact) {
  ensureChatState(accountId);
  const list = chatContacts[accountId];
  const idx = list.findIndex(c => c.id === contact.id);
  if (idx >= 0) list.splice(idx, 1);
  list.unshift(contact);
}

// ═══════════════════════════════════════════════════════════════════════
//  BROWSER TAB FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════

let browserTabs = [];
let activeBrowserTabId = null;
let browserTabIdCounter = 0;

const BROWSER_HOME = 'about:blank';
const SEARCH_ENGINE = 'https://www.google.com/search?q=';

function createBrowserTab(url = BROWSER_HOME, activate = true) {
  const id = ++browserTabIdCounter;
  const tab = {
    id,
    title: 'New Tab',
    url: url,
    favicon: null,
    webview: null,
    container: null,
    isLoading: false,
  };

  // Create tab element
  const tabEl = document.createElement('div');
  tabEl.className = 'browser-tab';
  tabEl.dataset.id = id;
  tabEl.innerHTML = `
    <div class="browser-tab-favicon"><span class="default-icon">🌐</span></div>
    <span class="browser-tab-title">New Tab</span>
    <button class="browser-tab-close" title="Tutup tab">✕</button>
  `;

  tabEl.addEventListener('click', (e) => {
    if (!e.target.closest('.browser-tab-close')) switchBrowserTab(id);
  });

  tabEl.querySelector('.browser-tab-close').addEventListener('click', (e) => {
    e.stopPropagation();
    closeBrowserTab(id);
  });

  // Middle click to close
  tabEl.addEventListener('mousedown', (e) => {
    if (e.button === 1) { e.preventDefault(); closeBrowserTab(id); }
  });

  const browserTabsEl = document.getElementById('browserTabs');
  if (browserTabsEl) browserTabsEl.appendChild(tabEl);
  tab.element = tabEl;

  // Create container in webview stage
  const container = document.createElement('div');
  container.className = 'browser-webview-container';
  container.dataset.id = id;

  const stage = document.getElementById('browserWebviewStage');
  if (stage) stage.appendChild(container);
  tab.container = container;

  browserTabs.push(tab);

  // Hide welcome screen when tabs exist
  updateBrowserGreeting();

  if (activate) switchBrowserTab(id);

  // Auto-navigate if URL is not blank
  if (url && url !== BROWSER_HOME) {
    createBrowserWebview(tab, url);
    tab.url = url;
    tab.title = 'Loading...';
    updateBrowserTabUI(tab);
  }

  return tab;
}

function createBrowserWebview(tab, url) {
  const webview = document.createElement('webview');
  // Set user agent BEFORE src to ensure it's used for initial page load.
  // This is critical for YouTube, Google, etc. that check UA during bootstrap.
  // Version must match CHROME_VER in browser-preload.js and CHROME_UA in main.js.
  webview.setAttribute('useragent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36');
  // Load browser-preload.js to delete navigator.webdriver, handle popups, etc.
  // This MUST be set before src for the preload to run on initial page load.
  // Path is relative to src/index.html, so ../browser-preload.js points to project root.
  webview.setAttribute('preload', '../browser-preload.js');
  webview.setAttribute('partition', `persist:browser-tab-${tab.id}`);
  webview.setAttribute('nodeintegration', 'false');
  // contextIsolation must be false so browser-preload.js can patch navigator in the page JS context.
  // main.js will-attach-webview handler also enforces this for non-WhatsApp webviews.
  webview.setAttribute('contextIsolation', 'false');
  webview.setAttribute('allowpopups', 'true');
  webview.setAttribute('autosize', 'on');
  // Set src after preload and useragent are configured
  webview.setAttribute('src', url);

  // Webview events
  webview.addEventListener('did-start-loading', () => {
    tab.isLoading = true;
    if (tab.id === activeBrowserTabId) {
      setBrowserLoading(true);
      const reloadBtn = document.getElementById('btnBrowserReload');
      if (reloadBtn) reloadBtn.textContent = '✕';
    }
  });

  webview.addEventListener('did-stop-loading', () => {
    tab.isLoading = false;
    if (tab.id === activeBrowserTabId) {
      setBrowserLoading(false);
      const reloadBtn = document.getElementById('btnBrowserReload');
      if (reloadBtn) reloadBtn.textContent = '⟳';
      updateBrowserNavButtons();
    }
  });

  webview.addEventListener('page-title-updated', (e) => {
    tab.title = e.title || 'Untitled';
    updateBrowserTabUI(tab);
    if (tab.id === activeBrowserTabId) {
      const titleEl = document.getElementById('browserTitle');
      if (titleEl) titleEl.textContent = tab.title;
    }
  });

  webview.addEventListener('page-favicon-updated', (e) => {
    if (e.favicons && e.favicons.length > 0) {
      tab.favicon = e.favicons[0];
      updateBrowserTabUI(tab);
    }
  });

  webview.addEventListener('did-navigate', (e) => {
    tab.url = e.url;
    if (tab.id === activeBrowserTabId) {
      const urlInput = document.getElementById('browserUrlInput');
      if (urlInput) urlInput.value = e.url;
      updateBrowserNavButtons();
    }
  });

  webview.addEventListener('did-navigate-in-page', (e) => {
    tab.url = e.url;
    if (tab.id === activeBrowserTabId) {
      const urlInput = document.getElementById('browserUrlInput');
      if (urlInput) urlInput.value = e.url;
      updateBrowserNavButtons();
    }
  });

  // NOTE: The deprecated 'new-window' event is intentionally NOT used here.
  // Popup handling (sign-in, target="_blank") is managed by main process
  // setWindowOpenHandler which has proper authority and doesn't conflict
  // with page-level JavaScript event handling.

  // Re-apply user agent on dom-ready to ensure consistency
  // Version must match CHROME_VER in browser-preload.js and CHROME_UA in main.js
  webview.addEventListener('dom-ready', () => {
    try {
      webview.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36');
    } catch (_) {}
  });

  webview.addEventListener('did-fail-load', (e) => {
    if (e.errorCode !== -3) {
      tab.isLoading = false;
      if (tab.id === activeBrowserTabId) {
        setBrowserLoading(false);
        const reloadBtn = document.getElementById('btnBrowserReload');
        if (reloadBtn) reloadBtn.textContent = '⟳';
      }
    }
  });

  tab.container.appendChild(webview);
  tab.webview = webview;
}

function switchBrowserTab(id) {
  const tab = browserTabs.find(t => t.id === id);
  if (!tab) return;

  // Deactivate all
  browserTabs.forEach(t => {
    t.element.classList.remove('active');
    t.container.classList.remove('active');
  });

  // Activate new
  tab.element.classList.add('active');
  tab.container.classList.add('active');
  activeBrowserTabId = id;

  // Update URL bar
  const urlInput = document.getElementById('browserUrlInput');
  if (urlInput) {
    urlInput.value = (tab.url && tab.url !== BROWSER_HOME) ? tab.url : '';
  }

  // Update title bar
  const titleEl = document.getElementById('browserTitle');
  if (titleEl) titleEl.textContent = tab.title || 'Browser';

  // Update loading state
  setBrowserLoading(tab.isLoading);
  const reloadBtn = document.getElementById('btnBrowserReload');
  if (reloadBtn) reloadBtn.textContent = tab.isLoading ? '✕' : '⟳';

  updateBrowserNavButtons();
  updateBrowserGreeting();
}

function closeBrowserTab(id) {
  const index = browserTabs.findIndex(t => t.id === id);
  if (index === -1) return;

  const tab = browserTabs[index];

  // Destroy webview
  if (tab.webview) tab.webview.remove();
  tab.container.remove();
  tab.element.remove();
  browserTabs.splice(index, 1);

  // If closed tab was active, switch to another
  if (activeBrowserTabId === id) {
    if (browserTabs.length === 0) {
      activeBrowserTabId = null;
      // Show welcome screen when no tabs left
      updateBrowserGreeting();
      const urlInput = document.getElementById('browserUrlInput');
      if (urlInput) urlInput.value = '';
      const titleEl = document.getElementById('browserTitle');
      if (titleEl) titleEl.textContent = 'Browser';
      updateBrowserNavButtons();
    } else {
      const newIndex = Math.min(index, browserTabs.length - 1);
      switchBrowserTab(browserTabs[newIndex].id);
    }
  }
}

function navigateBrowser(input) {
  const tab = browserTabs.find(t => t.id === activeBrowserTabId);
  let url = (input || '').trim();
  if (!url) return;

  // Determine URL or search
  if (url.match(/^(https?:\/\/|file:\/\/|about:)/i)) {
    // already a URL
  } else if (url.match(/^[\w-]+(\.[\w-]+)+/i)) {
    url = 'https://' + url;
  } else {
    url = SEARCH_ENGINE + encodeURIComponent(url);
  }

  // If no active tab, create one
  if (!tab) {
    createBrowserTab(url, true);
    return;
  }

  // If still on home page, create webview
  if (!tab.webview) {
    createBrowserWebview(tab, url);
  } else {
    try {
      tab.webview.loadURL(url);
    } catch (err) {
      console.error('loadURL failed, falling back to src:', err);
      tab.webview.setAttribute('src', url);
    }
  }

  tab.url = url;
  const urlInput = document.getElementById('browserUrlInput');
  if (urlInput) urlInput.value = url;
  tab.title = 'Loading...';
  updateBrowserTabUI(tab);
}

function updateBrowserTabUI(tab) {
  if (!tab.element) return;
  const titleEl = tab.element.querySelector('.browser-tab-title');
  const faviconEl = tab.element.querySelector('.browser-tab-favicon');

  if (titleEl) titleEl.textContent = tab.title || 'New Tab';

  if (tab.favicon && faviconEl) {
    faviconEl.innerHTML = '<img src="' + tab.favicon + '" onerror="this.parentElement.innerHTML=\'<span class=\\\'default-icon\\\'>🌐</span>\'">';
  } else if (faviconEl) {
    faviconEl.innerHTML = '<span class="default-icon">🌐</span>';
  }
}

function updateBrowserNavButtons() {
  const tab = browserTabs.find(t => t.id === activeBrowserTabId);
  const backBtn = document.getElementById('btnBrowserBack');
  const fwdBtn = document.getElementById('btnBrowserForward');

  if (!tab || !tab.webview) {
    if (backBtn) backBtn.disabled = true;
    if (fwdBtn) fwdBtn.disabled = true;
    return;
  }

  if (backBtn) backBtn.disabled = !tab.webview.canGoBack();
  if (fwdBtn) fwdBtn.disabled = !tab.webview.canGoForward();
}

function setBrowserLoading(loading) {
  const bar = document.getElementById('browserLoadingBar');
  if (!bar) return;
  if (loading) {
    bar.classList.add('loading');
  } else {
    bar.classList.remove('loading');
  }
}

window.navigateBrowser = navigateBrowser;
window.createBrowserTab = createBrowserTab;
window.closeBrowserTab = closeBrowserTab;
window.switchBrowserTab = switchBrowserTab;

function updateBrowserGreeting() {
  const welcome = document.getElementById('browserWelcome');
  if (!welcome) return;

  // Hide welcome screen if there are any tabs, regardless of webview state
  if (browserTabs.length > 0) {
    welcome.style.display = 'none';
  } else {
    welcome.style.display = '';
  }
}

function initBrowserListeners() {
  // Add tab button
  const addBtn = document.getElementById('btnAddBrowserTab');
  if (addBtn) addBtn.addEventListener('click', () => createBrowserTab());

  // Navigation buttons
  const backBtn = document.getElementById('btnBrowserBack');
  const fwdBtn = document.getElementById('btnBrowserForward');
  const reloadBtn = document.getElementById('btnBrowserReload');
  const homeBtn = document.getElementById('btnBrowserHome');
  const goBtn = document.getElementById('btnBrowserGo');
  const urlInput = document.getElementById('browserUrlInput');

  if (backBtn) backBtn.addEventListener('click', () => {
    const tab = browserTabs.find(t => t.id === activeBrowserTabId);
    if (tab?.webview && tab.webview.canGoBack()) tab.webview.goBack();
  });

  if (fwdBtn) fwdBtn.addEventListener('click', () => {
    const tab = browserTabs.find(t => t.id === activeBrowserTabId);
    if (tab?.webview && tab.webview.canGoForward()) tab.webview.goForward();
  });

  if (reloadBtn) reloadBtn.addEventListener('click', () => {
    const tab = browserTabs.find(t => t.id === activeBrowserTabId);
    if (!tab) return;
    if (tab.isLoading) {
      tab.webview?.stop();
    } else if (tab.webview) {
      tab.webview.reload();
    }
  });

  if (homeBtn) homeBtn.addEventListener('click', () => {
    const tab = browserTabs.find(t => t.id === activeBrowserTabId);
    if (!tab) return;
    if (tab.webview) {
      tab.webview.remove();
      tab.webview = null;
    }
    tab.container.innerHTML = '';
    tab.url = BROWSER_HOME;
    tab.title = 'New Tab';
    tab.favicon = null;
    updateBrowserTabUI(tab);
    if (urlInput) urlInput.value = '';
    updateBrowserNavButtons();
    // Welcome screen stays hidden as long as tabs exist
  });

  if (goBtn) goBtn.addEventListener('click', () => {
    if (urlInput) navigateBrowser(urlInput.value);
  });

  if (urlInput) {
    urlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        navigateBrowser(urlInput.value);
        urlInput.blur();
      }
    });
    urlInput.addEventListener('focus', () => urlInput.select());
  }

  // Keyboard shortcuts for browser tab (only when browser is active)
  document.addEventListener('keydown', (e) => {
    if (currentTab !== 'browser') return;

    // Ctrl+T: New tab
    if (e.ctrlKey && e.key === 't') {
      e.preventDefault();
      createBrowserTab();
    }

    // Ctrl+W: Close tab
    if (e.ctrlKey && e.key === 'w') {
      e.preventDefault();
      if (activeBrowserTabId) closeBrowserTab(activeBrowserTabId);
    }

    // Ctrl+Tab / Ctrl+Shift+Tab: Switch tabs
    if (e.ctrlKey && e.key === 'Tab') {
      e.preventDefault();
      const idx = browserTabs.findIndex(t => t.id === activeBrowserTabId);
      if (idx !== -1) {
        const next = e.shiftKey
          ? (idx - 1 + browserTabs.length) % browserTabs.length
          : (idx + 1) % browserTabs.length;
        switchBrowserTab(browserTabs[next].id);
      }
    }

    // Ctrl+L: Focus URL bar
    if (e.ctrlKey && e.key === 'l') {
      e.preventDefault();
      urlInput?.focus();
    }
  });
}

// Listen for link opening from WhatsApp webview
window.api?.wa?.onOpenLinkInBrowser?.((url) => {
  // Switch to browser tab and open the link
  switchTab('browser');
  setTimeout(() => {
    navigateBrowser(url);
  }, 100);
});

document.addEventListener('DOMContentLoaded', async () => {
  console.log('WA Manager Renderer Ready');
  initWaWebviewListeners();
  initBrowserListeners();
  initUpdaterListeners();
  initSettingsListeners();
  initLicenseListeners();
  await checkLicenseStatus();
  refreshAboutTab();
  refreshUpdateTab();

  if (isLicenseActive) {
    try { await loadWaWebviewState(); } catch (err) { console.error('Error loading webview state:', err); }
  }

  await refreshAccounts(true);

  setInterval(() => {
    refreshAccounts(currentTab === 'accounts', { silent: currentTab !== 'accounts' });
    if (currentTab === 'chat') refreshChatTab();
    if (currentTab === 'ai') renderAIAccountToggles();
  }, 5000);
});
