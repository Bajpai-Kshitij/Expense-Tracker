import { createEmptyState, applyEvents as applyReducerEvents } from '../events/reducer.js';
import { stateToRows, rowsToState } from './mapper.js';

const EXPENSE_COLUMNS = [
  'id', 'amount_paise', 'date', 'txn_ts', 'direction', 'kind', 'merchant_raw', 'brand',
  'category_id', 'category_locked', 'account_id', 'mode', 'source', 'ref_no', 'dedupe_key',
  'note', 'status', 'field_ts', 'created_by_dev', 'merged_into',
  'statement_key', 'statement_file_hash', 'link_id',
  'emi_plan_key', 'emi_no', 'emi_total', 'emi_part', 'emi_monthly_paise', 'emi_finish_date',
  'emi_outstanding_paise', 'bank_category', 'extras',
];

// Local tables (raw_messages, settings, sync_state) are not part of the projection.
const PROJECTION_TABLES = [
  { name: 'expenses', key: 'id', columns: EXPENSE_COLUMNS },
  { name: 'categories', key: 'id', columns: ['id', 'name', 'icon', 'color', 'extras'] },
  { name: 'brands', key: 'id', columns: ['id', 'name', 'default_category_id', 'extras'] },
  { name: 'rules', key: 'id', columns: ['id', 'pattern', 'category_id', 'account_id', 'extras'] },
  { name: 'accounts', key: 'id', columns: ['id', 'name', 'type', 'extras'] },
  { name: 'review_queue', key: 'id', columns: ['id', 'type', 'payload', 'status'] },
  { name: 'applied_events', key: 'id', columns: ['id'] },
  { name: 'pending_events', key: 'id', columns: ['id', 'event'] },
  { name: 'expense_keys', key: 'key', columns: ['key', 'expense_id'] },
];

const dbLocks = new WeakMap();

/**
 * Runs fn after every earlier read-modify-write on this database has finished, so a save
 * during a background sync cannot be overwritten by a stale copy of the tables.
 */
function withDbLock(db, fn) {
  const previous = dbLocks.get(db) || Promise.resolve();
  const run = previous.then(fn, fn);
  dbLocks.set(db, run.catch(() => {}));
  return run;
}

function upsertRow(tx, table, row) {
  const placeholders = table.columns.map(() => '?').join(', ');
  return tx.exec(
    `INSERT OR REPLACE INTO ${table.name} (${table.columns.join(', ')}) VALUES (${placeholders});`,
    table.columns.map((c) => row[c] ?? null)
  );
}

function sameRow(table, a, b) {
  return table.columns.every((c) => (a[c] ?? null) === (b[c] ?? null));
}

async function writeAllRows(tx, rows) {
  for (const table of PROJECTION_TABLES) {
    await tx.exec(`DELETE FROM ${table.name};`);
    for (const row of rows[table.name] || []) {
      await upsertRow(tx, table, row);
    }
  }
}

/** Writes only the rows that differ, so one save costs a few statements at any history size. */
async function writeChangedRows(tx, previous, next) {
  for (const table of PROJECTION_TABLES) {
    const before = new Map((previous[table.name] || []).map((r) => [r[table.key], r]));
    const nextRows = next[table.name] || [];
    for (const row of nextRows) {
      const old = before.get(row[table.key]);
      if (!old || !sameRow(table, old, row)) {
        await upsertRow(tx, table, row);
      }
      before.delete(row[table.key]);
    }
    for (const key of before.keys()) {
      await tx.exec(`DELETE FROM ${table.name} WHERE ${table.key} = ?;`, [key]);
    }
  }
}

async function readProjectionRows(db) {
  const rows = {};
  for (const table of PROJECTION_TABLES) {
    rows[table.name] = await db.query(`SELECT * FROM ${table.name} ORDER BY ${table.key} ASC;`);
  }
  return rows;
}

/**
 * Reads the current reducer state, including keys linked to expenses.
 * @param {object} db - Database adapter.
 * @returns {Promise<object>} Hydrated reducer state.
 */
export async function loadStateFromDb(db) {
  return rowsToState(await readProjectionRows(db));
}

/**
 * Rebuilds the SQLite read model from all events in ONE transaction.
 * Review items not covered by an event exist only on this phone, so they are kept.
 *
 * @param {object} db - Database adapter.
 * @param {object[]} allEvents - All historical events.
 * @returns {Promise<object>} Final reducer state.
 */
export function rebuildFromEvents(db, allEvents = []) {
  return withDbLock(db, async () => {
    const state = applyReducerEvents(createEmptyState(), allEvents);
    const rows = stateToRows(state);

    const known = new Set(rows.review_queue.map((r) => r.id));
    const localReviews = await db.query('SELECT * FROM review_queue ORDER BY id ASC;');
    rows.review_queue.push(...localReviews.filter((r) => !known.has(r.id)));

    await db.transaction(async (tx) => {
      await writeAllRows(tx, rows);
    });

    return state;
  });
}

/**
 * Incrementally applies new events to the SQLite database.
 *
 * @param {object} db - Database adapter.
 * @param {object[]} newEvents - Incoming events.
 * @returns {Promise<object>} Updated reducer state.
 */
export function applyEventsToDb(db, newEvents = []) {
  return withDbLock(db, async () => {
    const previous = await readProjectionRows(db);
    const nextState = applyReducerEvents(rowsToState(previous), newEvents);
    const nextRows = stateToRows(nextState);

    await db.transaction(async (tx) => {
      await writeChangedRows(tx, previous, nextRows);
    });

    return nextState;
  });
}

/**
 * Dumps canonical content of all projection tables for determinism assertions.
 * @param {object} db - Database adapter.
 * @returns {Promise<object>} Table dump keyed by table name.
 */
export async function dumpDatabase(db) {
  const tables = [
    'expenses',
    'categories',
    'brands',
    'rules',
    'accounts',
    'review_queue',
    'applied_events',
    'pending_events',
    'expense_keys',
  ];

  const dump = {};
  for (const table of tables) {
    const orderCol = table === 'expense_keys' ? 'key' : 'id';
    dump[table] = await db.query(`SELECT * FROM ${table} ORDER BY ${orderCol} ASC;`);
  }
  return dump;
}

