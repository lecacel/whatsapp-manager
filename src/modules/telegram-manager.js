const { EventEmitter } = require('events');
const Store = require('electron-store');
const store = new Store();
const path = require('path');
const fs = require('fs');

// Telegram imports dengan error handling
let TelegramClient, StringSession, NewMessage;
try {
  const telegram = require('telegram');
  TelegramClient = telegram.TelegramClient;
  StringSession = require('telegram/sessions').StringSession;
  NewMessage = require('telegram/events').NewMessage;
} catch (err) {
  console.error('[TelegramManager] Error loading telegram library:', err.message);
  console.error('[TelegramManager] Make sure to run: npm install telegram@latest');
}

// Telegram Manager - Native Telegram integration using GramJS
class TelegramManager extends EventEmitter {
  constructor() {
    super();
    this.accounts = new Map();
    this.clients = new Map();
    this.reconnectTimers = new Map();
    this.messageHandlers = new Map();
    this.apiId = 94575; // Default Telegram API ID (gunakan milik sendiri di production)
    this.apiHash = 'a3406de8d171bb422bb6ddf3bbd800e2'; // Default API Hash
    this.isLibraryAvailable = !!(TelegramClient && StringSession && NewMessage);
    
    if (!this.isLibraryAvailable) {
      console.error('[TelegramManager] Telegram library not available. Please install it first.');
    }
    
    this.loadSavedAccounts();
  }

  loadSavedAccounts() {
    try {
      const saved = store.get('telegram_accounts', []);
      if (Array.isArray(saved)) {
        saved.forEach((acc) => {
          this.accounts.set(acc.id, {
            id: acc.id,
            name: acc.name,
            phone: acc.phone || '',
            session: acc.session || '',
            status: 'disconnected',
            info: null
          });
        });
      }
    } catch (err) {
      console.error('[TelegramManager] Error loading accounts:', err);
    }
  }

  saveAccounts() {
    try {
      const accountsArray = Array.from(this.accounts.values()).map(acc => ({
        id: acc.id,
        name: acc.name,
        phone: acc.phone,
        session: acc.session || ''
      }));
      store.set('telegram_accounts', accountsArray);
    } catch (err) {
      console.error('[TelegramManager] Error saving accounts:', err);
    }
  }

  async addAccount(accountId, name, phone) {
    if (!this.isLibraryAvailable) {
      throw new Error('Telegram library is not installed. Please run: npm install telegram@latest');
    }

    if (this.accounts.has(accountId)) {
      throw new Error('Account ID already exists');
    }

    if (!phone || phone.trim() === '') {
      throw new Error('Phone number is required');
    }

    const account = {
      id: accountId,
      name,
      phone: phone.trim(),
      session: '',
      status: 'initializing',
      info: null
    };

    this.accounts.set(accountId, account);
    this.saveAccounts();

    // Initialize Telegram connection
    await this.initializeClient(accountId);

    return account;
  }

  async initializeClient(accountId) {
    const account = this.accounts.get(accountId);
    if (!account) throw new Error('Account not found');

    if (!this.isLibraryAvailable) {
      throw new Error('Telegram library is not installed. Please run: npm install telegram@latest');
    }

    try {
      account.status = 'initializing';
      this.emit('status_change', { accountId, status: 'initializing' });

      // Create Telegram client with string session
      const stringSession = new StringSession(account.session || '');
      const client = new TelegramClient(stringSession, this.apiId, this.apiHash, {
        connectionRetries: 5,
        connectionRetryDelay: 5000,
        useWSS: true,
      });

      // Store client
      this.clients.set(accountId, client);

      // Start client and send code
      await client.start({
        phoneNumber: async () => account.phone,
        password: async () => {
          // Will be asked if 2FA is enabled
          return '';
        },
        phoneCode: async () => {
          // Emit event untuk meminta kode dari user
          account.status = 'waiting_code';
          this.emit('waiting_code', { accountId, phone: account.phone });
          
          // Return promise yang akan di-resolve ketika user input code
          return new Promise((resolve) => {
            account._codeResolver = resolve;
          });
        },
        onError: (err) => {
          console.error(`[Telegram:${accountId}] Error:`, err);
          account.status = 'error';
          this.emit('error_state', { accountId, error: err.message });
        },
      });

      // Save session after successful connection
      account.session = client.session.save();
      account.status = 'ready';
      
      // Get user info
      const me = await client.getMe();
      account.info = {
        phone: account.phone,
        firstName: me.firstName || '',
        lastName: me.lastName || '',
        username: me.username || ''
      };

      this.saveAccounts();
      this.emit('ready', { accountId, info: account.info });

      // Setup message handler
      this._setupMessageHandler(accountId, client);

    } catch (err) {
      console.error(`[Telegram:${accountId}] Init error:`, err);
      account.status = 'error';
      this.emit('error_state', { accountId, error: err.message });
      
      // Cleanup
      const client = this.clients.get(accountId);
      if (client) {
        try {
          await client.disconnect();
        } catch (e) {}
        this.clients.delete(accountId);
      }
    }
  }

  async sendCode(accountId, code) {
    const account = this.accounts.get(accountId);
    if (!account) throw new Error('Account not found');

    try {
      if (!code || code.trim() === '') {
        throw new Error('Code is required');
      }

      account.status = 'authenticating';
      this.emit('status_change', { accountId, status: 'authenticating' });

      // Resolve the code promise yang menunggu di initializeClient
      if (account._codeResolver) {
        account._codeResolver(code.trim());
        delete account._codeResolver;
      } else {
        throw new Error('No code request pending');
      }

      return { success: true };
    } catch (err) {
      account.status = 'auth_failure';
      this.emit('auth_failure', { accountId });
      throw err;
    }
  }

