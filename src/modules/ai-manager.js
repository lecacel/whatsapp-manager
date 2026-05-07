const EventEmitter = require('events');
const Store = require('electron-store');
const axios = require('axios');
const FormData = require('form-data');

const store = new Store();

/**
 * AIManager - supports Gemini and OpenAI-compatible providers (Groq, OpenAI, etc.)
 * with auto-fallback, voice note transcription, and race-condition protection.
 */
class AIManager extends EventEmitter {
  constructor(waManager) {
    super();
    this.waManager = waManager;
    this.config = store.get('ai_config', {
      provider: 'gemini',
      apiKey: '',
      model: 'gemini-2.5-flash',
      openaiBaseUrl: '',
      openaiApiKey: '',
      openaiModel: 'gpt-4o-mini',
      autoFallback: true,
      systemPrompt:
        'Kamu adalah customer service yang ramah dan profesional. Jawab pertanyaan pelanggan dengan sopan, singkat, dan helpful. Gunakan bahasa Indonesia yang baik.',
      maxTokens: 500,
    });
    this.enabledAccounts = new Set(store.get('ai_enabled_accounts', []));
    this.log = store.get('ai_log', []);
    this.conversationHistory = {}; // phone -> [{role, parts}] (Gemini format)
    this.openaiHistory = {};       // phone -> [{role, content}] (OpenAI format)

    this.genAI = null;
    this.gemini = null;

    this._activeProvider = this.config.provider || 'gemini';

    this._initGemini();
  }

