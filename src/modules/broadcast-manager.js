const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const Store = require('electron-store');

const store = new Store();

class BroadcastManager extends EventEmitter {
  constructor(waManager) {
    super();
    this.waManager = waManager;
    this.activeBroadcasts = {}; // broadcastId -> { running, timer }
    this.broadcastList = store.get('broadcasts', []);
  }

  /**
   * Start a broadcast
   * @param {Object} params
   * @param {string} params.accountId - WhatsApp account to use
   * @param {string[]} params.recipients - List of phone numbers
   * @param {string} params.message - Message text
   * @param {string|null} params.mediaPath - Optional file attachment
   * @param {number} params.minDelay - Minimum delay between messages (ms)
   * @param {number} params.maxDelay - Maximum delay between messages (ms)
   * @param {string} params.name - Broadcast name
   */
  async startBroadcast(params) {
    const {
      accountId,
      recipients,
      message,
      mediaPath = null,
      minDelay = 5000,
      maxDelay = 15000,
      name = 'Broadcast'
    } = params;

    if (!recipients || recipients.length === 0) {
      throw new Error('No recipients provided');
    }

    const broadcastId = uuidv4();
    const broadcast = {
      id: broadcastId,
      name,
      accountId,
      totalRecipients: recipients.length,
      sent: 0,
      failed: 0,
      status: 'running',
      startTime: new Date().toISOString(),
      endTime: null,
      log: []
    };

    this.broadcastList.unshift(broadcast);
    this.saveBroadcasts();

    this.activeBroadcasts[broadcastId] = { running: true };

    // Start sending asynchronously
    this._processBroadcast(broadcastId, broadcast, recipients, message, mediaPath, minDelay, maxDelay);

    return broadcastId;
  }

  async _processBroadcast(broadcastId, broadcast, recipients, message, mediaPath, minDelay, maxDelay) {
    for (let i = 0; i < recipients.length; i++) {
      // Check if stopped
      if (!this.activeBroadcasts[broadcastId]?.running) {
        broadcast.status = 'stopped';
        broadcast.endTime = new Date().toISOString();
        this.saveBroadcasts();
        this.emit('completed', { broadcastId, status: 'stopped', sent: broadcast.sent, failed: broadcast.failed });
        return;
      }

      const recipient = recipients[i].trim();
      if (!recipient) continue;

      try {
        if (mediaPath) {
          await this.waManager.sendMessageWithMedia(broadcast.accountId, recipient, message, mediaPath);
        } else {
          await this.waManager.sendMessage(broadcast.accountId, recipient, message);
        }

        broadcast.sent++;
        broadcast.log.push({
          time: new Date().toISOString(),
          recipient,
          status: 'sent'
        });

        this.emit('progress', {
          broadcastId,
          current: i + 1,
          total: recipients.length,
          sent: broadcast.sent,
          failed: broadcast.failed,
          recipient,
          status: 'sent'
        });

      } catch (err) {
        broadcast.failed++;
        broadcast.log.push({
          time: new Date().toISOString(),
          recipient,
          status: 'failed',
          error: err.message
        });

        this.emit('progress', {
          broadcastId,
          current: i + 1,
          total: recipients.length,
          sent: broadcast.sent,
          failed: broadcast.failed,
          recipient,
          status: 'failed',
          error: err.message
        });
      }

      this.saveBroadcasts();

      // Wait before next message (random delay to avoid spam detection)
      if (i < recipients.length - 1) {
        const delay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
        await this._sleep(delay, broadcastId);
      }
    }

    // Broadcast completed
    broadcast.status = 'completed';
    broadcast.endTime = new Date().toISOString();
    this.saveBroadcasts();

    delete this.activeBroadcasts[broadcastId];

    this.emit('completed', {
      broadcastId,
      status: 'completed',
      sent: broadcast.sent,
      failed: broadcast.failed
    });
  }

  _sleep(ms, broadcastId) {
    return new Promise((resolve) => {
      const interval = 100;
      let elapsed = 0;
      
      const check = () => {
        if (!this.activeBroadcasts[broadcastId]?.running) {
          resolve();
          return;
        }
        elapsed += interval;
        if (elapsed >= ms) {
          resolve();
        } else {
          setTimeout(check, interval);
        }
      };

      setTimeout(check, interval);
    });
  }

  stopBroadcast(broadcastId) {
    if (this.activeBroadcasts[broadcastId]) {
      this.activeBroadcasts[broadcastId].running = false;
    }

    const broadcast = this.broadcastList.find(b => b.id === broadcastId);
    if (broadcast) {
      broadcast.status = 'stopping';
      this.saveBroadcasts();
    }
  }

  getBroadcastList() {
    return this.broadcastList.slice(0, 50); // Return last 50
  }

  saveBroadcasts() {
    store.set('broadcasts', this.broadcastList.slice(0, 100));
  }
}

module.exports = BroadcastManager;