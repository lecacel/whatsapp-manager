// ============================================================
// WhatsApp Webview Preload Script
// ============================================================
// This script runs inside every WhatsApp webview BEFORE any page scripts.
// It removes Electron fingerprints from the browser environment so that
// WhatsApp Web treats this as a standard Chrome browser and enables
// voice and video calling features.
//
// Loaded via will-attach-webview with contextIsolation=false so it
// executes in the same JavaScript world as the page code.
// ============================================================

(function () {
  'use strict';

  // ── 1. Hide Electron-specific globals ──────────────────────
  // WhatsApp checks for window.process, window.require, etc.
  const ELECTRON_KEYS = ['process', '__electron', 'electron', 'module', 'require', '__dirname', '__filename'];
  ELECTRON_KEYS.forEach(function (key) {
    try {
      if (typeof window[key] !== 'undefined') {
        Object.defineProperty(window, key, {
          get: function () { return undefined; },
          set: function () {},
          configurable: true,
          enumerable: false
        });
      }
    } catch (_) {}
  });

  // ── 2. Override navigator.userAgentData ────────────────────
  // Electron 20+ exposes navigator.userAgentData with "Electron" in brands.
  // WhatsApp uses this to detect non-browser environments and block calls.
  const CHROME_VER = '122';
  const cleanBrands = [
    { brand: 'Chromium', version: CHROME_VER },
    { brand: 'Google Chrome', version: CHROME_VER },
    { brand: 'Not-A.Brand', version: '24' }
  ];
  const cleanUAData = {
    brands: cleanBrands,
    mobile: false,
    platform: 'Windows',
    getHighEntropyValues: function (hints) {
      return Promise.resolve({
        brands: cleanBrands,
        mobile: false,
        platform: 'Windows',
        platformVersion: '15.0.0',
        architecture: 'x86',
        bitness: '64',
        uaFullVersion: CHROME_VER + '.0.6261.112',
        fullVersionList: [
          { brand: 'Chromium', version: CHROME_VER + '.0.6261.112' },
          { brand: 'Google Chrome', version: CHROME_VER + '.0.6261.112' },
          { brand: 'Not-A.Brand', version: '24.0.0.0' }
        ],
        wow64: false
      });
    },
    toJSON: function () {
      return { brands: cleanBrands, mobile: false, platform: 'Windows' };
    }
  };

  try {
    Object.defineProperty(navigator, 'userAgentData', {
      value: cleanUAData,
      configurable: true,
      writable: false,
      enumerable: true
    });
  } catch (_) {
    // If defineProperty fails, try direct assignment as last resort
    try { navigator.userAgentData = cleanUAData; } catch (__) {}
  }

  // ── 3. Override navigator.userAgent ───────────────────────
  // Ensure the User-Agent string does not contain "Electron"
  try {
    const currentUA = navigator.userAgent || '';
    if (currentUA.toLowerCase().includes('electron')) {
      const cleanUA = currentUA
        .replace(/\s*Electron\/[\d.]+/gi, '')
        .replace(/\s*electron\/[\d.]+/gi, '');
      Object.defineProperty(navigator, 'userAgent', {
        value: cleanUA,
        configurable: true,
        writable: false,
        enumerable: true
      });
      // Also fix appVersion which may contain "Electron"
      try {
        const cleanAppVersion = (navigator.appVersion || '').replace(/\s*Electron\/[\d.]+/gi, '');
        Object.defineProperty(navigator, 'appVersion', {
          value: cleanAppVersion,
          configurable: true,
          writable: false,
          enumerable: true
        });
      } catch (__) {}
    }
  } catch (_) {}

  // ── 4. Override navigator.vendor ──────────────────────────
  try {
    if (!navigator.vendor || navigator.vendor === '') {
      Object.defineProperty(navigator, 'vendor', {
        value: 'Google Inc.',
        configurable: true,
        writable: false,
        enumerable: true
      });
    }
  } catch (_) {}

  // ── 5. Ensure WebRTC APIs are available ───────────────────
  if (!window.RTCPeerConnection && window.webkitRTCPeerConnection) {
    try { window.RTCPeerConnection = window.webkitRTCPeerConnection; } catch (_) {}
  }

  // ── 6. Override Permissions API ───────────────────────────
  // Report camera, microphone, and notifications as already granted.
  // This prevents WhatsApp from treating them as blocked.
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const _origQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = function (descriptor) {
        const name = descriptor && descriptor.name;
        if (name === 'camera' || name === 'microphone' || name === 'notifications' || name === 'speaker-selection') {
          return Promise.resolve({
            state: 'granted',
            name: name,
            onchange: null,
            addEventListener: function () {},
            removeEventListener: function () {},
            dispatchEvent: function () { return true; }
          });
        }
        return _origQuery(descriptor);
      };
    }
  } catch (_) {}

  // ── 7. Protect navigator.mediaDevices ──────────────────────
  // NEVER overwrite navigator.mediaDevices with an empty object — that destroys
  // the real enumerateDevices/getUserMedia/getDisplayMedia bindings that Electron's
  // Chromium already provides.  Only patch if the object is completely absent.
  try {
    if (!navigator.mediaDevices) {
      // Should never happen in Electron, but provide a safe stub just in case.
      Object.defineProperty(navigator, 'mediaDevices', {
        value: {
          enumerateDevices: function () { return Promise.resolve([]); },
          getUserMedia: function () { return Promise.reject(new Error('No media devices')); },
          getDisplayMedia: function () { return Promise.reject(new Error('No display media')); },
          addEventListener: function () {},
          removeEventListener: function () {},
          dispatchEvent: function () { return true; }
        },
        configurable: true,
        writable: true,
        enumerable: true
      });
    }
  } catch (_) {}

  // ── 8. Block WebDriver flag ────────────────────────────────
  try {
    if (navigator.webdriver) {
      Object.defineProperty(navigator, 'webdriver', {
        get: function () { return false; },
        configurable: true,
        enumerable: true
      });
    }
  } catch (_) {}

  // ── 9. Remove Electron from navigator.plugins ──────────────
  try {
    if (navigator.plugins && navigator.plugins.length === 0) {
      // Chrome normally has plugins; having zero is suspicious.
      // Create a minimal fake plugins array to look like real Chrome.
      Object.defineProperty(navigator, 'plugins', {
        get: function () {
          return [
            { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
            { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1 },
            { name: 'Native Client', filename: 'internal-nacl-plugin', description: '', length: 2 }
          ];
        },
        configurable: true,
        enumerable: true
      });
    }
  } catch (_) {}

  // ── 10. Do NOT polyfill getDisplayMedia with a broken fallback ─
  // The previous polyfill used { mediaSource: 'screen' } which is a Firefox-only
  // API and actually BREAKS Chromium's getUserMedia.  In Electron, getDisplayMedia
  // works natively when the main process has setDisplayMediaRequestHandler configured.
  // Removing the broken polyfill so the native implementation is used instead.

  // ── 11. Fix chrome.runtime detection ──────────────────────
  // WhatsApp may check for chrome.runtime to determine if it's a real browser
  try {
    if (typeof window.chrome === 'undefined') {
      window.chrome = {};
    }
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        connect: function () { return {}; },
        sendMessage: function () {},
        id: undefined
      };
    }
  } catch (_) {}

})();
