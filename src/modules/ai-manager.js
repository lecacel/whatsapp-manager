const EventEmitter = require('events');
const Store = require('electron-store');

const store = new Store();

class AIManager extends EventEmitter {
  constructor(waManager) {
    super();
    this.waManager = waManager;
    this.config = store.get('ai_config', {
      apiKey: '',
      model: 'gemini-2.5-flash',
      systemPrompt: 'Kamu adalah customer service yang ramah dan profesional. Jawab pertanyaan pelanggan dengan sopan, singkat, dan helpful. Gunakan bahasa Indonesia yang baik.',
      maxTokens: 500,
      enabled: false
    });
    this.enabledAccounts = new Set(store.get('ai_enabled_accounts', []));
    this.log = store.get('ai_log', []);
    this.conversationHistory = {}; // phone -> [{role, parts}]
    this.gemini = null;
    this.genAI = null;
    this._initGemini();
  }

  _initGemini() {
    if (!this.config.apiKey) return;

    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      this.genAI = new GoogleGenerativeAI(this.config.apiKey);
      
      let modelName = this.config.model || 'gemini-2.5-flash';

      this.gemini = this.genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: this.config.systemPrompt
      });
      console.log(`Gemini AI initialized successfully with model: ${modelName}`);
    } catch (err) {
      console.error('Failed to initialize Gemini:', err.message);
      this.gemini = null;
    }
  }

  setConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    store.set('ai_config', this.config);
    this._initGemini();
  }

  getConfig() {
    return { ...this.config };
  }

  async handleMessage(accountId, msgData) {
    // Check if AI enabled for this account
    if (!this.enabledAccounts.has(accountId)) return;
    if (!this.gemini) return;

    // Skip group messages unless configured
    if (msgData.from?.includes('@g.us')) return;

    // Add response delay (human-like)
    const delay = Math.floor(Math.random() * 3000) + 2000; // 2-5 seconds
    await this._sleep(delay);

    try {
      const response = await this._getAIResponse(msgData.from, msgData.body);

      if (!response) return;

      await this.waManager.sendMessage(accountId, msgData.from, response);

      const logEntry = {
        time: new Date().toISOString(),
        accountId,
        from: msgData.from,
        contactName: msgData.contactName || '',
        userMessage: msgData.body,
        aiResponse: response,
        status: 'sent'
      };

      this._addLog(logEntry);
      this.emit('replied', logEntry);

    } catch (err) {
      console.error('AI reply error:', err);
      const logEntry = {
        time: new Date().toISOString(),
        accountId,
        from: msgData.from,
        contactName: msgData.contactName || '',
        userMessage: msgData.body,
        aiResponse: '',
        status: 'failed',
        error: err.message
      };
      this._addLog(logEntry);
    }
  }

  async _getAIResponse(phone, userMessage) {
    if (!this.gemini) throw new Error('Gemini not initialized. Please set API key.');

    // Get or create conversation history for this contact
    if (!this.conversationHistory[phone]) {
      this.conversationHistory[phone] = [];
    }

    const history = this.conversationHistory[phone];

    try {
      // Build chat with history
      const chat = this.gemini.startChat({
        history: history,
        generationConfig: {
          maxOutputTokens: this.config.maxTokens || 500,
          temperature: 0.7
        }
      });

      const result = await chat.sendMessage(userMessage);
      const responseText = result.response.text();

      // Update history (keep last 10 exchanges = 20 messages)
      history.push(
        { role: 'user', parts: [{ text: userMessage }] },
        { role: 'model', parts: [{ text: responseText }] }
      );

      if (history.length > 20) {
        this.conversationHistory[phone] = history.slice(-20);
      }

      return responseText;

    } catch (err) {
      throw new Error(`Gemini API error: ${err.message}`);
    }
  }

  async testAI(message) {
    if (!this.gemini) throw new Error('Gemini not initialized. Please set API key in AI settings.');

    const chat = this.gemini.startChat({
      generationConfig: {
        maxOutputTokens: this.config.maxTokens || 500,
        temperature: 0.7
      }
    });

    const result = await chat.sendMessage(message);
    return result.response.text();
  }

  toggleForAccount(accountId, enabled) {
    if (enabled) {
      this.enabledAccounts.add(accountId);
    } else {
      this.enabledAccounts.delete(accountId);
      // Clear conversation history for this account
      delete this.conversationHistory[accountId];
    }
    store.set('ai_enabled_accounts', [...this.enabledAccounts]);
  }

  isEnabledForAccount(accountId) {
    return this.enabledAccounts.has(accountId);
  }

  clearHistory(phone) {
    if (phone) {
      delete this.conversationHistory[phone];
    } else {
      this.conversationHistory = {};
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  _addLog(entry) {
    this.log.unshift(entry);
    if (this.log.length > 500) this.log = this.log.slice(0, 500);
    store.set('ai_log', this.log);
  }

  getEnabledAccounts() {
    return [...this.enabledAccounts];
  }

  getLog() {
    return this.log.slice(0, 100);
  }
}

module.exports = AIManager;