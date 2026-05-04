const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');
const Store = require('electron-store');

const store = new Store();

class AutoReplyManager extends EventEmitter {
  constructor(waManager) {
    super();
    this.waManager = waManager;
    this.rules = store.get('autoreply_rules', []);
    this.enabledAccounts = new Set(store.get('autoreply_enabled_accounts', []));
    this.log = store.get('autoreply_log', []);
  }

  /**
   * Handle incoming message and check autoreply rules
   */
  async handleMessage(accountId, msgData) {
    // Check if autoreply enabled for this account
    if (!this.enabledAccounts.has(accountId)) return;

    // Don't reply to groups unless rule specifies
    const isGroup = msgData.from?.includes('@g.us');

    const matchedRule = this._findMatchingRule(msgData.body, isGroup);
    if (!matchedRule) return;

    // Add delay to seem more human
    const delay = Math.floor(Math.random() * 3000) + 1000; // 1-4 seconds
    await this._sleep(delay);

    try {
      await this.waManager.sendMessage(accountId, msgData.from, matchedRule.reply);

      const logEntry = {
        time: new Date().toISOString(),
        accountId,
        from: msgData.from,
        contactName: msgData.contactName || '',
        trigger: msgData.body,
        reply: matchedRule.reply,
        ruleName: matchedRule.name,
        status: 'sent'
      };

      this._addLog(logEntry);
      this.emit('replied', logEntry);

    } catch (err) {
      const logEntry = {
        time: new Date().toISOString(),
        accountId,
        from: msgData.from,
        contactName: msgData.contactName || '',
        trigger: msgData.body,
        reply: matchedRule.reply,
        ruleName: matchedRule.name,
        status: 'failed',
        error: err.message
      };

      this._addLog(logEntry);
    }
  }

  _findMatchingRule(messageBody, isGroup) {
    if (!messageBody) return null;
    const body = messageBody.toLowerCase().trim();

    // Sort rules by priority (higher priority first)
    const sortedRules = [...this.rules]
      .filter(r => r.enabled !== false)
      .filter(r => !isGroup || r.replyInGroups)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));

    for (const rule of sortedRules) {
      if (this._matchesKeyword(body, rule)) {
        return rule;
      }
    }

    return null;
  }

  _matchesKeyword(body, rule) {
    const keywords = Array.isArray(rule.keywords)
      ? rule.keywords
      : [rule.keywords || rule.keyword || ''];

    for (const kw of keywords) {
      if (!kw) continue;
      const keyword = kw.toLowerCase().trim();

      switch (rule.matchType) {
        case 'exact':
          if (body === keyword) return true;
          break;
        case 'contains':
          if (body.includes(keyword)) return true;
          break;
        case 'startsWith':
          if (body.startsWith(keyword)) return true;
          break;
        case 'regex':
          try {
            const regex = new RegExp(keyword, 'i');
            if (regex.test(body)) return true;
          } catch (e) {}
          break;
        default: // default: contains
          if (body.includes(keyword)) return true;
      }
    }

    return false;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _addLog(entry) {
    this.log.unshift(entry);
    if (this.log.length > 500) this.log = this.log.slice(0, 500);
    store.set('autoreply_log', this.log);
  }

  // ============================================================
  // Rule Management
  // ============================================================

  getRules() {
    return this.rules;
  }

  addRule(rule) {
    const newRule = {
      id: uuidv4(),
      name: rule.name || 'Rule',
      keywords: Array.isArray(rule.keywords) ? rule.keywords : [rule.keywords || ''],
      matchType: rule.matchType || 'contains',
      reply: rule.reply || '',
      replyInGroups: rule.replyInGroups || false,
      priority: rule.priority || 0,
      enabled: rule.enabled !== false
    };

    this.rules.push(newRule);
    store.set('autoreply_rules', this.rules);
    return newRule;
  }

  updateRule(updatedRule) {
    const index = this.rules.findIndex(r => r.id === updatedRule.id);
    if (index === -1) throw new Error('Rule not found');

    this.rules[index] = {
      ...this.rules[index],
      ...updatedRule
    };

    store.set('autoreply_rules', this.rules);
  }

  deleteRule(ruleId) {
    this.rules = this.rules.filter(r => r.id !== ruleId);
    store.set('autoreply_rules', this.rules);
  }

  toggleForAccount(accountId, enabled) {
    if (enabled) {
      this.enabledAccounts.add(accountId);
    } else {
      this.enabledAccounts.delete(accountId);
    }
    store.set('autoreply_enabled_accounts', [...this.enabledAccounts]);
  }

  isEnabledForAccount(accountId) {
    return this.enabledAccounts.has(accountId);
  }

  getLog() {
    return this.log.slice(0, 100);
  }

  getEnabledAccounts() {
    return [...this.enabledAccounts];
  }
}

module.exports = AutoReplyManager;