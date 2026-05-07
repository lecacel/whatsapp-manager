const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, session } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// Silence punycode deprecation warning
process.noDeprecation = true;

// Reduce noisy Chromium cache/GPU cache errors in the terminal.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-gpu-program-cache');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

// WebRTC / media support switches
app.commandLine.appendSwitch('enable-features', 'WebRTC-H264WithOpenH264FFmpeg,PlatformHEVCEncoderSupport,WebRtcHideLocalIpsWithMdns,GetUserMedia,MediaStream');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// Set App User Model ID as early as possible for Windows taskbar icon
if (process.platform === 'win32') {
  app.setAppUserModelId('com.wamanager.app');
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

const Store = require('electron-store');
const store = new Store();

let mainWindow;
let tray;

function getAppIcon(iconName = null) {
  // On Windows, prefer .ico for taskbar/system-tray; fall back to .png
  if (!iconName) {
    const icoPath = path.join(__dirname, 'assets', 'icon.ico');
    const pngPath = path.join(__dirname, 'assets', 'icon.png');
    const fs = require('fs');
    iconName = (process.platform === 'win32' && fs.existsSync(icoPath)) ? 'icon.ico' : 'icon.png';
  }

  const iconPath = path.join(__dirname, 'assets', iconName);
  const fileIcon = nativeImage.createFromPath(iconPath);

  if (!fileIcon.isEmpty()) {
    return fileIcon;
  }

  const fallbackSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
      <rect width="256" height="256" rx="64" fill="#FF0000"/>
      <path d="M128,40A88,88,0,0,0,51.8,172l-11.2,33.5A8,8,0,0,0,50.1,215a7.9,7.9,0,0,0,5.8,2.4,8.3,8.3,0,0,0,2.5-.4l34.4-11A87.9,87.9,0,1,0,128,40Zm43.8,124a5.1,5.1,0,0,1-3.6,1.4,19.3,19.3,0,0,1-9.6-3c-15.6-8.8-28.5-22.1-37.1-38.4a22.2,22.2,0,0,1-2.9-10.2,16.5,16.5,0,0,1,5.2-11.6,4.6,4.6,0,0,1,3.4-1.3h4a4.4,4.4,0,0,1,3.5,1.9l9.3,13a5.5,5.5,0,0,1,.8,4.7,21,21,0,0,1-2.8,4.6l-3.3,4.2c-.6.8-.7,1.4-.4,2a54.3,54.3,0,0,0,13.7,17,49.2,49.2,0,0,0,18.1,10.6,3.6,3.6,0,0,0,2.3-.2l5.1-2.7A18,18,0,0,1,180.2,106a5,5,0,0,1,4.4.4l14.4,8a4.9,4.9,0,0,1,2.4,4.1A28.7,28.7,0,0,1,171.8,164Z" fill="#ffffff"/>
    </svg>
  `;
  const fallbackIcon = nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(fallbackSvg)}`);
  return fallbackIcon.isEmpty() ? nativeImage.createEmpty() : fallbackIcon;
}

// Import managers
const WhatsAppManager = require('./src/modules/whatsapp-manager');
const BroadcastManager = require('./src/modules/broadcast-manager');
const WarmerManager = require('./src/modules/warmer-manager');
const AutoReplyManager = require('./src/modules/autoreply-manager');
const AIManager = require('./src/modules/ai-manager');
const SerialKeyManager = require('./src/modules/serial-key-manager');

// Initialize managers
const waManager = new WhatsAppManager();
const broadcastManager = new BroadcastManager(waManager);
const warmerManager = new WarmerManager(waManager);
const autoReplyManager = new AutoReplyManager(waManager);
const aiManager = new AIManager(waManager);

function getLicenseStatus() {
  return SerialKeyManager.checkLicense();
}

function requireActiveLicense() {
  const license = getLicenseStatus();
  if (!license.active) {
    const error = license.error || 'Fitur ini memerlukan Serial Key aktif.';
    const err = new Error(error);
    err.code = 'LICENSE_REQUIRED';
    throw err;
  }
  return license;
}

