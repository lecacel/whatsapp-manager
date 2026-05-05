const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, session } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

// Silence punycode deprecation warning
process.noDeprecation = true;

// Reduce noisy Chromium cache/GPU cache errors in the terminal.
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
app.commandLine.appendSwitch('disable-gpu-program-cache');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

const Store = require('electron-store');
const store = new Store();

let mainWindow;
let tray;

function getAppIcon(iconName = 'icon.png') {
  const iconPath = path.join(__dirname, 'assets', iconName);
  const fileIcon = nativeImage.createFromPath(iconPath);

  if (!fileIcon.isEmpty()) {
    return fileIcon;
  }

  const fallbackSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
      <rect width="256" height="256" rx="64" fill="#061014"/>
      <text x="128" y="160" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="112" font-weight="800" fill="#ffffff">W</text>
      <circle cx="196" cy="62" r="24" fill="#25D366"/>
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
  Menu.setApplicationMenu(null);
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

function configureWebviewSessions() {
  // Allow permissions for default session
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'camera', 'microphone', 'notifications', 'fullscreen'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const allowedPermissions = ['media', 'camera', 'microphone', 'notifications', 'fullscreen'];
    return allowedPermissions.includes(permission);
  });

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    if (details.url.startsWith('https://web.whatsapp.com/')) {
      details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  app.on('web-contents-created', (event, contents) => {
    if (contents.getType() === 'webview') {
      // Enable media permissions for specific webview partitions
      const webviewSession = contents.session;
      if (webviewSession) {
        webviewSession.setPermissionRequestHandler((webContents, permission, callback) => {
          const allowedPermissions = ['media', 'camera', 'microphone', 'notifications', 'fullscreen'];
          if (allowedPermissions.includes(permission)) {
            callback(true);
          } else {
            callback(false);
          }
        });

        webviewSession.setPermissionCheckHandler((webContents, permission) => {
          const allowedPermissions = ['media', 'camera', 'microphone', 'notifications', 'fullscreen'];
          return allowedPermissions.includes(permission);
        });
      }

      contents.setWindowOpenHandler(({ url }) => {
        if (isAllowedWhatsAppWebviewUrl(url)) return { action: 'allow' };
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