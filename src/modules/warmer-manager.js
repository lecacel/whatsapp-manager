const EventEmitter = require('events');

const Store = require('electron-store');

const store = new Store();

// Warming messages pool - realistic conversation starters
const WARMING_MESSAGES = [
  'Halo! Apa kabar?',
  'Selamat pagi! Semoga harimu menyenangkan 😊',
  'Hai, ada yang bisa dibantu?',
  'Halo, bagaimana kabarnya hari ini?',
  'Selamat siang! Sudah makan belum?',
  'Hey! Lagi sibuk nggak?',
  'Halo, lagi apa nih?',
  'Wah, cuaca hari ini bagus ya',
  'Selamat malam! Sudah istirahat?',
  'Hai! Gimana aktivitas hari ini?',
  'Halo, semoga sehat selalu ya',
  'Pagi! Semangat hari ini 💪',
  'Halo, masih ingat saya kan? 😄',
  'Hey, apa kabar? Lama tidak berkabar',
  'Halo! Semoga rezekimu lancar hari ini',
  'Selamat datang! Ada yang perlu dibantu?',
  'Halo, terima kasih sudah menghubungi',
  'Baik-baik saja? Semoga sehat selalu',
  'Hai, hari ini ada agenda apa?',
  'Halo! Jangan lupa istirahat yang cukup ya'
];

const WARMING_REPLIES = [
  'Alhamdulillah baik, terima kasih sudah bertanya 😊',
  'Baik-baik saja, kamu gimana?',
  'Kabar baik! Terima kasih',
  'Alhamdulillah sehat, makasih ya',
  'Baik! Kamu sendiri gimana?',
  'Fine aja, thanks! 😄',
  'Alhamdulillah, baik. Kamu?',
  'Sehat wal afiat, terima kasih',
  'Baik, sedang sibuk sedikit nih',
  'Alhamdulillah, lagi santai nih',
  'Baik! Lagi di rumah nih',
  'Fine, makasih udah nanya 😊',
  'Sehat, Alhamdulillah. Semoga kamu juga ya',
  'Baik, sedang makan nih hehe',
  'Alhamdulillah baik, lagi kerja'
];

// Extended conversation follow-ups for human-like mode
const FOLLOW_UPS = [
  'Oh iya, kamu lagi kerja dari rumah atau dari kantor?',
  'Btw, ada rencana apa weekend ini?',
  'Kemarin aku baru coba restoran baru, enak banget! 😄',
  'Udah nonton film baru yang lagi viral?',
  'Lagi ada promo menarik nih, mau tau nggak?',
  'Oh gitu, syukurlah kalau baik 🙏',
  'Haha iya sama, aku juga lagi santai aja',
  'Wah sibuk ya, jangan lupa istirahat ya',
  'Oke deh, kapan-kapan kita ngobrol lagi ya',
  'Semoga lancar ya kerjanya hari ini 💪'
];

const FOLLOW_UP_REPLIES = [
  'Iya nih, dari rumah aja hehe',
  'Belum ada rencana sih, kamu?',
  'Wah mau dong infonya! 😄',
  'Belum sempet nonton, lagi sibuk banget',
  'Boleh, share dong!',
  'Aamiin, makasih ya 🙏',
  'Haha iya, nikmatin aja',
  'Siap, makasih ya! Kamu juga jaga kesehatan',
  'Oke siap! Chat lagi ya kapan-kapan',
  'Aamiin, kamu juga ya! 😊'
];

class WarmerManager extends EventEmitter {
  constructor(waManager) {
    super();
    this.waManager = waManager;
    this.isRunning = false;
    this.warmerInterval = null;
    this.log = store.get('warmer_log', []);
    this.config = store.get('warmer_config', {
      minInterval: 2000,   // 2 seconds
      maxInterval: 6000,   // 6 seconds
      typingMin: 500,      // 0.5 seconds typing (faster)
      typingMax: 1500,     // 1.5 seconds typing (faster)
      humanMode: true,     // conversational mode
      accountPairs: []
    });
  }