function licenseErrorResponse(err) {
  return {
    success: false,
    error: err?.message || 'Fitur ini memerlukan Serial Key aktif.',
    code: err?.code || 'LICENSE_REQUIRED'
  };
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 680,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      webviewTag: true,
      devTools: false
    },
    icon: getAppIcon(),
    title: 'WA Manager - WhatsApp Multi Account',
    show: false,
    backgroundColor: '#0f172a'
  });

  // Inject anti-Electron-detection preload into every webview BEFORE page scripts run.
  // This is the ONLY reliable way to override navigator.userAgentData before
  // WhatsApp Web checks it and disables voice/video call features.
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    // Set preload script that runs in the same JS world as WhatsApp's code
    webPreferences.preload = path.join(__dirname, 'webview-preload.js');
    // contextIsolation=false is required so the preload can override navigator properties
    // in the main page world before WhatsApp's feature-detection scripts execute.
    webPreferences.contextIsolation = false;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.webSecurity = false;
    webPreferences.allowRunningInsecureContent = false;
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedWhatsAppWebviewUrl(url)) {
      return { action: 'allow' };
    }

    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        webPreferences: {
          partition: `persist:wa-webview-popup-${Date.now()}`,
          contextIsolation: true,
          nodeIntegration: false,
          webSecurity: true
        }
      }
    };
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (!app.isQuiting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  setupManagerEvents();
}

function setupManagerEvents() {
  waManager.on('qr', (accountId, qr) => {
    if (mainWindow) mainWindow.webContents.send('wa:qr', { accountId, qr });
  });

  waManager.on('ready', (accountId, info) => {
    if (mainWindow) mainWindow.webContents.send('wa:ready', { accountId, info });
  });

  waManager.on('authenticated', (accountId) => {
    if (mainWindow) mainWindow.webContents.send('wa:authenticated', { accountId });
  });

  waManager.on('disconnected', (accountId) => {
    if (mainWindow) mainWindow.webContents.send('wa:disconnected', { accountId });
  });

  waManager.on('message', (accountId, message) => {
    if (mainWindow) mainWindow.webContents.send('wa:message', { accountId, message });

    if (getLicenseStatus().active) {
      autoReplyManager.handleMessage(accountId, message);
      aiManager.handleMessage(accountId, message);
    }
  });

  waManager.on('auth_failure', (accountId) => {
    if (mainWindow) mainWindow.webContents.send('wa:auth_failure', { accountId });
  });

  waManager.on('error_state', (accountId, error) => {
    if (mainWindow) mainWindow.webContents.send('wa:error-state', { accountId, error });
  });

  broadcastManager.on('progress', (data) => {
    if (mainWindow) mainWindow.webContents.send('broadcast:progress', data);
  });

  broadcastManager.on('completed', (data) => {
    if (mainWindow) mainWindow.webContents.send('broadcast:completed', data);
  });

  broadcastManager.on('error', (data) => {
    if (mainWindow) mainWindow.webContents.send('broadcast:error', data);
  });

  warmerManager.on('message_sent', (data) => {
    if (mainWindow) mainWindow.webContents.send('warmer:message_sent', data);
  });

  warmerManager.on('status', (data) => {
    if (mainWindow) mainWindow.webContents.send('warmer:status', data);
  });

  autoReplyManager.on('replied', (data) => {
    if (mainWindow) mainWindow.webContents.send('autoreply:replied', data);
  });

  aiManager.on('replied', (data) => {
    if (mainWindow) mainWindow.webContents.send('ai:replied', data);
  });
}

// IPC Handlers
ipcMain.handle('app:focus-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.focus();
    mainWindow.webContents.focus();
  }
  return true;
});

