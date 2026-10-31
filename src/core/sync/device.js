const CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

function generateRandomDeviceId(random = Math.random) {
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += CHARS[Math.floor(random() * CHARS.length)];
  }
  return `dev-${suffix}`;
}

/**
 * Ensures a device ID and label are provisioned for this device.
 * Stores them in the local settings table and writes device-<id>.json to storage.
 * Idempotent on subsequent calls.
 * 
 * @param {object} options
 * @param {object} [options.settings] - Settings query object or mock.
 * @param {object} [options.db] - Database adapter.
 * @param {object} [options.storage] - Shared storage interface.
 * @param {() => number} [options.random] - Random number generator.
 * @param {() => number|string} [options.now] - Clock function.
 * @param {string} [options.label='Me'] - Human-readable device label.
 * @returns {Promise<{ deviceId: string, label: string, createdAt?: string }>}
 */
export async function ensureDevice({
  settings,
  db,
  storage,
  random = Math.random,
  now = () => Date.now(),
  label = 'Me',
} = {}) {
  let existingId = null;
  let existingLabel = null;

  // Retrieve existing device info from settings
  if (settings && typeof settings.getSetting === 'function') {
    if (db) {
      existingId = await settings.getSetting(db, 'deviceId');
      existingLabel = await settings.getSetting(db, 'deviceLabel');
    } else {
      existingId = await settings.getSetting('deviceId');
      existingLabel = await settings.getSetting('deviceLabel');
    }
  } else if (settings && typeof settings.get === 'function') {
    existingId = await settings.get('deviceId');
    existingLabel = await settings.get('deviceLabel');
  } else if (db && typeof db.query === 'function') {
    const idRows = await db.query('SELECT value FROM settings WHERE key = ?;', ['deviceId']);
    existingId = idRows[0]?.value ?? null;
    const labelRows = await db.query('SELECT value FROM settings WHERE key = ?;', ['deviceLabel']);
    existingLabel = labelRows[0]?.value ?? null;
  }

  if (existingId) {
    return {
      deviceId: existingId,
      label: existingLabel || label,
    };
  }

  // Provision new device ID
  const deviceId = generateRandomDeviceId(random);
  const deviceLabel = label;

  // Persist to settings
  if (settings && typeof settings.setSetting === 'function') {
    if (db) {
      await settings.setSetting(db, 'deviceId', deviceId);
      await settings.setSetting(db, 'deviceLabel', deviceLabel);
    } else {
      await settings.setSetting('deviceId', deviceId);
      await settings.setSetting('deviceLabel', deviceLabel);
    }
  } else if (settings && typeof settings.set === 'function') {
    await settings.set('deviceId', deviceId);
    await settings.set('deviceLabel', deviceLabel);
  } else if (db && typeof db.exec === 'function') {
    await db.exec('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);', ['deviceId', deviceId]);
    await db.exec('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);', ['deviceLabel', deviceLabel]);
  }

  const nowVal = typeof now === 'function' ? now() : Date.now();
  const createdAt = typeof nowVal === 'number'
    ? new Date(nowVal).toISOString()
    : (typeof nowVal === 'string' ? nowVal : new Date().toISOString());

  // Write device-<id>.json to shared storage
  if (storage && typeof storage.writeFile === 'function') {
    const meta = {
      deviceId,
      label: deviceLabel,
      createdAt,
    };
    await storage.writeFile(`device-${deviceId}.json`, JSON.stringify(meta, null, 2) + '\n');
  }

  return {
    deviceId,
    label: deviceLabel,
    createdAt,
  };
}

