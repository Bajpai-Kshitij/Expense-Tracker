import { createCapacitorSqliteAdapter } from './sqlite.js';
import { migrate } from '../core/db/migrations.js';
import { createSyncStorage } from './syncStorage.js';
import { ensureDevice } from '../core/sync/device.js';
import { createWriter } from '../core/sync/writer.js';
import { syncNow, rebuildFromLogs } from '../core/sync/engine.js';
import { withTimeout } from './timeout.js';
import { logStepStart, logStepFinish, logStepError } from './onboardingProgress.js';

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

  logStepStart('Opening database');
  let db;
  try {
    db = await withTimeout(createCapacitorSqliteAdapter(databaseName), 15000, 'Opening database');
    await withTimeout(migrate(db), 15000, 'Opening database');
    logStepFinish('Opening database');
  } catch (err) {
    logStepError('Opening database', err);
    throw err;
  }

  logStepStart('Creating device file');
  let storage, deviceId, label, writer;
  try {
    storage = createSyncStorage(folderUri);
    const dev = await withTimeout(ensureDevice({ db, storage }), 15000, 'Creating device file');
    deviceId = dev.deviceId;
    label = dev.label;

    writer = createWriter({ deviceId, storage, db });
    await withTimeout(writer.init(), 15000, 'Creating device file');
    logStepFinish('Creating device file');
  } catch (err) {
    logStepError('Creating device file', err);
    throw err;
  }

  const wrappedWriter = {
    ...writer,
    async write(type, data) {
      return withTimeout(writer.write(type, data), 15000, 'Seeding');
    },
  };

  return {
    deviceId,
    deviceLabel: label,
    db,
    storage,
    writer: wrappedWriter,
    sync: async (full = false) => {
      logStepStart('First sync');
      try {
        const res = await withTimeout(syncNow({ storage, db, deviceId, full }), 15000, 'First sync');
        logStepFinish('First sync');
        logStepStart('Seeding');
        return res;
      } catch (err) {
        logStepError('First sync', err);
        throw err;
      }
    },
    rebuild: () => rebuildFromLogs({ storage, db }),
    listDevices: async () => {
      logStepFinish('Seeding');
      return withTimeout(listDevices(storage), 15000, 'Seeding');
    },
  };
}