  _initGemini() {
    this.gemini = null;
    this.genAI = null;
    if (!this.config.apiKey) return;

    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      this.genAI = new GoogleGenerativeAI(this.config.apiKey);

      const modelName = this.config.model || 'gemini-2.5-flash';
      this.gemini = this.genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: this.config.systemPrompt,
      });
      console.log(`[AIManager] Gemini initialized with model: ${modelName}`);
    } catch (err) {
      console.error('[AIManager] Failed to initialize Gemini:', err.message);
      this.gemini = null;
    }
  }

  _openaiReady() {
    return !!(this.config.openaiApiKey);
  }

  /**
   * Returns the effective chat model for OpenAI-compatible providers.
   * If the configured model is whisper-* (audio-only), fall back to a default chat model.
   */
  _openaiChatModel() {
    const model = this.config.openaiModel || 'gpt-4o-mini';
    if (model.toLowerCase().includes('whisper')) {
      console.log(`[AIManager] Model '${model}' is audio-only. Using 'llama-3.1-8b-instant' for chat.`);
      return 'llama-3.1-8b-instant';
    }
    return model;
  }

  /**
   * Returns the model for audio transcription (only used with Groq/OpenAI).
   * If the user set whisper-large-v3, that's correct for transcription.
   */
  _openaiTranscriptionModel() {
    const model = this.config.openaiModel || 'whisper-large-v3';
    if (model.toLowerCase().includes('whisper')) {
      return model;
    }
    // If user didn't set whisper but wants transcription, default to whisper-large-v3
    return 'whisper-large-v3';
  }

  setConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    store.set('ai_config', this.config);
    this._activeProvider = this.config.provider || 'gemini';
    this._initGemini();
  }

  getConfig() {
    return { ...this.config };
  }

  _primaryProvider() {
    return this._activeProvider || this.config.provider || 'gemini';
  }

  /**
   * Fallback: if primary is OpenAI, stay within OpenAI ecosystem (don't fall to Gemini).
   * If primary is Gemini, fallback to OpenAI.
   */
  _fallbackProvider(current) {
    if (current === 'openai') {
      // Don't fallback to Gemini - just retry OpenAI
      return 'openai';
    }
    return current === 'gemini' ? 'openai' : 'gemini';
  }

  _isRateLimitError(err) {
    if (!err) return false;
    const msg = String(err.message || '');
    return (
      msg.includes('429') ||
      msg.includes('quota') ||
      msg.includes('rate limit') ||
      msg.includes('RESOURCE_EXHAUSTED') ||
      (err.response && err.response.status === 429)
    );
  }

  _isProviderAvailable(provider) {
    if (provider === 'gemini') return !!this.gemini;
    if (provider === 'openai') return this._openaiReady();
    return false;
  }

  // ─────────────────────────────────────────────
  // Unified text response (with fallback)
  // ─────────────────────────────────────────────

  async _getAIResponse(phone, userMessage) {
    const primary = this._primaryProvider();

    if (this._isProviderAvailable(primary)) {
      try {
        const response = await this._callProvider(primary, phone, userMessage, false);
        return response;
      } catch (err) {
        const isRateLimit = this._isRateLimitError(err);
        console.warn(`[AIManager] Primary provider '${primary}' failed:`, err.message);

        // Only attempt fallback if fallback is different from primary AND available
        const fallback = this._fallbackProvider(primary);
        if (this.config.autoFallback && fallback !== primary && this._isProviderAvailable(fallback)) {
          console.log(`[AIManager] Auto-fallback: switching to '${fallback}'`);
          this.emit('fallback', { from: primary, to: fallback, reason: err.message });

          try {
            const response = await this._callProvider(fallback, phone, userMessage, false);
            if (isRateLimit) {
              console.log(`[AIManager] Rate-limit on '${primary}'. Switching active provider to '${fallback}'.`);
              this._activeProvider = fallback;
            }
            return response;
          } catch (fallbackErr) {
            throw new Error(
              `Both providers failed. Primary (${primary}): ${err.message}. Fallback (${fallback}): ${fallbackErr.message}`
            );
          }
        }

        throw err;
      }
    }

    // Primary not available – try fallback directly (only Gemini → OpenAI, not OpenAI → Gemini)
    const fallback = this._fallbackProvider(primary);
    if (this.config.autoFallback && fallback !== primary && this._isProviderAvailable(fallback)) {
      console.log(`[AIManager] Primary '${primary}' not configured. Using fallback '${fallback}'.`);
      return this._callProvider(fallback, phone, userMessage, false);
    }

    throw new Error(
      `AI provider '${primary}' is not configured. Please set the API key in AI settings.`
    );
  }

  // ─────────────────────────────────────────────
  // Voice note handler (NEW: Groq Whisper transcription → Groq chat)
  // ─────────────────────────────────────────────

  async _getAIResponseWithAudio(phone, audioBase64, mimeType) {
    // If OpenAI-compatible provider is configured, try transcription first
    if (this._openaiReady()) {
      try {
        console.log('[AIManager] Transcribing voice note via OpenAI-compatible API (Groq/OpenAI)...');
        const transcript = await this._transcribeAudioOpenAI(audioBase64, mimeType);
        console.log(`[AIManager] Transcription result: "${transcript}"`);

        // Now send the transcript to chat model for response
        const chatPrompt = `Pengguna mengirim pesan suara (voice note) yang berisi: "${transcript}". Berikan respons yang sesuai.`;
        return await this._callProvider('openai', phone, chatPrompt, false);
      } catch (err) {
        console.warn('[AIManager] OpenAI transcription failed:', err.message);
        // Fallback to Gemini audio if available
        if (this.gemini) {
          console.log('[AIManager] Falling back to Gemini for voice note.');
          return await this._callGeminiAudio(phone, audioBase64, mimeType);
        }
        throw err;
      }
    }

    // Gemini audio handling
    if (this.gemini) {
      try {
        return await this._callGeminiAudio(phone, audioBase64, mimeType);
      } catch (err) {
        console.warn('[AIManager] Gemini audio failed:', err.message);
        throw err;
      }
    }

    throw new Error('No AI provider configured for audio messages.');
  }

  /**
   * Transcribe audio using OpenAI-compatible /audio/transcriptions endpoint.
   * Works with Groq (whisper-large-v3) and OpenAI (whisper-1).
   */
  async _transcribeAudioOpenAI(audioBase64, mimeType) {
    const baseUrl = (this.config.openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const model = this._openaiTranscriptionModel();
    const cleanMimeType = (mimeType || 'audio/ogg').split(';')[0].trim();

    // Convert base64 to Buffer for FormData
    const audioBuffer = Buffer.from(audioBase64, 'base64');

    const form = new FormData();
    form.append('file', audioBuffer, {
      filename: `voice.${cleanMimeType.split('/')[1] || 'ogg'}`,
      contentType: cleanMimeType,
    });
    form.append('model', model);
    // For Groq, language is optional but helps accuracy
    form.append('language', 'id');
    form.append('response_format', 'text');

    const response = await axios.post(
      `${baseUrl}/audio/transcriptions`,
      form,
      {
        headers: {
          Authorization: `Bearer ${this.config.openaiApiKey}`,
          ...form.getHeaders(),
        },
        timeout: 60000,
      }
    );

    const transcript = (response.data?.text || response.data?.trim() || '').trim();
    if (!transcript) throw new Error('Empty transcription result.');
    return transcript;
  }

  // ─────────────────────────────────────────────
  // Provider call dispatchers
  // ─────────────────────────────────────────────

  async _callProvider(provider, phone, userMessage, isTest = false) {
    if (provider === 'gemini') {
      return this._callGeminiText(phone, userMessage, isTest);
    }
    if (provider === 'openai') {
      return this._callOpenAIText(phone, userMessage, isTest);
    }
    throw new Error(`Unknown provider: ${provider}`);
  }

  // ─────────────────────────────────────────────
  // Gemini text
  // ─────────────────────────────────────────────

  async _callGeminiText(phone, userMessage, isTest = false) {
    if (!this.gemini) throw new Error('Gemini not initialized. Please set Gemini API key.');

    if (!isTest) {
      if (!this.conversationHistory[phone]) this.conversationHistory[phone] = [];
    }

    const history = isTest ? [] : this.conversationHistory[phone];

    const chat = this.gemini.startChat({
      history,
      generationConfig: {
        maxOutputTokens: this.config.maxTokens || 500,
        temperature: 0.7,
      },
    });

    const result = await this._executeWithRetry(() => chat.sendMessage(userMessage));
    const responseText = result.response.text();

    if (!isTest) {
      history.push(
        { role: 'user', parts: [{ text: userMessage }] },
        { role: 'model', parts: [{ text: responseText }] }
      );
      if (history.length > 20) {
        this.conversationHistory[phone] = history.slice(-20);
      }
    }

    return responseText;
  }

  // ─────────────────────────────────────────────
  // Gemini audio (multimodal)
  // ─────────────────────────────────────────────

  async _callGeminiAudio(phone, audioBase64, mimeType) {
    if (!this.gemini) throw new Error('Gemini not initialized.');

    const cleanMimeType = (mimeType || 'audio/ogg').split(';')[0].trim();

    if (!this.conversationHistory[phone]) this.conversationHistory[phone] = [];
    const history = this.conversationHistory[phone];

    const chat = this.gemini.startChat({
      history,
      generationConfig: {
        maxOutputTokens: this.config.maxTokens || 500,
        temperature: 0.7,
      },
    });

    const result = await this._executeWithRetry(() =>
      chat.sendMessage([
        { inlineData: { mimeType: cleanMimeType, data: audioBase64 } },
        {
          text: 'Pengguna mengirim pesan suara (voice note). Dengarkan audio ini, pahami isinya, lalu berikan respons yang sesuai dalam bahasa yang sama dengan audio tersebut.',
        },
      ])
    );

    const responseText = result.response.text();

    history.push(
      { role: 'user', parts: [{ text: '[Pengguna mengirim pesan suara/voice note]' }] },
      { role: 'model', parts: [{ text: responseText }] }
    );
    if (history.length > 20) {
      this.conversationHistory[phone] = history.slice(-20);
    }

    return responseText;
  }

  // ─────────────────────────────────────────────
  // OpenAI-compatible text (Groq, OpenAI, etc.)
  // ─────────────────────────────────────────────

  async _callOpenAIText(phone, userMessage, isTest = false) {
    if (!this._openaiReady()) throw new Error('OpenAI API key not configured.');

    const baseUrl = (this.config.openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    // Use chat model (not whisper)
    const model = this._openaiChatModel();
    const systemPrompt = this.config.systemPrompt ||
      'Kamu adalah customer service yang ramah dan profesional.';

    console.log(`[AIManager] OpenAI chat using model: ${model} | baseUrl: ${baseUrl}`);

    const messages = [{ role: 'system', content: systemPrompt }];

    if (!isTest) {
      if (!this.openaiHistory[phone]) this.openaiHistory[phone] = [];
      messages.push(...this.openaiHistory[phone]);
    }

    messages.push({ role: 'user', content: userMessage });

    const response = await this._executeWithRetryOpenAI(() =>
      axios.post(
        `${baseUrl}/chat/completions`,
        {
          model,
          messages,
          max_tokens: this.config.maxTokens || 500,
          temperature: 0.7,
        },
        {
          headers: {
            Authorization: `Bearer ${this.config.openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        }
      )
    );

    const responseText =
      response.data?.choices?.[0]?.message?.content?.trim() || '';

    if (!responseText) throw new Error('Empty response from OpenAI-compatible API.');

    if (!isTest) {
      this.openaiHistory[phone].push(
        { role: 'user', content: userMessage },
        { role: 'assistant', content: responseText }
      );
      if (this.openaiHistory[phone].length > 20) {
        this.openaiHistory[phone] = this.openaiHistory[phone].slice(-20);
      }
    }

    return responseText;
  }

  // ─────────────────────────────────────────────
  // Public test method
  // ─────────────────────────────────────────────

  async testAI(message) {
    const primary = this._primaryProvider();

    if (this._isProviderAvailable(primary)) {
      try {
        return await this._callProvider(primary, '__test__', message, true);
      } catch (err) {
        const fallback = this._fallbackProvider(primary);
        if (this.config.autoFallback && fallback !== primary && this._isProviderAvailable(fallback)) {
          console.log(`[AIManager] Test fallback: ${primary} → ${fallback}`);
          const result = await this._callProvider(fallback, '__test__', message, true);
          return `[Fallback ke ${fallback}] ${result}`;
        }
        throw err;
      }
    }

    const fallback = this._fallbackProvider(primary);
    if (this.config.autoFallback && fallback !== primary && this._isProviderAvailable(fallback)) {
      const result = await this._callProvider(fallback, '__test__', message, true);
      return `[Menggunakan ${fallback}] ${result}`;
    }

    throw new Error(
      'Tidak ada provider AI yang dikonfigurasi. Silakan isi API Key di pengaturan AI.'
    );
  }

  // ─────────────────────────────────────────────
  // handleMessage (called from whatsapp-manager)
  // ─────────────────────────────────────────────

  async handleMessage(accountId, msgData) {
    if (!this.enabledAccounts.has(accountId)) return;

    if (!this._isProviderAvailable('gemini') && !this._isProviderAvailable('openai')) return;

    if (msgData.from?.includes('@g.us')) return;

    // PENTING: Simpan SEMUA data ke variabel lokal SEBELUM await
    // Ini mencegah RACE CONDITION jika pesan lain masuk saat delay
    const targetPhone = msgData.from;
    const messageBody = msgData.body;
    const messageType = msgData.type;
    const contactName = msgData.contactName || '';
    const mediaData = msgData.mediaData ? { ...msgData.mediaData } : null;

    if (!targetPhone || typeof targetPhone !== 'string') {
      console.warn('[AIManager] Invalid target phone, skipping');
      return;
    }

    // Human-like delay
    const delay = Math.floor(Math.random() * 3000) + 2000;
    await this._sleep(delay);

    // DOUBLE CHECK: Pastikan msgData.from masih sama dengan yang kita simpan
    if (msgData.from !== targetPhone) {
      console.warn(`[AIManager] RACE CONDITION DICEGAH! Pesan untuk ${targetPhone} tidak dikirim ke ${msgData.from}`);
      return;
    }

    const isVoiceNote = (messageType === 'ptt' || messageType === 'audio') && mediaData;
    const userMessageLabel = isVoiceNote ? '[Voice Note]' : messageBody;

    try {
      let response;

      if (isVoiceNote) {
        response = await this._getAIResponseWithAudio(
          targetPhone,
          mediaData.data,
          mediaData.mimetype
        );
      } else {
        response = await this._getAIResponse(targetPhone, messageBody);
      }

      if (!response) return;

      console.log(`[AIManager] Mengirim respons ke ${targetPhone} (account: ${accountId})`);
      await this.waManager.sendMessage(accountId, targetPhone, response);

      const logEntry = {
        time: new Date().toISOString(),
        accountId,
        from: targetPhone,
        contactName: contactName,
        userMessage: userMessageLabel,
        aiResponse: response,
        status: 'sent',
      };

      this._addLog(logEntry);
      this.emit('replied', logEntry);
    } catch (err) {
      console.error('[AIManager] reply error:', err.message);

      if (this._isRateLimitError(err)) {
        try {
          const fallbackMsg =
            'Mohon maaf, sistem AI kami sedang sibuk/limit. Silakan coba lagi beberapa saat kemudian.';
          await this.waManager.sendMessage(accountId, targetPhone, fallbackMsg);
        } catch (fallbackErr) {
          console.error('[AIManager] Failed to send fallback msg:', fallbackErr.message);
        }
      }

      const logEntry = {
        time: new Date().toISOString(),
        accountId,
        from: targetPhone,
        contactName: contactName,
        userMessage: userMessageLabel,
        aiResponse: '',
        status: 'failed',
        error: err.message,
      };
      this._addLog(logEntry);
    }
  }

  // ─────────────────────────────────────────────
  // Account toggle helpers
  // ─────────────────────────────────────────────

  toggleForAccount(accountId, enabled) {
    if (enabled) {
      this.enabledAccounts.add(accountId);
    } else {
      this.enabledAccounts.delete(accountId);
    }
    store.set('ai_enabled_accounts', [...this.enabledAccounts]);
  }

  isEnabledForAccount(accountId) {
    return this.enabledAccounts.has(accountId);
  }

  getEnabledAccounts() {
    return [...this.enabledAccounts];
  }

  clearHistory(phone) {
    if (phone) {
      delete this.conversationHistory[phone];
      delete this.openaiHistory[phone];
    } else {
      this.conversationHistory = {};
      this.openaiHistory = {};
    }
  }

  // ─────────────────────────────────────────────
  // Log helpers
  // ─────────────────────────────────────────────

  _addLog(entry) {
    this.log.unshift(entry);
    if (this.log.length > 500) this.log = this.log.slice(0, 500);
    store.set('ai_log', this.log);
  }

  getLog() {
    return this.log.slice(0, 100);
  }

  // ─────────────────────────────────────────────
  // Retry helpers
  // ─────────────────────────────────────────────

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async _executeWithRetry(apiCallFunc, maxRetries = 2) {
    let retries = 0;
    while (true) {
      try {
        return await apiCallFunc();
      } catch (err) {
        if (this._isRateLimitError(err) && retries < maxRetries) {
          retries++;
          let delayMs = 15000;
          const match = (err.message || '').match(/retry in (\d+(?:\.\d+)?)s/i);
          if (match && match[1]) {
            delayMs = Math.ceil(parseFloat(match[1]) * 1000) + 1000;
          }
          console.warn(
            `[AIManager] Gemini rate-limit. Retrying in ${delayMs / 1000}s... (${retries}/${maxRetries})`
          );
          await this._sleep(delayMs);
          continue;
        }
        throw err;
      }
    }
  }

  async _executeWithRetryOpenAI(apiCallFunc, maxRetries = 2) {
    let retries = 0;
    while (true) {
      try {
        return await apiCallFunc();
      } catch (err) {
        const status = err.response?.status;
        const isRateLimit = status === 429 || this._isRateLimitError(err);
        if (isRateLimit && retries < maxRetries) {
          retries++;
          const retryAfter = err.response?.headers?.['retry-after'];
          let delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 + 1000 : 15000;
          console.warn(
            `[AIManager] OpenAI rate-limit. Retrying in ${delayMs / 1000}s... (${retries}/${maxRetries})`
          );
          await this._sleep(delayMs);
          continue;
        }

        if (err.response) {
          const body = err.response.data;
          const detail =
            (typeof body === 'object' ? body?.error?.message || JSON.stringify(body) : body) ||
            err.message;
          throw new Error(`OpenAI API error ${status}: ${detail}`);
        }

        throw err;
      }
    }
  }
}

module.exports = AIManager;