const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('api', {
  // ============================================================
  // WhatsApp Account Management
  // ============================================================
  wa: {
    addAccount: (params) => ipcRenderer.invoke('wa:add-account', params),
    removeAccount: (params) => ipcRenderer.invoke('wa:remove-account', params),
    getAccounts: () => ipcRenderer.invoke('wa:get-accounts'),
    getStatus: (params) => ipcRenderer.invoke('wa:get-status', params),
    logout: (params) => ipcRenderer.invoke('wa:logout', params),
    getContacts: (params) => ipcRenderer.invoke('wa:get-contacts', params),
    getAllChats: (params) => ipcRenderer.invoke('wa:get-all-chats', params),
    sendMessage: (params) => ipcRenderer.invoke('wa:send-message', params),

    // Events from main process
    onQR: (callback) => ipcRenderer.on('wa:qr', (_, data) => callback(data)),
    onReady: (callback) => ipcRenderer.on('wa:ready', (_, data) => callback(data)),
    onDisconnected: (callback) => ipcRenderer.on('wa:disconnected', (_, data) => callback(data)),
    onMessage: (callback) => ipcRenderer.on('wa:message', (_, data) => callback(data)),
    onAuthFailure: (callback) => ipcRenderer.on('wa:auth_failure', (_, data) => callback(data)),
    onAuthenticated: (callback) => ipcRenderer.on('wa:authenticated', (_, data) => callback(data)),

    removeListener: (channel) => ipcRenderer.removeAllListeners(channel)
  },

  // ============================================================
  // Chat
  // ============================================================
  chat: {
    getMessages: (params) => ipcRenderer.invoke('chat:get-messages', params),
    downloadMedia: (params) => ipcRenderer.invoke('chat:download-media', params)
  },

  // ============================================================
  // Broadcast
  // ============================================================
  broadcast: {
    start: (params) => ipcRenderer.invoke('broadcast:start', params),
    stop: (params) => ipcRenderer.invoke('broadcast:stop', params),
    getList: () => ipcRenderer.invoke('broadcast:get-list'),

    onProgress: (callback) => ipcRenderer.on('broadcast:progress', (_, data) => callback(data)),
    onCompleted: (callback) => ipcRenderer.on('broadcast:completed', (_, data) => callback(data)),
    onError: (callback) => ipcRenderer.on('broadcast:error', (_, data) => callback(data))
  },

  // ============================================================
  // Warmer
  // ============================================================
  warmer: {
    start: (params) => ipcRenderer.invoke('warmer:start', params),
    stop: () => ipcRenderer.invoke('warmer:stop'),
    getStatus: () => ipcRenderer.invoke('warmer:get-status'),
    getLog: () => ipcRenderer.invoke('warmer:get-log'),

    onMessageSent: (callback) => ipcRenderer.on('warmer:message_sent', (_, data) => callback(data)),
    onStatus: (callback) => ipcRenderer.on('warmer:status', (_, data) => callback(data))
  },

  // ============================================================
  // Auto Reply
  // ============================================================
  autoReply: {
    getRules: () => ipcRenderer.invoke('autoreply:get-rules'),
    addRule: (rule) => ipcRenderer.invoke('autoreply:add-rule', rule),
    updateRule: (rule) => ipcRenderer.invoke('autoreply:update-rule', rule),
    deleteRule: (params) => ipcRenderer.invoke('autoreply:delete-rule', params),
    toggle: (params) => ipcRenderer.invoke('autoreply:toggle', params),
    getEnabledAccounts: () => ipcRenderer.invoke('autoreply:get-enabled-accounts'),
    getLog: () => ipcRenderer.invoke('autoreply:get-log'),

    onReplied: (callback) => ipcRenderer.on('autoreply:replied', (_, data) => callback(data))
  },

  // ============================================================
  // AI Customer Service
  // ============================================================
  ai: {
    setConfig: (config) => ipcRenderer.invoke('ai:set-config', config),
    getConfig: () => ipcRenderer.invoke('ai:get-config'),
    toggle: (params) => ipcRenderer.invoke('ai:toggle', params),
    getEnabledAccounts: () => ipcRenderer.invoke('ai:get-enabled-accounts'),
    getLog: () => ipcRenderer.invoke('ai:get-log'),
    test: (params) => ipcRenderer.invoke('ai:test', params),

    onReplied: (callback) => ipcRenderer.on('ai:replied', (_, data) => callback(data))
  },

  // ============================================================
  // Dialog
  // ============================================================
  dialog: {
    openFile: (options) => ipcRenderer.invoke('dialog:open-file', options)
  },

  // ============================================================
  // Auto-Updater
  // ============================================================
  updater: {
    checkForUpdate: () => ipcRenderer.invoke('update:check'),
    downloadUpdate: () => ipcRenderer.invoke('update:download'),
    installAndRestart: () => ipcRenderer.invoke('update:install-and-restart'),

    // Events from main process
    onChecking: (callback) => ipcRenderer.on('update:checking', () => callback()),
    onAvailable: (callback) => ipcRenderer.on('update:available', (_, info) => callback(info)),
    onNotAvailable: (callback) => ipcRenderer.on('update:not-available', (_, info) => callback(info)),
    onProgress: (callback) => ipcRenderer.on('update:progress', (_, progress) => callback(progress)),
    onDownloaded: (callback) => ipcRenderer.on('update:downloaded', (_, info) => callback(info)),
    onError: (callback) => ipcRenderer.on('update:error', (_, data) => callback(data)),

    removeListener: (channel) => ipcRenderer.removeAllListeners(`update:${channel}`)
  },

   // ============================================================
   // License / Serial Key
   // ============================================================
   license: {
     getMachineId: () => ipcRenderer.invoke('license:get-machine-id'),
     activate: (params) => ipcRenderer.invoke('license:activate', params),
     check: () => ipcRenderer.invoke('license:check'),
     deactivate: () => ipcRenderer.invoke('license:deactivate')
   },

  // ============================================================
  // App Info
  // ============================================================
  app: {
    getVersion: () => ipcRenderer.invoke('app:get-version')
  },

  // ============================================================
  // Store (Settings)
  // ============================================================
  store: {
    get: (key) => ipcRenderer.invoke('store:get', key),
    set: (key, value) => ipcRenderer.invoke('store:set', { key, value })
  }
});