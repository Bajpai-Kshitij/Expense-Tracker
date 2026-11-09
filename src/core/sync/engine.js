import { readAllEvents } from './reader.js';
import { applyEventsToDb, rebuildFromEvents } from '../db/index.js';

/** Events older than the last fresh start must not come back. */
async function freshStartMs(db) {
  const rows = await db.query("SELECT value FROM settings WHERE key = 'data_epoch';");
  return rows[0]?.value ? Date.parse(rows[0].value) : null;
}

/**
 * Synchronizes the local SQLite read model with event logs in shared storage.
 * Reads unapplied events from all event files, applies them, updates sync_state,
 * and returns execution metrics.
 * 
 * @param {object} options
 * @param {object} options.storage - Shared storage interface.
 * @param {object} options.db - SQLite database adapter.
 * @param {string} [options.deviceId] - Current device ID.
 * @param {boolean} [options.full=false] - If true, re-reads all files from line 0.
 * @returns {Promise<{ files: number, linesRead: number, newEvents: number, applied: number, parked: number, issues: object[] }>}
 */
export async function syncNow({
  storage,
  db,
  deviceId,
  full = false,
} = {}) {
  const { events, issues, fileStats, totalLinesRead } = await readAllEvents({
    storage,
    db,
    full,
    sinceMs: await freshStartMs(db),
  });

  const appliedRows = await db.query('SELECT id FROM applied_events;');
  const appliedIds = new Set(appliedRows.map((r) => r.id));

  // Deduplicate unapplied events by event ID
  const seenIds = new Set();
  const unappliedEvents = [];
  for (const ev of events) {
    if (!appliedIds.has(ev.id) && !seenIds.has(ev.id)) {
      seenIds.add(ev.id);
      unappliedEvents.push(ev);
    }
  }

  const newEvents = unappliedEvents.length;
  let appliedCount = 0;
  let parkedCount = 0;

  if (newEvents > 0) {
    const nextState = await applyEventsToDb(db, unappliedEvents);
    const parkedIds = new Set((nextState.parkedEvents || []).map((e) => e.id));
    appliedCount = unappliedEvents.filter((e) => !parkedIds.has(e.id)).length;
    parkedCount = nextState.parkedEvents?.length || 0;
  } else {
    const parkedRows = await db.query('SELECT count(*) as c FROM pending_events;');
    parkedCount = parkedRows[0]?.c || 0;
  }

  // Update sync_state only after the database transaction succeeds
  for (const f of fileStats) {
    await db.exec('INSERT OR REPLACE INTO sync_state (file, lines_read) VALUES (?, ?);', [
      f.name,
      f.linesCount,
    ]);
  }

  return {
    files: fileStats.length,
    linesRead: totalLinesRead,
    newEvents,
    applied: appliedCount,
    parked: parkedCount,
    issues,
  };
}

const PROJECTION_VERSION = '4';

/**
 * Rebuilds once after an update that added read-model fields, restoring them from the logs.
 *
 * @param {object} options
 * @param {object} options.storage - Shared storage interface.
 * @param {object} options.db - SQLite database adapter.
 * @returns {Promise<boolean>} True when a rebuild ran.
 */
export async function upgradeProjectionIfNeeded({ storage, db }) {
  const rows = await db.query("SELECT value FROM settings WHERE key = 'projection_version';");
  if (rows[0]?.value === PROJECTION_VERSION) return false;

  const count = await db.query('SELECT count(*) as c FROM expenses;');
  const needsRebuild = (count[0]?.c || 0) > 0;
  if (needsRebuild) {
    await rebuildFromLogs({ storage, db });
  }
  await db.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('projection_version', ?);", [PROJECTION_VERSION]);
  return needsRebuild;
}

/**
 * Completely rebuilds the SQLite read model from all event log files in shared storage.
 * Runs reducer from empty state, replaces projection tables, and resets sync_state.
 * 
 * @param {object} options
 * @param {object} options.storage - Shared storage interface.
 * @param {object} options.db - SQLite database adapter.
 * @returns {Promise<{ files: number, linesRead: number, totalEvents: number, parked: number, issues: object[] }>}
 */
export async function rebuildFromLogs({
  storage,
  db,
} = {}) {
  const { events, issues, fileStats, totalLinesRead } = await readAllEvents({
    storage,
    db,
    full: true,
    sinceMs: await freshStartMs(db),
  });

  if (events.length === 0) {
    const rows = await db.query('SELECT count(*) as c FROM expenses;');
    if ((rows[0]?.c || 0) > 0) {
      throw new Error('No events were found in the shared folder, so nothing was changed. Check the folder and sync first.');
    }
  }

  // Rebuild all projection tables from empty state
  const nextState = await rebuildFromEvents(db, events);

  // Reset sync_state to match all processed files
  await db.transaction(async (tx) => {
    await tx.exec('DELETE FROM sync_state;');
    for (const f of fileStats) {
      await tx.exec('INSERT OR REPLACE INTO sync_state (file, lines_read) VALUES (?, ?);', [
        f.name,
        f.linesCount,
      ]);
    }
  });

  return {
    files: fileStats.length,
    linesRead: totalLinesRead,
    totalEvents: events.length,
    parked: nextState.parkedEvents?.length || 0,
    issues,
  };
}

