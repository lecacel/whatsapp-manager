// ============================================================
// Serial Key Manager - License validation system
// ============================================================
const crypto = require('crypto');
const os = require('os');
const Store = require('electron-store');

const store = new Store();

// Secret key for HMAC signing (CHANGE THIS TO YOUR OWN RANDOM SECRET)
const HMAC_SECRET = 'w4-m@n@ger-s3r14l-k3y-s3cr3t-2026!';

/**
 * Generate a unique Machine ID based on hardware info.
 * This ID is unique per machine and used to lock licenses.
 */
function getMachineId() {
  const rawData = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()[0]?.model || 'unknown',
    Math.floor(os.totalmem()).toString(),
  ].join('|');

  return crypto.createHash('sha256').update(rawData).digest('hex').substring(0, 32);
}

/**
 * Generate a serial key for a given machine ID and duration.
 * This function is used by the admin key generator.
 *
 * @param {string} machineId - The target machine ID
 * @param {number} durationDays - Number of days the license is valid
 * @returns {{ key: string, expiresAt: string, machineId: string }}
 */
function generateKey(machineId, durationDays) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  const payload = JSON.stringify({
    mid: machineId,
    exp: expiresAt.toISOString(),
    ts: now.toISOString(),
  });

  const signature = crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('hex');

  // Format: WM_<base64url-payload>_<16-char-signature>
  // The payload is kept intact so expiration and machine binding can be verified.
  const encoded = Buffer.from(payload).toString('base64url');

  return {
    key: `WM_${encoded}_${signature.substring(0, 16)}`,
    expiresAt: expiresAt.toISOString(),
    machineId: machineId,
  };
}

/**
 * Validate a serial key against the current machine.
 *
 * @param {string} key - The serial key to validate
 * @returns {{ valid: boolean, error?: string, expiresAt?: string, daysLeft?: number }}
 */
function validateKey(key) {
  if (!key || typeof key !== 'string') {
    return { valid: false, error: 'Serial key kosong.' };
  }

  try {
    const normalizedKey = key.trim();
    const parts = normalizedKey.split('_');

    if (parts.length !== 3 || parts[0] !== 'WM') {
      return { valid: false, error: 'Format serial key tidak valid.' };
    }

    const encodedPart = parts[1];
    const signaturePart = parts[2];

    // Decode the base64url payload
    let payloadStr;
    try {
      payloadStr = Buffer.from(encodedPart, 'base64url').toString('utf8');
    } catch (e) {
      return { valid: false, error: 'Format serial key tidak valid.' };
    }

    let payload;
    try {
      payload = JSON.parse(payloadStr);
    } catch (e) {
      return { valid: false, error: 'Data serial key rusak.' };
    }

    if (!payload.mid || !payload.exp) {
      return { valid: false, error: 'Data serial key tidak lengkap.' };
    }

    // Reconstruct the original payload string for HMAC verification
    const originalPayload = JSON.stringify({
      mid: payload.mid,
      exp: payload.exp,
      ts: payload.ts,
    });

    // Verify HMAC signature
    const expectedSignature = crypto
      .createHmac('sha256', HMAC_SECRET)
      .update(originalPayload)
      .digest('hex')
      .substring(0, 16);

    if (signaturePart.toLowerCase() !== expectedSignature.toLowerCase()) {
      return { valid: false, error: 'Serial key tidak valid (signature mismatch).' };
    }

    // Check machine ID
    const currentMachineId = getMachineId();
    if (payload.mid !== currentMachineId) {
      return {
        valid: false,
        error: `Serial key ini bukan untuk mesin ini. Machine ID Anda: ${currentMachineId}`,
      };
    }

    // Check expiration
    const expiresAt = new Date(payload.exp);
    const now = new Date();

    if (now > expiresAt) {
      return { valid: false, error: 'Serial key sudah expired (kadaluarsa).' };
    }

    const daysLeft = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));

    return {
      valid: true,
      expiresAt: expiresAt.toISOString(),
      daysLeft: daysLeft,
    };
  } catch (err) {
    return { valid: false, error: `Gagal memvalidasi key: ${err.message}` };
  }
}

/**
 * Activate a serial key - validate and store it.
 *
 * @param {string} key - The serial key to activate
 * @returns {{ success: boolean, error?: string, expiresAt?: string, daysLeft?: number }}
 */
function activateKey(key) {
  const result = validateKey(key);

  if (!result.valid) {
    return { success: false, error: result.error };
  }

  // Store the activated license
  store.set('license', {
    key: key,
    activatedAt: new Date().toISOString(),
    expiresAt: result.expiresAt,
    machineId: getMachineId(),
  });

  return {
    success: true,
    expiresAt: result.expiresAt,
    daysLeft: result.daysLeft,
  };
}

/**
 * Check the current license status.
 *
 * @returns {{ active: boolean, expiresAt?: string, daysLeft?: number, error?: string, machineId: string }}
 */
function checkLicense() {
  const license = store.get('license');

  if (!license || !license.key) {
    return {
      active: false,
      machineId: getMachineId(),
      error: 'Belum ada serial key yang diaktifkan.',
    };
  }

  const result = validateKey(license.key);

  if (!result.valid) {
    // Clear invalid/expired license
    store.delete('license');
    return {
      active: false,
      machineId: getMachineId(),
      error: result.error,
    };
  }

  return {
    active: true,
    expiresAt: result.expiresAt,
    daysLeft: result.daysLeft,
    machineId: getMachineId(),
  };
}

/**
 * Deactivate the current license.
 */
function deactivateLicense() {
  store.delete('license');
  return { success: true };
}

module.exports = {
  getMachineId,
  generateKey,
  validateKey,
  activateKey,
  checkLicense,
  deactivateLicense,
};