import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';

/**
 * Creates an SQLite adapter using @capacitor-community/sqlite for Android/iOS runtime.
 * Implements { exec(sql, params), query(sql, params), transaction(fn) }.
 * 
 * @param {string} [databaseName='expense_tracker'] - SQLite database name.
 * @returns {Promise<object>} Database adapter.
 */
export async function createCapacitorSqliteAdapter(databaseName = 'expense_tracker') {
  const sqlite = new SQLiteConnection(CapacitorSQLite);

  const ret = await sqlite.checkConnectionsConsistency();
  const isConn = (await sqlite.isConnection(databaseName, false)).result;

  let db;
  if (ret.result && isConn) {
    db = await sqlite.retrieveConnection(databaseName, false);
  } else {
    db = await sqlite.createConnection(databaseName, false, 'no-encryption', 1, false);
  }

  await db.open();

  const adapter = {
    async exec(sql, params = []) {
      if (params && params.length > 0) {
        await db.run(sql, params);
      } else {
        await db.execute(sql);
      }
    },

    async query(sql, params = []) {
      const res = await db.query(sql, params || []);
      return res.values || [];
    },

    async transaction(fn) {
      await db.run('BEGIN TRANSACTION;');
      try {
        const result = await fn(adapter);
        await db.run('COMMIT;');
        return result;
      } catch (err) {
        await db.run('ROLLBACK;');
        throw err;
      }
    },

    async close() {
      await db.close();
      await sqlite.closeConnection(databaseName, false);
    },
  };

  return adapter;
}

