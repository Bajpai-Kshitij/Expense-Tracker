/**
 * Schema migrations for offline SQLite read model.
 * Tracked in schema_version table. Running migrations repeatedly is safe and idempotent.
 */

export const MIGRATIONS = [
  {
    version: 1,
    name: 'initial_schema',
    up: async (db) => {
      // Expenses projection table
      await db.exec(`
        CREATE TABLE IF NOT EXISTS expenses (
          id TEXT PRIMARY KEY,
          amount_paise INTEGER,
          date TEXT,
          txn_ts TEXT,
          direction TEXT,
          kind TEXT,
          merchant_raw TEXT,
          brand TEXT,
          category_id TEXT,
          category_locked INTEGER DEFAULT 0,
          account_id TEXT,
          mode TEXT,
          source TEXT,
          ref_no TEXT,
          dedupe_key TEXT,
          note TEXT,
          status TEXT DEFAULT 'active',
          field_ts TEXT,
          created_by_dev TEXT,
          merged_into TEXT
        );
      `);

      // Indexes for frequent queries
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);`);
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_expenses_category_id ON expenses(category_id);`);
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_expenses_account_id ON expenses(account_id);`);
      await db.exec(`CREATE INDEX IF NOT EXISTS idx_expenses_kind_status ON expenses(kind, status);`);

      // Auxiliary entities with extra fields as JSON
      await db.exec(`
        CREATE TABLE IF NOT EXISTS categories (
          id TEXT PRIMARY KEY,
          name TEXT,
          icon TEXT,
          color TEXT,
          extras TEXT
        );
      `);

      await db.exec(`
        CREATE TABLE IF NOT EXISTS brands (
          id TEXT PRIMARY KEY,
          name TEXT,
          default_category_id TEXT,
          extras TEXT
        );
      `);

      await db.exec(`
        CREATE TABLE IF NOT EXISTS rules (
          id TEXT PRIMARY KEY,
          pattern TEXT,
          category_id TEXT,
          account_id TEXT,
          extras TEXT
        );
      `);

      await db.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
          id TEXT PRIMARY KEY,
          name TEXT,
          type TEXT,
          extras TEXT
        );
      `);

      // Review queue for manual resolutions
      await db.exec(`
        CREATE TABLE IF NOT EXISTS review_queue (
          id TEXT PRIMARY KEY,
          type TEXT,
          payload TEXT,
          status TEXT
        );
      `);

      // Raw messages (device-local only, purged periodically, never in event logs)
      await db.exec(`
        CREATE TABLE IF NOT EXISTS raw_messages (
          hash TEXT UNIQUE,
          kind TEXT,
          body TEXT,
          received_at TEXT,
          parsed TEXT
        );
      `);

      // Applied event IDs to enforce idempotency
      await db.exec(`
        CREATE TABLE IF NOT EXISTS applied_events (
          id TEXT PRIMARY KEY
        );
      `);

      // Parked events awaiting create
      await db.exec(`
        CREATE TABLE IF NOT EXISTS pending_events (
          id TEXT PRIMARY KEY,
          event TEXT
        );
      `);

      // Sync state and key-value settings
      await db.exec(`
        CREATE TABLE IF NOT EXISTS sync_state (
          file TEXT PRIMARY KEY,
          lines_read INTEGER
        );
      `);

      await db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT
        );
      `);
    },
  },
];

/**
 * Runs pending migrations sequentially up to the latest version.
 * @param {object} db - Database adapter { exec, query, transaction }.
 * @returns {Promise<number>} Current schema version after migration.
 */
export async function migrate(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);`);

  const rows = await db.query(`SELECT MAX(version) as current_version FROM schema_version;`);
  const currentVersion = rows[0]?.current_version || 0;

  const pending = MIGRATIONS.filter((m) => m.version > currentVersion).sort(
    (a, b) => a.version - b.version
  );

  for (const m of pending) {
    await db.transaction(async (tx) => {
      await m.up(tx);
      await tx.exec(`INSERT INTO schema_version (version) VALUES (?);`, [m.version]);
    });
  }

  const finalRows = await db.query(`SELECT MAX(version) as current_version FROM schema_version;`);
  return finalRows[0]?.current_version || currentVersion;
}

