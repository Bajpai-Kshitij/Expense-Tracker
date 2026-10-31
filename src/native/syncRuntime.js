import { createCapacitorSqliteAdapter } from './sqlite.js';
import { migrate } from '../core/db/migrations.js';
import { createSyncStorage } from './syncStorage.js';
import { ensureDevice } from '../core/sync/device.js';
import { createWriter } from '../core/sync/writer.js';
import { syncNow, rebuildFromLogs } from '../core/sync/engine.js';

/**
 * Lists all known devices by scanning device-*.json metadata files in the shared storage folder.
 * 
 * @param {object} storage - Shared storage interface.
 * @returns {Promise<Array<{ deviceId: string, label: string, createdAt: string|null }>>}
 */
export async function listDevices(storage) {
  if (!storage || typeof storage.listFiles !== 'function') {
    return [];
  }

  const files = await storage.listFiles('device-');
  const deviceFiles = (files || []).filter(
    (f) => f && f.name && f.name.startsWith('device-') && f.name.endsWith('.json')
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
        });
      }
    } catch (e) {
      // Ignore corrupt metadata
    }
  }

  return devices.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
}

/**
 * Initializes the full sync and database runtime on device.
 * 
 * @param {object} options
 * @param {string} options.folderUri - Persisted SAF folder tree URI.
 * @param {string} [options.databaseName='expense_tracker'] - SQLite database name.
 * @returns {Promise<{ deviceId: string, deviceLabel: string, db: object, storage: object, writer: object, sync: (full?: boolean) => Promise<object>, rebuild: () => Promise<object>, listDevices: () => Promise<object[]> }>}
 */
export async function initRuntime({ folderUri, databaseName = 'expense_tracker' }) {
  if (!folderUri) {
    throw new Error('folderUri is required to initialize sync runtime');
  }

  const db = await createCapacitorSqliteAdapter(databaseName);
  await migrate(db);

  const storage = createSyncStorage(folderUri);
  const { deviceId, label } = await ensureDevice({ db, storage });

  const writer = createWriter({ deviceId, storage, db });
  await writer.init();

  return {
    deviceId,
    deviceLabel: label,
    db,
    storage,
    writer,
    sync: (full = false) => syncNow({ storage, db, deviceId, full }),
    rebuild: () => rebuildFromLogs({ storage, db }),
    listDevices: () => listDevices(storage),
  };
}