ipcMain.handle('wa:add-account', async (event, { accountId, name }) => {
  try {
    await waManager.addAccount(accountId, name);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('wa:remove-account', async (event, { accountId }) => {
  try {
    await waManager.removeAccount(accountId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('wa:get-accounts', async () => waManager.getAccounts());

ipcMain.handle('wa:get-status', async (event, { accountId }) => waManager.getStatus(accountId));

ipcMain.handle('wa:logout', async (event, { accountId }) => {
  try {
    await waManager.logout(accountId);
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('wa:get-contacts', async (event, { accountId }) => {
  try {
    requireActiveLicense();
    const contacts = await waManager.getContacts(accountId);
    return { success: true, contacts };
  } catch (err) {
    return err?.code === 'LICENSE_REQUIRED'
      ? { ...licenseErrorResponse(err), contacts: [] }
      : { success: false, error: err.message, contacts: [] };
  }
});

ipcMain.handle('wa:get-all-chats', async (event, { accountId }) => {
  try {
    requireActiveLicense();
    const chats = await waManager.getAllChats(accountId);
    return { success: true, chats };
  } catch (err) {
    return err?.code === 'LICENSE_REQUIRED'
      ? { ...licenseErrorResponse(err), chats: [] }
      : { success: false, error: err.message, chats: [] };
  }
});

ipcMain.handle('wa:send-message', async (event, { accountId, to, message, mediaPath }) => {
  try {
    requireActiveLicense();
    if (mediaPath) {
      await waManager.sendMessageWithMedia(accountId, to, message || '', mediaPath);
    } else {
      await waManager.sendMessage(accountId, to, message);
    }
    return { success: true };
  } catch (err) {
    return err?.code === 'LICENSE_REQUIRED'
      ? licenseErrorResponse(err)
      : { success: false, error: err.message };
  }
});

ipcMain.handle('chat:get-messages', async (event, { accountId, chatId, limit }) => {
  try {
    requireActiveLicense();
    const messages = await waManager.getChatMessages(accountId, chatId, limit || 100);
    return { success: true, messages };
  } catch (err) {
    return err?.code === 'LICENSE_REQUIRED'
      ? { ...licenseErrorResponse(err), messages: [] }
      : { success: false, error: err.message, messages: [] };
  }
});

ipcMain.handle('chat:download-media', async (event, { accountId, messageId }) => {
  try {
    requireActiveLicense();
    const media = await waManager.downloadMedia(accountId, messageId);
    return { success: !!media, media };
  } catch (err) {
    return err?.code === 'LICENSE_REQUIRED'
      ? { ...licenseErrorResponse(err), media: null }
      : { success: false, error: err.message, media: null };
  }
});

ipcMain.handle('broadcast:start', async (event, params) => {
  try {
    requireActiveLicense();
    await broadcastManager.startBroadcast(params);
    return { success: true };
  } catch (err) {
    return err?.code === 'LICENSE_REQUIRED'
      ? licenseErrorResponse(err)
      : { success: false, error: err.message };
  }
});

ipcMain.handle('broadcast:stop', async (event, { broadcastId }) => {
  broadcastManager.stopBroadcast(broadcastId);
  return { success: true };
});

ipcMain.handle('broadcast:get-list', async () => broadcastManager.getBroadcastList());

ipcMain.handle('warmer:start', async (event, params) => {
  try {
    requireActiveLicense();
    warmerManager.startWarmer(params);
    return { success: true };
  } catch (err) {
    return err?.code === 'LICENSE_REQUIRED'
      ? licenseErrorResponse(err)
      : { success: false, error: err.message };
  }
});

ipcMain.handle('warmer:stop', async () => {
  warmerManager.stopWarmer();
  return { success: true };
});

ipcMain.handle('warmer:get-status', async () => warmerManager.getStatus());

ipcMain.handle('warmer:get-log', async () => warmerManager.getLog());

ipcMain.handle('autoreply:get-rules', async () => autoReplyManager.getRules());

ipcMain.handle('autoreply:add-rule', async (event, rule) => {
  try {
    requireActiveLicense();
    autoReplyManager.addRule(rule);
    return { success: true };
  } catch (err) {
    return err?.code === 'LICENSE_REQUIRED' ? licenseErrorResponse(err) : { success: false, error: err.message };
  }
});

ipcMain.handle('autoreply:update-rule', async (event, rule) => {
  try {
    requireActiveLicense();
    autoReplyManager.updateRule(rule);
    return { success: true };
  } catch (err) {
    return err?.code === 'LICENSE_REQUIRED' ? licenseErrorResponse(err) : { success: false, error: err.message };
  }
});

ipcMain.handle('autoreply:delete-rule', async (event, { ruleId }) => {
  try {
    requireActiveLicense();
    autoReplyManager.deleteRule(ruleId);
    return { success: true };
  } catch (err) {
    return err?.code === 'LICENSE_REQUIRED' ? licenseErrorResponse(err) : { success: false, error: err.message };
  }
});

ipcMain.handle('autoreply:toggle', async (event, { accountId, enabled }) => {
  try {
    requireActiveLicense();
    autoReplyManager.toggleForAccount(accountId, enabled);
    return { success: true };
  } catch (err) {
    return err?.code === 'LICENSE_REQUIRED' ? licenseErrorResponse(err) : { success: false, error: err.message };
  }
});

ipcMain.handle('autoreply:get-enabled-accounts', async () => autoReplyManager.getEnabledAccounts());

ipcMain.handle('autoreply:get-log', async () => autoReplyManager.getLog());

ipcMain.handle('ai:set-config', async (event, config) => {
  try {
    requireActiveLicense();
    aiManager.setConfig(config);
    return { success: true };
  } catch (err) {
    return err?.code === 'LICENSE_REQUIRED' ? licenseErrorResponse(err) : { success: false, error: err.message };
  }
});

ipcMain.handle('ai:get-config', async () => aiManager.getConfig());

ipcMain.handle('ai:toggle', async (event, { accountId, enabled }) => {
  try {
    requireActiveLicense();
    aiManager.toggleForAccount(accountId, enabled);
    return { success: true };
  } catch (err) {
    return err?.code === 'LICENSE_REQUIRED' ? licenseErrorResponse(err) : { success: false, error: err.message };
  }
});

ipcMain.handle('ai:get-enabled-accounts', async () => aiManager.getEnabledAccounts());

ipcMain.handle('ai:get-log', async () => aiManager.getLog());

ipcMain.handle('ai:test', async (event, { message }) => {
  try {
    requireActiveLicense();
    const response = await aiManager.testAI(message);
    return { success: true, response };
  } catch (err) {
    return err?.code === 'LICENSE_REQUIRED'
      ? licenseErrorResponse(err)
      : { success: false, error: err.message };
  }
});

ipcMain.handle('dialog:open-file', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options || {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'All Files', extensions: ['*'] },
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
      { name: 'Documents', extensions: ['pdf', 'doc', 'docx', 'xls', 'xlsx'] },
      { name: 'Videos', extensions: ['mp4', 'avi', 'mkv'] }
    ]
  });
  return result;
});

const ALLOWED_STORE_KEYS = [
  'custom_notification_sound',
  'wa_webview_tabs',
  'ai_config',
  'auto_reply_rules',
  'enabled_autoreply_accounts',
  'enabled_ai_accounts'
];

ipcMain.handle('store:get', async (event, key) => {
  // Allow reading license status via specific IPC, but keep generic store:get for others
  if (key === 'license') return null; // Force use of license:check
  return store.get(key);
});

ipcMain.handle('store:set', async (event, { key, value }) => {
  if (!ALLOWED_STORE_KEYS.includes(key)) {
    console.error(`[Security] Unauthorized attempt to set store key: ${key}`);
    return { success: false, error: 'Unauthorized key' };
  }
  store.set(key, value);
  return { success: true };
});

ipcMain.handle('notification:flash-frame', async () => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.flashFrame(true);
      // Set a red dot overlay icon on the taskbar button
      const badgeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16">
        <circle cx="8" cy="8" r="8" fill="#FF0000"/>
      </svg>`;
      const badgeIcon = nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(badgeSvg)}`);
      if (!badgeIcon.isEmpty()) {
        mainWindow.setOverlayIcon(badgeIcon, 'Pesan baru');
      }
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('notification:clear-badge', async () => {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.flashFrame(false);
      mainWindow.setOverlayIcon(null, '');
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('notification:play-sound', async (event, filePath) => {
  try {
    if (!filePath) return { success: false, error: 'No file path provided' };
    
    // In a real app, you'd use a library or native command to play the sound.
    // For now, we'll send an event back to renderer to play it via Web Audio if it's the active sound,
    // or just acknowledge the request. 
    // Actually, playing from Main Process is safer for "direct notification" sounds.
    // On Windows, we can use a small PowerShell command as a fallback if no library is present.
    const { exec } = require('child_process');
    const escapedPath = filePath.replace(/"/g, '`"');
    
    // PowerShell command to play sound
    const command = `powershell -c "(New-Object Media.SoundPlayer '${escapedPath}').PlaySync()"`;
    exec(command);
    
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// ============================================================
// Serial Key / License IPC Handlers
// ============================================================
ipcMain.handle('license:get-machine-id', async () => {
  return { success: true, machineId: SerialKeyManager.getMachineId() };
});

ipcMain.handle('license:activate', async (event, { key }) => {
  const result = SerialKeyManager.activateKey(key);
  return result;
});

ipcMain.handle('license:check', async () => {
  const result = SerialKeyManager.checkLicense();
  return result;
});

ipcMain.handle('license:deactivate', async () => {
  const result = SerialKeyManager.deactivateLicense();
  return result;
});

ipcMain.handle('license:generate-key', async (event, { machineId, durationDays }) => {
  try {
    const result = SerialKeyManager.generateKey(machineId, durationDays);
    return { success: true, ...result };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// Auto-Updater Setup
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

function setupAutoUpdater() {
  autoUpdater.on('checking-for-update', () => {
    console.log('[AutoUpdate] Checking for update...');
    if (mainWindow) mainWindow.webContents.send('update:checking');
  });

  autoUpdater.on('update-available', (info) => {
    console.log('[AutoUpdate] Update available:', info.version);
    if (mainWindow) {
      mainWindow.webContents.send('update:available', info);
      
      // Send a direct notification to the user's screen
      const { Notification } = require('electron');
      if (Notification.isSupported()) {
        const notification = new Notification({
          title: 'Update Tersedia!',
          body: `Versi baru v${info.version} sudah tersedia. Klik untuk melihat detail.`,
          icon: getAppIcon('icon.png')
        });
        notification.show();
        notification.on('click', () => {
          mainWindow.show();
          // We can't easily trigger switchTab from here without more complex IPC, 
          // but showing the window is a good start.
        });
      }
    }
  });

  autoUpdater.on('update-not-available', (info) => {
    console.log('[AutoUpdate] App is up to date.');
    if (mainWindow) mainWindow.webContents.send('update:not-available', info);
  });

  autoUpdater.on('download-progress', (progress) => {
    console.log(`[AutoUpdate] Downloading: ${progress.percent.toFixed(1)}%`);
    if (mainWindow) mainWindow.webContents.send('update:progress', progress);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log('[AutoUpdate] Update downloaded. Will install on quit.');
    if (mainWindow) mainWindow.webContents.send('update:downloaded', info);
  });

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdate] Error:', err.message);
    if (mainWindow) mainWindow.webContents.send('update:error', { message: err.message });
  });

  // Check for updates on startup
  autoUpdater.checkForUpdates().catch(err => {
    console.error('[AutoUpdate] Check failed:', err.message);
  });
}

// IPC: manually trigger update check
ipcMain.handle('update:check', async () => {
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, updateInfo: result ? result.updateInfo : null };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// IPC: download the available update
ipcMain.handle('update:download', async () => {
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// IPC: install the downloaded update and restart
ipcMain.handle('update:install-and-restart', async () => {
  app.isQuiting = true;
  autoUpdater.quitAndInstall(false, true);
  return { success: true };
});

// IPC: get current app version
ipcMain.handle('app:get-version', async () => {
  return app.getVersion();
});

// App Lifecycle
app.whenReady().then(() => {
  app.setAppUserModelId('com.wamanager.app');
  Menu.setApplicationMenu(null);
  // Also ensure the taskbar icon overlay is cleared on start
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setOverlayIcon(null, '');
  }
  configureWebviewSessions();
  createWindow();
  createTray();
  setupAutoUpdater();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// Chrome user-agent constant shared across session configurations and webviews
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

// Anti-detection script injected into WhatsApp Web pages to hide Electron fingerprints.
// This ensures WhatsApp does not block voice/video calls due to environment detection.
const WHATSAPP_ANTI_DETECTION_SCRIPT = `
(function() {
  'use strict';
  try {
    // Delete any Electron-specific globals that may have leaked through
    ['process', '__electron', 'electron', 'module'].forEach(function(k) {
      try { if (window[k] !== undefined) { Object.defineProperty(window, k, { get: function() { return undefined; }, configurable: true }); } } catch(e) {}
    });

    // Fix navigator.userAgentData – remove any "Electron" entry from brands list
    // so WhatsApp treats this as a standard Chrome browser.
    if (navigator.userAgentData) {
      try {
        var cleanBrands = (navigator.userAgentData.brands || []).filter(function(b) {
          return !String(b.brand || '').toLowerCase().includes('electron');
        });
        var uadPlatform = navigator.userAgentData.platform || 'Windows';
        var uadMobile = navigator.userAgentData.mobile || false;
        Object.defineProperty(navigator, 'userAgentData', {
          value: {
            brands: cleanBrands,
            mobile: uadMobile,
            platform: uadPlatform,
            getHighEntropyValues: function(hints) {
              return Promise.resolve({
                platform: uadPlatform,
                platformVersion: '15.0.0',
                architecture: 'x86',
                bitness: '64',
                brands: cleanBrands,
                fullVersionList: cleanBrands.map(function(b) {
                  return { brand: b.brand, version: b.version + '.0.0.0' };
                })
              });
            },
            toJSON: function() {
              return { brands: cleanBrands, mobile: uadMobile, platform: uadPlatform };
            }
          },
          configurable: true,
          writable: false
        });
      } catch(e) {}
    }

    // Ensure WebRTC APIs are not blocked by overriding common detection patterns
    if (!window.RTCPeerConnection && window.webkitRTCPeerConnection) {
      window.RTCPeerConnection = window.webkitRTCPeerConnection;
    }
  } catch(e) {}
})();
`;

/**
 * Apply permission handlers and Chrome user-agent to a session.
 * Called for every session (default + each webview partition).
 */
function applySessionConfig(ses) {
  if (!ses || ses._waConfigured) return;
  ses._waConfigured = true;

  // Override user-agent so navigator.userAgent reflects Chrome (not Electron).
  // The webview-preload.js also overrides navigator.userAgentData brands in JS.
  ses.setUserAgent(CHROME_UA);

  // Grant ALL permissions without prompting – required for voice/video calls.
  // WhatsApp needs: media, camera, microphone, audioCapture, videoCapture, notifications.
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(true);
  });

  ses.setPermissionCheckHandler((_webContents, _permission) => {
    return true;
  });

  // Handle specific device access (camera, microphone)
  try {
    if (typeof ses.setDevicePermissionHandler === 'function') {
      ses.setDevicePermissionHandler((details) => {
        // Grant access to all requested media devices (camera/mic)
        return true;
      });
    }
  } catch (_) {}

  // Allow display media (screen sharing) requests inside WhatsApp calls
  try {
    if (typeof ses.setDisplayMediaRequestHandler === 'function') {
      ses.setDisplayMediaRequestHandler((_request, callback) => {
        callback({}); // Grant without prompting
      });
    }
  } catch (_) {}
}

function configureWebviewSessions() {
  // Configure the default session first
  applySessionConfig(session.defaultSession);

  // Override request headers to ensure Chrome UA is sent to WhatsApp servers
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.url.includes('whatsapp.com') || details.url.includes('whatsapp.net')) {
      details.requestHeaders['User-Agent'] = CHROME_UA;
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  app.on('web-contents-created', (event, contents) => {
    // Configure every new session (each webview partition gets its own session)
    const ses = contents.session;
    if (ses) {
      applySessionConfig(ses);

      // Also patch request headers on this session for WhatsApp domains
      try {
        ses.webRequest.onBeforeSendHeaders((details, callback) => {
          if (details.url.includes('whatsapp.com') || details.url.includes('whatsapp.net')) {
            details.requestHeaders['User-Agent'] = CHROME_UA;
          }
          callback({ requestHeaders: details.requestHeaders });
        });
      } catch (_e) { /* session may already have a handler */ }
    }

    // Inject anti-detection script into every WhatsApp Web page after DOM is ready.
    // dom-ready fires before page scripts complete initialization, giving us a chance
    // to clean up Electron fingerprints before WhatsApp checks the environment.
    contents.on('dom-ready', () => {
      try {
        const url = contents.getURL ? contents.getURL() : '';
        if (url && (url.includes('whatsapp.com') || url.includes('whatsapp.net'))) {
          contents.executeJavaScript(WHATSAPP_ANTI_DETECTION_SCRIPT).catch(() => {});
        }
      } catch (_e) {}
    });

    // Also inject on navigation within same page (SPA route changes)
    contents.on('did-navigate-in-page', () => {
      try {
        const url = contents.getURL ? contents.getURL() : '';
        if (url && (url.includes('whatsapp.com') || url.includes('whatsapp.net'))) {
          contents.executeJavaScript(WHATSAPP_ANTI_DETECTION_SCRIPT).catch(() => {});
        }
      } catch (_e) {}
    });

    if (contents.getType() === 'webview') {
      contents.setWindowOpenHandler(({ url }) => {
        if (isAllowedWhatsAppWebviewUrl(url)) {
          // Popup call/video windows: reuse the webview's own session so WhatsApp
          // maintains auth state and media permissions for the call window.
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              width: 960,
              height: 720,
              minWidth: 640,
              minHeight: 480,
              title: 'WhatsApp Call',
              autoHideMenuBar: true,
              webPreferences: {
                preload: path.join(__dirname, 'webview-preload.js'),
                contextIsolation: false,
                nodeIntegration: false,
                webSecurity: false,
                allowRunningInsecureContent: false,
                // Reuse the same session as the opening webview
                session: contents.session
              }
            }
          };
        }
        return { action: 'deny' };
      });

      contents.on('will-navigate', (e, url) => {
        if (!isAllowedWhatsAppWebviewUrl(url)) e.preventDefault();
      });
    }
  });
}

function isAllowedWhatsAppWebviewUrl(url) {
  try {
    if (!url) return false;
    if (url.startsWith('about:blank') || url.startsWith('devtools://')) return true;
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host.includes('whatsapp.com') || host.includes('whatsapp.net') || host.includes('wa.me');
  } catch {
    return false;
  }
}

function createTray() {
  try {
    const trayIcon = getAppIcon('tray-icon.png');
    const icon = trayIcon.resize({ width: 16, height: 16 });
    icon.setTemplateImage(false);

    if (icon.isEmpty()) {
      throw new Error('Tray icon image is empty');
    }

    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
      { label: 'WA Manager', enabled: false },
      { type: 'separator' },
      { label: 'Open', click: () => mainWindow.show() },
      { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } }
    ]);
    tray.setToolTip('WA Manager');
    tray.setContextMenu(contextMenu);
    tray.on('double-click', () => mainWindow.show());
  } catch (e) {
    console.log('Tray creation skipped:', e.message);
  }
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Keep running
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
  else mainWindow.show();
});

app.on('before-quit', () => {
  app.isQuiting = true;
  waManager.destroyAll();
});