// browser-preload.js — Minimal fingerprint cleanup for browser webviews
// Runs with contextIsolation: false so we can patch navigator in the page world.
// Keep this script MINIMAL to avoid breaking page functionality (YouTube, Google, etc.)

(function () {
  'use strict';

  // ── 1. Fix navigator.webdriver ──────────────────────────────────────────
  // Chromium sets this to true when controlled by automation.
  try {
    Object.defineProperty(navigator, 'webdriver', {
      get: function () { return false; },
      configurable: true,
    });
  } catch (_) {}

  // ── 2. Clean user-agent string ─────────────────────────────────────────
  // Remove "Electron/x.y.z" and "WA-Manager/x.y.z" tokens from the UA.
  try {
    const ua = navigator.userAgent;
    if (ua && (ua.includes('Electron') || ua.includes('WA-Manager'))) {
      const clean = ua
        .replace(/\s*Electron\/[\d.]+/g, '')
        .replace(/\s*WA-Manager\/[\d.]+/g, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
      Object.defineProperty(navigator, 'userAgent', {
        get: function () { return clean; },
        configurable: true,
      });
    }
  } catch (_) {}

  // ── 3. Override navigator.userAgentData (REQUIRED for Google/YouTube) ──
  // YouTube and Google heavily rely on userAgentData to initialize their SPA.
  // Without this, YouTube renders blank and Google search may not work.
  try {
    const CHROME_VER = '134';
    const cleanBrands = [
      { brand: 'Chromium', version: CHROME_VER },
      { brand: 'Google Chrome', version: CHROME_VER },
      { brand: 'Not-A.Brand', version: '8' }
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
          uaFullVersion: CHROME_VER + '.0.0.0',
          fullVersionList: [
            { brand: 'Chromium', version: CHROME_VER + '.0.0.0' },
            { brand: 'Google Chrome', version: CHROME_VER + '.0.0.0' },
            { brand: 'Not-A.Brand', version: '8.0.0.0' }
          ],
          wow64: false
        });
      },
      toJSON: function () {
        return { brands: cleanBrands, mobile: false, platform: 'Windows' };
      }
    };

    Object.defineProperty(navigator, 'userAgentData', {
      value: cleanUAData,
      configurable: true,
      writable: false,
      enumerable: true
    });
  } catch (_) {}

  // ── 4. Remove Electron-specific globals ────────────────────────────────
  try { delete window.electron; } catch (_) {}
  try { delete window.__electron; } catch (_) {}
  try { delete window.__Electron; } catch (_) {}
  try { delete window.ipcRenderer; } catch (_) {}

  // ── 5. Patch navigator.connection for YouTube compatibility ────────────
  // Cache the object so YouTube's Polymer doesn't get confused by new instances.
  try {
    if (!navigator.connection) {
      var connectionObj = {
        effectiveType: '4g',
        downlink: 10,
        rtt: 50,
        saveData: false,
        type: 'wifi',
        addEventListener: function () {},
        removeEventListener: function () {},
        dispatchEvent: function () { return true; }
      };
      Object.defineProperty(navigator, 'connection', {
        get: function () { return connectionObj; },
        configurable: true,
      });
    }
  } catch (_) {}

  // ── 6. Patch navigator.permissions.query ───────────────────────────────
  // Some sites call permissions.query({name:'notifications'}) on load.
  try {
    if (navigator.permissions && navigator.permissions.query) {
      var _origQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = function (desc) {
        if (desc && desc.name === 'notifications') {
          return Promise.resolve({
            state: 'default',
            status: 'default',
            name: 'notifications',
            onchange: null,
            addEventListener: function () {},
            removeEventListener: function () {},
            dispatchEvent: function () { return true; }
          });
        }
        return _origQuery(desc);
      };
    }
  } catch (_) {}

  // ── 7. Fix chrome object for Google/YouTube compatibility ──────────────
  try {
    if (typeof window.chrome === 'undefined') {
      window.chrome = {};
    }
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        connect: function () { return { onMessage: { addListener: function(){}, removeListener: function(){} }, postMessage: function(){}, disconnect: function(){} }; },
        sendMessage: function () {},
        onMessage: { addListener: function(){}, removeListener: function(){} },
        id: undefined
      };
    }
    // chrome.loadTimes and chrome.csi are expected by some Google pages
    if (!window.chrome.loadTimes) {
      window.chrome.loadTimes = function () {
        return {
          requestTime: Date.now() / 1000,
          startLoadTime: Date.now() / 1000,
          firstPaintTime: Date.now() / 1000 + 0.1,
          finishLoadTime: Date.now() / 1000 + 0.5,
          firstPaintAfterLoadTime: 0,
          navigationType: 'Other',
          wasFetchedViaSpdy: true,
          wasNpnNegotiated: true,
          npnNegotiatedProtocol: 'h2',
          wasAlternateProtocolAvailable: false,
          connectionInfo: 'h2'
        };
      };
    }
    if (!window.chrome.csi) {
      window.chrome.csi = function () {
        return { onloadT: Date.now(), startE: Date.now(), pageT: Date.now() / 1000 };
      };
    }
  } catch (_) {}

  // NOTE: Do NOT override addEventListener / removeEventListener.
  // Overriding those breaks keyboard events (Enter key), click handlers
  // (Sign In buttons), and many other page interactions.
})();