  async removeAccount(accountId) {
    const account = this.accounts.get(accountId);
    if (!account) throw new Error('Account not found');

    try {
      await this.logout(accountId);
      this.accounts.delete(accountId);
      this.saveAccounts();
      return { success: true };
    } catch (err) {
      throw new Error(`Failed to remove account: ${err.message}`);
    }
  }

  async logout(accountId) {
    const account = this.accounts.get(accountId);
    if (!account) throw new Error('Account not found');

    try {
      const client = this.clients.get(accountId);
      if (client) {
        await client.disconnect();
        this.clients.delete(accountId);
      }

      account.session = '';
      account.status = 'disconnected';
      account.info = null;
      this.emit('disconnected', { accountId });
      this.saveAccounts();

      return { success: true };
    } catch (err) {
      throw new Error(`Logout failed: ${err.message}`);
    }
  }

  getAccounts() {
    return Array.from(this.accounts.values()).map(acc => ({
      id: acc.id,
      name: acc.name,
      phone: acc.phone,
      status: acc.status,
      info: acc.info
    }));
  }

  getStatus(accountId) {
    const account = this.accounts.get(accountId);
    if (!account) return { status: 'not_found' };
    return {
      status: account.status,
      info: account.info
    };
  }

  async sendMessage(accountId, chatId, message) {
    const account = this.accounts.get(accountId);
    if (!account || account.status !== 'ready') {
      throw new Error('Account not ready');
    }

    const client = this.clients.get(accountId);
    if (!client) {
      throw new Error('Client not found');
    }

    try {
      const result = await client.sendMessage(chatId, { message });
      return { success: true, messageId: result.id };
    } catch (err) {
      throw new Error(`Failed to send message: ${err.message}`);
    }
  }

  async sendMessageWithMedia(accountId, chatId, message, mediaPath) {
    const account = this.accounts.get(accountId);
    if (!account || account.status !== 'ready') {
      throw new Error('Account not ready');
    }

    const client = this.clients.get(accountId);
    if (!client) {
      throw new Error('Client not found');
    }

    try {
      if (!fs.existsSync(mediaPath)) {
        throw new Error('Media file not found');
      }

      const result = await client.sendFile(chatId, {
        file: mediaPath,
        caption: message || ''
      });
      
      return { success: true, messageId: result.id };
    } catch (err) {
      throw new Error(`Failed to send media: ${err.message}`);
    }
  }

  async getChats(accountId) {
    const account = this.accounts.get(accountId);
    if (!account || account.status !== 'ready') {
      throw new Error('Account not ready');
    }

    const client = this.clients.get(accountId);
    if (!client) {
      throw new Error('Client not found');
    }

    try {
      const dialogs = await client.getDialogs({ limit: 100 });
      return dialogs.map(dialog => ({
        id: dialog.id,
        title: dialog.title || dialog.name || 'Unknown',
        isGroup: dialog.isGroup,
        isChannel: dialog.isChannel,
        unreadCount: dialog.unreadCount || 0
      }));
    } catch (err) {
      throw new Error(`Failed to get chats: ${err.message}`);
    }
  }

  async getChatMessages(accountId, chatId, limit = 50) {
    const account = this.accounts.get(accountId);
    if (!account || account.status !== 'ready') {
      throw new Error('Account not ready');
    }

    const client = this.clients.get(accountId);
    if (!client) {
      throw new Error('Client not found');
    }

    try {
      const messages = await client.getMessages(chatId, { limit });
      return messages.map(msg => ({
        id: msg.id,
        text: msg.text || '',
        date: msg.date,
        fromId: msg.senderId,
        hasMedia: !!msg.media
      }));
    } catch (err) {
      throw new Error(`Failed to get messages: ${err.message}`);
    }
  }

  async downloadMedia(accountId, messageId) {
    const account = this.accounts.get(accountId);
    if (!account || account.status !== 'ready') {
      throw new Error('Account not ready');
    }

    try {
      // Download media from message
      return null;
    } catch (err) {
      throw new Error(`Failed to download media: ${err.message}`);
    }
  }

  _setupMessageHandler(accountId, client) {
    if (!this.isLibraryAvailable || !NewMessage) {
      console.error('[TelegramManager] Cannot setup message handler: Library not available');
      return;
    }

    try {
      client.addEventHandler(async (event) => {
        try {
          const message = event.message;
          if (message && message.message) {
            this.emit('message', {
              accountId,
              chatId: message.chatId,
              messageId: message.id,
              text: message.message,
              from: message.senderId,
              date: message.date
            });
          }
        } catch (err) {
          console.error(`[Telegram:${accountId}] Message handler error:`, err);
        }
      }, new NewMessage({}));
    } catch (err) {
      console.error(`[Telegram:${accountId}] Failed to setup message handler:`, err);
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async destroyAll() {
    // Cleanup all clients
    const promises = [];
    this.clients.forEach((client, accountId) => {
      promises.push(
        this.logout(accountId).catch(err => {
          console.error(`Error destroying ${accountId}:`, err);
        })
      );
    });
    await Promise.all(promises);
    this.clients.clear();
    this.reconnectTimers.clear();
  }
}

module.exports = TelegramManager;
