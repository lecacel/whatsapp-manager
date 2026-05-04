const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const EventEmitter = require('events');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const mime = require('mime-types');

const store = new Store();

const SESSION_PATH = path.join(
  process.env.APPDATA || process.env.HOME || process.cwd(),
  '.wa-manager',
  'sessions'
);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class WhatsAppManager extends EventEmitter {
  constructor() {
    super();
    this.clients = {}; // accountId -> { client, status, info, name }
    this.loadSavedAccounts();
  }

  loadSavedAccounts() {
    const accounts = store.get('wa_accounts', []);
    accounts.forEach((account, index) => {
      // Re-initialize saved accounts with error handling.
      // Stagger startup to avoid multiple Chromium instances fighting over resources/session locks.
      setTimeout(async () => {
        try {
          await this.addAccount(account.id, account.name, { restoring: true });
        } catch (err) {
          console.warn(`Gagal menginisialisasi ulang akun "${account.id}":`, err.message || err);
        }
      }, 1000 + (index * 1500));
    });
  }

  saveAccounts() {
    const accounts = Object.entries(this.clients).map(([id, data]) => ({
      id,
      name: data.name
    }));
    store.set('wa_accounts', accounts);
  }

  async addAccount(accountId, name, options = {}) {
    accountId = String(accountId || '').trim();
    name = String(name || accountId).trim();

    if (!accountId) {
      throw new Error('Account ID is required');
    }

    if (this.clients[accountId]) {
      const existing = this.clients[accountId];
      if (existing.status === 'error' || existing.status === 'disconnected' || options.forceRestart) {
        await this.destroyClient(accountId, { keepAccount: true });
      } else {
        throw new Error(`Account ${accountId} already exists`);
      }
    }

    fs.mkdirSync(SESSION_PATH, { recursive: true });

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: accountId,
        dataPath: SESSION_PATH
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--disable-gpu',
          '--disable-extensions',
          '--disable-background-networking',
          '--disable-default-apps',
          '--disable-features=site-per-process',
          `--user-data-dir=${path.join(SESSION_PATH, `chrome-profile-${accountId}`)}`
        ]
      },
      takeoverOnConflict: true,
      takeoverTimeoutMs: 0,
      qrMaxRetries: 0
    });

    this.clients[accountId] = {
      client,
      status: 'initializing',
      info: null,
      name,
      initializing: true,
      reconnectAttempts: 0,
      restoring: !!options.restoring
    };

    // Save immediately. Previously the account was only saved after initialize/ready,
    // so closing the app while QR/authenticated-but-not-ready could make it disappear.
    this.saveAccounts();

    // Setup client events
    client.on('qr', (qr) => {
      if (!this.clients[accountId]) return;
      this.clients[accountId].status = 'qr';
      this.saveAccounts();
      this.emit('qr', accountId, qr);
    });

    client.on('ready', () => {
      if (!this.clients[accountId]) return;
      this.clients[accountId].status = 'ready';
      this.clients[accountId].initializing = false;
      this.clients[accountId].reconnectAttempts = 0;
      const info = client.info;
      this.clients[accountId].info = {
        wid: info?.wid?._serialized || '',
        pushname: info?.pushname || name,
        phone: info?.wid?.user || ''
      };
      this.emit('ready', accountId, this.clients[accountId].info);
      this.saveAccounts();
    });

    client.on('authenticated', () => {
      if (!this.clients[accountId]) return;
      this.clients[accountId].status = 'authenticated';
      this.saveAccounts();
      this.emit('authenticated', accountId);
    });

    client.on('auth_failure', (msg) => {
      if (!this.clients[accountId]) return;
      this.clients[accountId].status = 'auth_failure';
      this.clients[accountId].initializing = false;
      this.saveAccounts();
      this.emit('auth_failure', accountId, msg);
    });

    client.on('disconnected', (reason) => {
      if (!this.clients[accountId]) return;
      this.clients[accountId].status = 'disconnected';
      this.clients[accountId].initializing = false;
      this.emit('disconnected', accountId, reason);
      this.saveAccounts();

      if (!this.clients[accountId]?.removing && !this.clients[accountId]?.manualLogout) {
        this.scheduleReconnect(accountId, reason);
      }
    });

    client.on('message', async (message) => {
      // Only process incoming messages (not sent by us)
      if (message.fromMe) return;

      const msgData = {
        id: message.id?._serialized || message.id,
        from: message.from,
        to: message.to,
        body: message.body,
        type: message.type,
        timestamp: message.timestamp,
        hasMedia: message.hasMedia,
        isGroup: message.from?.includes('@g.us')
      };

      try {
        const contact = await message.getContact();
        msgData.contactName = contact.pushname || contact.name || '';
        msgData.contactPhone = contact.number || '';
      } catch (e) {
        msgData.contactName = '';
      }

      this.emit('message', accountId, msgData);
    });

    // Initialize client. Do not wait forever for "ready"; QR/authenticated are valid intermediate states.
    try {
      await client.initialize();
    } catch (err) {
      if (this.clients[accountId]) {
        this.clients[accountId].status = 'error';
        this.clients[accountId].initializing = false;
        this.saveAccounts();
      }
      throw err;
    }

    if (this.clients[accountId]) {
      this.clients[accountId].initializing = false;
      this.saveAccounts();
    }
    return { success: true };
  }

  async destroyClient(accountId, options = {}) {
    const data = this.clients[accountId];
    if (!data) return;

    data.removing = !options.keepAccount;
    data.manualLogout = !!options.manualLogout;

    try {
      await data.client.destroy();
    } catch (e) {
      console.warn(`Destroy account ${accountId} warning:`, e.message || e);
    }

    delete this.clients[accountId];

    if (!options.keepAccount) {
      this.saveAccounts();
    }
  }

  scheduleReconnect(accountId, reason) {
    const data = this.clients[accountId];
    if (!data) return;

    data.reconnectAttempts = (data.reconnectAttempts || 0) + 1;
    const attempts = data.reconnectAttempts;
    const delay = Math.min(30000, 3000 * attempts);

    console.warn(`Akun "${accountId}" terputus (${reason || 'unknown'}). Mencoba reconnect dalam ${delay / 1000}s...`);

    setTimeout(async () => {
      const current = this.clients[accountId];
      if (!current || current.status === 'ready' || current.removing || current.manualLogout) return;

      const accountName = current.name || accountId;
      try {
        await this.addAccount(accountId, accountName, { forceRestart: true, restoring: true });
      } catch (err) {
        console.warn(`Reconnect akun "${accountId}" gagal:`, err.message || err);
        if (this.clients[accountId] && attempts < 10) {
          this.scheduleReconnect(accountId, err.message || err);
        }
      }
    }, delay);
  }

  async removeAccount(accountId) {
    if (!this.clients[accountId]) {
      const accounts = store.get('wa_accounts', []).filter((account) => account.id !== accountId);
      store.set('wa_accounts', accounts);
      return;
    }

    await this.destroyClient(accountId);
  }

  async logout(accountId) {
    if (!this.clients[accountId]) throw new Error('Account not found');

    const data = this.clients[accountId];
    data.manualLogout = true;

    try {
      await data.client.logout();
    } catch (e) {
      // Handle EBUSY/resource locked errors gracefully, as they are common and non-fatal on Windows during session cleanup.
      if (e && (e.code === 'EBUSY' || String(e.message || e).includes('EBUSY') || String(e.message || e).includes('locked'))) {
        console.warn(`[WARN] Logout lockfile busy for ${accountId}. Ignoring non-fatal error:`, e.message || e);
      } else {
        // Re-throw other unexpected errors
        throw e;
      }
    }

    data.status = 'disconnected';
    data.info = null;
    this.emit('disconnected', accountId, 'logout');
    this.saveAccounts();
  }

  getAccounts() {
    return Object.entries(this.clients).map(([id, data]) => ({
      id,
      name: data.name,
      status: data.status,
      info: data.info
    }));
  }

  getStatus(accountId) {
    if (!this.clients[accountId]) return { status: 'not_found' };
    return {
      status: this.clients[accountId].status,
      info: this.clients[accountId].info
    };
  }

  getReadyClients() {
    return Object.entries(this.clients)
      .filter(([, data]) => data.status === 'ready')
      .map(([id, data]) => ({ id, name: data.name, info: data.info }));
  }

  async sendMessage(accountId, to, message) {
    if (!this.clients[accountId]) throw new Error('Account not found');
    if (this.clients[accountId].status !== 'ready') throw new Error('Account not ready');

    const client = this.clients[accountId].client;
    
    // Format phone number
    let chatId = to;
    if (!chatId.includes('@')) {
      // Clean number
      chatId = to.replace(/\D/g, '');
      if (!chatId.startsWith('62') && !chatId.startsWith('+')) {
        if (chatId.startsWith('0')) {
          chatId = '62' + chatId.substring(1);
        }
      }
      chatId = chatId.replace('+', '') + '@c.us';
    }

    await client.sendMessage(chatId, message);
  }

  async sendMessageWithMedia(accountId, to, message, mediaPath) {
    if (!this.clients[accountId]) throw new Error('Account not found');
    if (this.clients[accountId].status !== 'ready') throw new Error('Account not ready');

    const client = this.clients[accountId].client;

    let chatId = to;
    if (!chatId.includes('@')) {
      chatId = to.replace(/\D/g, '');
      if (chatId.startsWith('0')) {
        chatId = '62' + chatId.substring(1);
      }
      chatId = chatId + '@c.us';
    }

    if (mediaPath) {
      if (!fs.existsSync(mediaPath)) {
        throw new Error('File media tidak ditemukan');
      }

      const media = MessageMedia.fromFilePath(mediaPath);
      if (!media.mimetype) {
        media.mimetype = mime.lookup(mediaPath) || 'application/octet-stream';
      }

      await client.sendMessage(chatId, media, {
        caption: message || '',
        sendMediaAsDocument: false
      });
    } else {
      await client.sendMessage(chatId, message);
    }
  }

  async getContacts(accountId) {
    if (!this.clients[accountId]) throw new Error('Account not found');
    if (this.clients[accountId].status !== 'ready') throw new Error('Account not ready');

    const client = this.clients[accountId].client;
    const contacts = await client.getContacts();

    return contacts
      .filter(c => !c.isGroup && c.number && c.number.length > 5)
      .map(c => ({
        id: c.id._serialized,
        name: c.name || c.pushname || c.number,
        number: c.number,
        phone: c.number
      }))
      .slice(0, 500); // Limit to 500 contacts
  }

  async getAllChats(accountId) {
    if (!this.clients[accountId]) throw new Error('Account not found');
    if (this.clients[accountId].status !== 'ready') throw new Error('Account not ready');

    const client = this.clients[accountId].client;
    const chats = await client.getChats();

    return chats.map(chat => {
      let preview = '';
      let timestamp = 0;
      if (chat.lastMessage) {
        preview = chat.lastMessage.body;
        timestamp = chat.lastMessage.timestamp * 1000;
      }
      return {
        id: chat.id._serialized,
        name: chat.name,
        isGroup: chat.isGroup,
        unreadCount: chat.unreadCount,
        timestamp,
        preview
      };
    });
  }

  async getChatMessages(accountId, chatId, limit = 50) {
    if (!this.clients[accountId]) throw new Error('Account not found');
    if (this.clients[accountId].status !== 'ready') throw new Error('Account not ready');

    const client = this.clients[accountId].client;
    
    try {
      const chat = await client.getChatById(chatId);
      if (!chat) return [];
      
      const messages = await chat.fetchMessages({ limit });
      
      return messages.map(msg => ({
        id: msg.id._serialized,
        body: msg.body,
        fromMe: msg.fromMe,
        timestamp: msg.timestamp * 1000,
        from: msg.from,
        to: msg.to,
        type: msg.type,
        hasMedia: msg.hasMedia,
        filename: msg._data?.filename || msg._data?.caption || '',
        mimetype: msg._data?.mimetype || '',
        duration: msg._data?.duration || null
      }));
    } catch (e) {
      console.error(`Error fetching messages for ${chatId}:`, e);
      return [];
    }
  }

  async downloadMedia(accountId, messageId) {
    if (!this.clients[accountId]) throw new Error('Account not found');
    const client = this.clients[accountId].client;
    try {
      const msg = await client.getMessageById(messageId);
      if (msg && msg.hasMedia) {
        const media = await msg.downloadMedia();
        if (media) {
          return {
            mimetype: media.mimetype,
            data: media.data,
            filename: media.filename
          };
        }
      }
    } catch (e) {
      console.error('Download media error:', e);
    }
    return null;
  }

  async getClient(accountId) {
    if (!this.clients[accountId]) return null;
    return this.clients[accountId].client;
  }

  destroyAll() {
    Object.values(this.clients).forEach(data => {
      try {
        data.client.destroy();
      } catch (e) {}
    });
  }
}

module.exports = WhatsAppManager;