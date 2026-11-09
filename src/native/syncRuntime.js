import { createCapacitorSqliteAdapter } from './sqlite.js';
import { migrate } from '../core/db/migrations.js';
import { createSyncStorage } from './syncStorage.js';
import { ensureDevice, listDevices } from '../core/sync/device.js';
import { createWriter } from '../core/sync/writer.js';
import { syncNow, rebuildFromLogs } from '../core/sync/engine.js';
import { withTimeout } from './timeout.js';
import { prepareConfigSync, finishConfigSync, startFresh } from '../core/config/sharedConfig.js';
import { logStepStart, logStepFinish, logStepError } from './onboardingProgress.js';

export { listDevices };

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
      return withTimeout(writer.write(type, data), 60000, 'Seeding');
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
        const res = await withTimeout(
          (async () => {
            const before = await prepareConfigSync({ storage, db });
            const summary = await syncNow({ storage, db, deviceId, full });
            try {
              await finishConfigSync({ storage, db, writer, config: before.config, invalid: before.invalid });
            } catch (e) {
              console.error('Config sync failed:', e?.message);
            }
            return { ...summary, reset: before.reset };
          })(),
          120000,
          'First sync'
        );
        logStepFinish('First sync');
        logStepStart('Seeding');
        return res;
      } catch (err) {
        logStepError('First sync', err);
        throw err;
      }
    },
    rebuild: () => rebuildFromLogs({ storage, db }),
    startFresh: () => startFresh({ storage, db }),
    listDevices: async () => {
      logStepFinish('Seeding');
      return withTimeout(listDevices(storage), 15000, 'Seeding');
    },
  };
}
