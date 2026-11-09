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
  const deviceLabel = existingLabel || label;

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


/**
 * Lists devices from their device-*.json files. Syncthing conflict copies are not devices.
 *
 * @param {object} storage - Shared storage interface.
 * @returns {Promise<Array<{ deviceId: string, label: string, createdAt: string|null, mergedInto: string|null }>>}
 */
export async function listDevices(storage) {
  if (!storage || typeof storage.listFiles !== 'function') {
    return [];
  }

  const files = await storage.listFiles('device-');
  const deviceFiles = (files || []).filter(
    (f) => f && f.name && /^device-[^ ]+\.json$/.test(f.name) && !f.name.includes('.sync-conflict-')
  );

  const devices = [];
  for (const f of deviceFiles) {
    try {
      const content = await storage.readFile(f.name);
      if (content) {
        const meta = JSON.parse(content);
        devices.push({
          deviceId: meta.deviceId || f.name.replace(/^device-/, '').replace(/\.json$/, ''),
          label: meta.label || 'Unknown',
          createdAt: meta.createdAt || null,
          mergedInto: meta.mergedInto || null,
        });
      }
    } catch (e) {
      // Ignore corrupt metadata
    }
  }

  return devices.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
}

/**
 * Removes a device from the list by marking it merged into another. Only its small metadata
 * file changes; its event log stays, because that is the expense history.
 */
export async function mergeDevice({ storage, deviceId, intoId }) {
  if (!deviceId || !intoId || deviceId === intoId) {
    throw new Error('Choose a different device to merge into');
  }
  const name = `device-${deviceId}.json`;
  const content = await storage.readFile(name);
  const meta = content ? JSON.parse(content) : { deviceId, label: 'Unknown' };
  await storage.writeFile(name, `${JSON.stringify({ ...meta, mergedInto: intoId }, null, 2)}\n`);
}

/**
 * Groups devices by person: each active device with the older installs merged into it.
 *
 * @param {Array<object>} devices - From listDevices.
 * @param {string} currentId - This phone's device id.
 * @returns {{ groups: Array<{ deviceId: string, label: string, memberIds: string[] }>, mine: object, others: Array<object> }}
 */
export function buildDeviceGroups(devices = [], currentId = '') {
  const byId = new Map(devices.map((d) => [d.deviceId, d]));

  const finalOf = (id) => {
    const seen = new Set([id]);
    let current = id;
    while (byId.get(current)?.mergedInto && byId.has(byId.get(current).mergedInto) && !seen.has(byId.get(current).mergedInto)) {
      current = byId.get(current).mergedInto;
      seen.add(current);
    }
    return current;
  };

  const groupsById = new Map();
  for (const d of devices) {
    const finalId = finalOf(d.deviceId);
    if (!groupsById.has(finalId)) {
      groupsById.set(finalId, { deviceId: finalId, label: byId.get(finalId).label, memberIds: [] });
    }
    groupsById.get(finalId).memberIds.push(d.deviceId);
  }

  const mineId = byId.has(currentId) ? finalOf(currentId) : currentId;
  const mine = groupsById.get(mineId) || { deviceId: currentId, label: 'Me', memberIds: currentId ? [currentId] : [] };
  const others = [...groupsById.values()].filter((g) => g.deviceId !== mine.deviceId).sort((a, b) => a.label.localeCompare(b.label));

  return { groups: groupsById.has(mineId) ? [mine, ...others] : others, mine, others };
}

/** Ids of accounts owned jointly. */
export function jointAccountIds(accounts = []) {
  return accounts.filter((a) => a && String(a.owner || '').toLowerCase() === 'joint').map((a) => a.id);
}

/**
 * Expense filter for a Home scope: "mine", another group's deviceId, or "all".
 * Joint-account expenses count only in "all".
 */
export function scopeFilter(deviceGroups, scope, jointIds = []) {
  if (scope === 'all' || !deviceGroups) return {};
  const group = scope === 'mine' ? deviceGroups.mine : deviceGroups.groups.find((g) => g.deviceId === scope);
  if (!group?.memberIds?.length) return {};
  return {
    createdByDev: group.memberIds.join(','),
    ...(jointIds.length > 0 ? { excludeAccountIds: jointIds } : {}),
  };
}
