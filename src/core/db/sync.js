import { createEmptyState, applyEvents as applyReducerEvents } from '../events/reducer.js';
import { stateToRows, rowsToState } from './mapper.js';

/**
 * Replaces all projection tables in the database with the given row representations in ONE transaction.
 * Projection tables: expenses, categories, brands, rules, accounts, review_queue, applied_events, pending_events.
 * Local tables (raw_messages, settings, sync_state) are untouched.
 */
async function writeProjectionRows(tx, rows) {
  await tx.exec('DELETE FROM expenses;');
  await tx.exec('DELETE FROM categories;');
  await tx.exec('DELETE FROM brands;');
  await tx.exec('DELETE FROM rules;');
  await tx.exec('DELETE FROM accounts;');
  await tx.exec('DELETE FROM review_queue;');
  await tx.exec('DELETE FROM applied_events;');
  await tx.exec('DELETE FROM pending_events;');

  for (const exp of rows.expenses) {
    await tx.exec(
      `INSERT INTO expenses (
        id, amount_paise, date, txn_ts, direction, kind, merchant_raw, brand,
        category_id, category_locked, account_id, mode, source, ref_no, dedupe_key,
        note, status, field_ts, created_by_dev, merged_into
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
      [
        exp.id,
        exp.amount_paise,
        exp.date,
        exp.txn_ts,
        exp.direction,
        exp.kind,
        exp.merchant_raw,
        exp.brand,
        exp.category_id,
        exp.category_locked,
        exp.account_id,
        exp.mode,
        exp.source,
        exp.ref_no,
        exp.dedupe_key,
        exp.note,
        exp.status,
        exp.field_ts,
        exp.created_by_dev,
        exp.merged_into,
      ]
    );
  }

  for (const cat of rows.categories) {
    await tx.exec(
      'INSERT INTO categories (id, name, icon, color, extras) VALUES (?, ?, ?, ?, ?);',
      [cat.id, cat.name, cat.icon, cat.color, cat.extras]
    );
  }

  for (const brand of rows.brands) {
    await tx.exec(
      'INSERT INTO brands (id, name, default_category_id, extras) VALUES (?, ?, ?, ?);',
      [brand.id, brand.name, brand.default_category_id, brand.extras]
    );
  }

  for (const rule of rows.rules) {
    await tx.exec(
      'INSERT INTO rules (id, pattern, category_id, account_id, extras) VALUES (?, ?, ?, ?, ?);',
      [rule.id, rule.pattern, rule.category_id, rule.account_id, rule.extras]
    );
  }

  for (const acc of rows.accounts) {
    await tx.exec(
      'INSERT INTO accounts (id, name, type, extras) VALUES (?, ?, ?, ?);',
      [acc.id, acc.name, acc.type, acc.extras]
    );
  }

  for (const rev of rows.review_queue) {
    await tx.exec(
      'INSERT INTO review_queue (id, type, payload, status) VALUES (?, ?, ?, ?);',
      [rev.id, rev.type, rev.payload, rev.status]
    );
  }

  for (const evId of rows.applied_events) {
    await tx.exec('INSERT INTO applied_events (id) VALUES (?);', [evId.id]);
  }

  for (const pending of rows.pending_events) {
    await tx.exec('INSERT INTO pending_events (id, event) VALUES (?, ?);', [
      pending.id,
      pending.event,
    ]);
  }
}

/**
 * Rebuilds the SQLite read model projection completely from all events.
 * Runs reducer from empty state, then replaces all projection tables in ONE transaction.
 * 
 * @param {object} db - Database adapter.
 * @param {object[]} allEvents - All historical events.
 * @returns {Promise<object>} Final reducer state.
 */
export async function rebuildFromEvents(db, allEvents = []) {
  const state = applyReducerEvents(createEmptyState(), allEvents);
  const rows = stateToRows(state);

  await db.transaction(async (tx) => {
    await writeProjectionRows(tx, rows);
  });

  return state;
}

/**
 * Incrementally applies new events to the SQLite database.
 * Hydrates state from tables, runs the reducer, and writes back changed state in ONE transaction.
 * 
 * @param {object} db - Database adapter.
 * @param {object[]} newEvents - Incoming events.
 * @returns {Promise<object>} Updated reducer state.
 */
export async function applyEventsToDb(db, newEvents = []) {
  const rows = {
    expenses: await db.query('SELECT * FROM expenses ORDER BY id ASC;'),
    categories: await db.query('SELECT * FROM categories ORDER BY id ASC;'),
    brands: await db.query('SELECT * FROM brands ORDER BY id ASC;'),
    rules: await db.query('SELECT * FROM rules ORDER BY id ASC;'),
    accounts: await db.query('SELECT * FROM accounts ORDER BY id ASC;'),
    applied_events: await db.query('SELECT * FROM applied_events ORDER BY id ASC;'),
    pending_events: await db.query('SELECT * FROM pending_events ORDER BY id ASC;'),
    review_queue: await db.query('SELECT * FROM review_queue ORDER BY id ASC;'),
  };

  const currentState = rowsToState(rows);
  const nextState = applyReducerEvents(currentState, newEvents);
  const nextRows = stateToRows(nextState);

  await db.transaction(async (tx) => {
    await writeProjectionRows(tx, nextRows);
  });

  return nextState;
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
  ];

  const dump = {};
  for (const table of tables) {
    dump[table] = await db.query(`SELECT * FROM ${table} ORDER BY id ASC;`);
  }
  return dump;
}