  /**
   * Start the account warmer
   */
  startWarmer(params) {
    if (this.isRunning) {
      this.stopWarmer();
    }

    const {
      accountPairs = [],
      minInterval = 2000,
      maxInterval = 6000,
      typingMin = 500, // Defaulting to faster typing
      typingMax = 1500, // Defaulting to faster typing
      humanMode = true
    } = params;

    if (accountPairs.length === 0) {
      throw new Error('No account pairs provided');
    }

    this.config = {
      minInterval: Math.max(1000, minInterval),
      maxInterval: Math.max(minInterval, maxInterval),
      typingMin: Math.max(500, typingMin),
      typingMax: Math.max(typingMin, typingMax),
      humanMode,
      accountPairs
    };
    store.set('warmer_config', this.config);

    this.isRunning = true;
    store.set('warmer_running', true);
    this.emit('status', { running: true, message: 'Warmer started' });

    this._scheduleNextMessage();
  }

  _scheduleNextMessage() {
    if (!this.isRunning) return;

    const minInterval = Math.max(1000, this.config.minInterval || 2000);
    const maxInterval = Math.max(minInterval, this.config.maxInterval || 6000);
    const delay = Math.floor(
      Math.random() * (maxInterval - minInterval + 1)
    ) + minInterval;

    this.warmerInterval = setTimeout(() => {
      this._sendWarmingMessage();
    }, delay);

    this.emit('status', {
      running: true,
      nextMessageIn: delay,
      message: `Next warming message in ${Math.round(delay / 1000)}s`
    });
  }

  async _sendWarmingMessage() {
    if (!this.isRunning) return;

    const readyClients = this.waManager.getReadyClients();

    if (readyClients.length < 2) {
      this.emit('status', {
        running: true,
        message: 'Need at least 2 connected accounts for warming'
      });
      this._scheduleNextMessage();
      return;
    }

    // Find valid pairs that are both ready
    const validPairs = this.config.accountPairs.filter(pair => {
      const [a, b] = pair;
      return (
        readyClients.find(c => c.id === a) &&
        readyClients.find(c => c.id === b)
      );
    });

    let acc1, acc2;
    if (validPairs.length === 0) {
      [acc1, acc2] = readyClients;
    } else {
      const pair = validPairs[Math.floor(Math.random() * validPairs.length)];
      acc1 = readyClients.find(c => c.id === pair[0]);
      acc2 = readyClients.find(c => c.id === pair[1]);
    }

    if (acc1 && acc2) {
      if (this.config.humanMode) {
        await this._sendConversation(acc1, acc2);
      } else {
        await this._sendBetween(acc1, acc2);
      }
    }

    this._scheduleNextMessage();
  }

  /**
   * Human-like conversation: A sends, typing indicator, B replies, optional follow-up
   */
  async _sendConversation(acc1, acc2) {
    // Randomly pick who starts
    const sender = Math.random() > 0.5 ? acc1 : acc2;
    const receiver = sender === acc1 ? acc2 : acc1;

    // Step 1: Sender sends greeting
    const greeting = WARMING_MESSAGES[Math.floor(Math.random() * WARMING_MESSAGES.length)];
    
    // Simulate sender typing before sending
    const senderTypingDuration = this._randomTypingDuration();
    this.emit('status', {
      running: true,
      message: `${sender.name || sender.id} is typing...`
    });

    // Send typing state via WhatsApp
    await this._sendTypingState(sender.id, receiver);
    await this._sleep(senderTypingDuration);
    if (!this.isRunning) return;

    const sentOk = await this._doSend(sender, receiver, greeting);
    if (!sentOk) return;

    // Step 2: Wait a natural "read + think" delay (1-3 seconds)
    const readDelay = 1000 + Math.floor(Math.random() * 2000);
    await this._sleep(readDelay);
    if (!this.isRunning) return;

    // Step 3: Receiver types and replies
    const reply = WARMING_REPLIES[Math.floor(Math.random() * WARMING_REPLIES.length)];
    const receiverTypingDuration = this._randomTypingDuration();
    
    this.emit('status', {
      running: true,
      message: `${receiver.name || receiver.id} is typing...`
    });

    await this._sendTypingState(receiver.id, sender);
    await this._sleep(receiverTypingDuration);
    if (!this.isRunning) return;

    await this._doSend(receiver, sender, reply);

    // Step 4: Optionally continue conversation (50% chance)
    if (Math.random() > 0.5) {
      const followUpDelay = 2000 + Math.floor(Math.random() * 3000);
      await this._sleep(followUpDelay);
      if (!this.isRunning) return;

      const followUp = FOLLOW_UPS[Math.floor(Math.random() * FOLLOW_UPS.length)];
      const followTyping = this._randomTypingDuration();

      this.emit('status', {
        running: true,
        message: `${sender.name || sender.id} is typing...`
      });

      await this._sendTypingState(sender.id, receiver);
      await this._sleep(followTyping);
      if (!this.isRunning) return;

      const sent2 = await this._doSend(sender, receiver, followUp);
      if (!sent2) return;

      // Reply to follow-up
      const readDelay2 = 1000 + Math.floor(Math.random() * 2000);
      await this._sleep(readDelay2);
      if (!this.isRunning) return;

      const followReply = FOLLOW_UP_REPLIES[Math.floor(Math.random() * FOLLOW_UP_REPLIES.length)];
      const followReplyTyping = this._randomTypingDuration();

      this.emit('status', {
        running: true,
        message: `${receiver.name || receiver.id} is typing...`
      });

      await this._sendTypingState(receiver.id, sender);
      await this._sleep(followReplyTyping);
      if (!this.isRunning) return;

      await this._doSend(receiver, sender, followReply);
    }
  }

  /**
   * Send typing state via WhatsApp client
   */
  async _sendTypingState(senderId, receiverAcc) {
    try {
      const client = await this.waManager.getClient(senderId);
      if (client) {
        const receiverInfo = this.waManager.clients[receiverAcc.id]?.info;
        if (receiverInfo?.phone) {
          const chatId = receiverInfo.phone + '@c.us';
          const chat = await client.getChatById(chatId);
          if (chat) {
            await chat.sendStateTyping();
          }
        }
      }
    } catch (e) {
      // Ignore typing state errors
    }
  }

  /**
   * Actually send a message and log it
   */
  async _doSend(sender, receiver, message) {
    try {
      const receiverInfo = this.waManager.clients[receiver.id]?.info;
      if (!receiverInfo?.phone) {
        throw new Error('Receiver phone not available');
      }

      const receiverPhone = receiverInfo.phone + '@c.us';
      const client = await this.waManager.getClient(sender.id);
      if (client) {
        // Clear typing state
        try {
          const chat = await client.getChatById(receiverPhone);
          if (chat) await chat.clearState();
        } catch (e) {}

        await client.sendMessage(receiverPhone, message);
      }

      const logEntry = {
        time: new Date().toISOString(),
        from: sender.name || sender.id,
        to: receiver.name || receiver.id,
        message,
        status: 'sent'
      };

      this.log.unshift(logEntry);
      if (this.log.length > 200) this.log = this.log.slice(0, 200);
      store.set('warmer_log', this.log);

      this.emit('message_sent', logEntry);
      return true;

    } catch (err) {
      const logEntry = {
        time: new Date().toISOString(),
        from: sender.name || sender.id,
        to: receiver.name || receiver.id,
        message,
        status: 'failed',
        error: err.message
      };

      this.log.unshift(logEntry);
      store.set('warmer_log', this.log);

      this.emit('message_sent', logEntry);
      return false;
    }
  }

  /**
   * Simple send (non-human mode)
   */
  async _sendBetween(acc1, acc2) {
    const sender = Math.random() > 0.5 ? acc1 : acc2;
    const receiver = sender === acc1 ? acc2 : acc1;
    const message = WARMING_MESSAGES[Math.floor(Math.random() * WARMING_MESSAGES.length)];
    await this._doSend(sender, receiver, message);
  }

  /**
   * Calculates a random typing duration (faster for natural chat)
   */
  _randomTypingDuration() {
    const min = Math.max(300, this.config.typingMin || 500); // Min 300ms
    const max = Math.max(min, this.config.typingMax || 1500); // Max 1.5s
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  _sleep(ms) {
    return new Promise(resolve => {
      const timer = setTimeout(resolve, ms);
      // Store timer so we can check isRunning
      this._sleepTimer = timer;
    });
  }

  stopWarmer() {
    this.isRunning = false;
    if (this.warmerInterval) {
      clearTimeout(this.warmerInterval);
      this.warmerInterval = null;
    }
    if (this._sleepTimer) {
      clearTimeout(this._sleepTimer);
      this._sleepTimer = null;
    }
    this.emit('status', { running: false, message: 'Warmer stopped' });
    store.set('warmer_running', false);
  }

  getStatus() {
    return {
      running: this.isRunning,
      config: this.config
    };
  }

  getLog() {
    return this.log.slice(0, 100);
  }
}

module.exports = WarmerManager;
