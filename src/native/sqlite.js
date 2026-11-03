import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';

const adapterCache = new Map();
let sqliteInstance = null;

function getSqliteConnection() {
  if (!sqliteInstance) {
    sqliteInstance = new SQLiteConnection(CapacitorSQLite);
  }
  return sqliteInstance;
}

/**
 * Resets the in-memory adapter cache (useful in tests).
 */
export function clearSqliteAdapterCache() {
  adapterCache.clear();
}

/**
 * Wraps an SQLiteDBConnection (or compatible mock) into our database adapter.
 * Manages transactions with depth counting, ensuring single ownership and no duplicate BEGINs.
 * 
 * @param {object} db - SQLite database connection.
 * @param {string} [databaseName='expense_tracker']
 * @param {object} [sqlite=null] - SQLiteConnection manager instance (optional, for close).
 * @returns {object} Database adapter { exec, query, transaction, close }.
 */
export function createSqliteAdapterFromDb(db, databaseName = 'expense_tracker', sqlite = null) {
  let transactionDepth = 0;

  const adapter = {
    async exec(sql, params = []) {
      const inTx = transactionDepth > 0;
      if (params && params.length > 0) {
        if (inTx) {
          await db.run(sql, params, false);
        } else {
          await db.run(sql, params);
        }
      } else {
        if (inTx) {
          await db.execute(sql, false);
        } else {
          await db.execute(sql);
        }
      }
    },

    async query(sql, params = []) {
      const inTx = transactionDepth > 0;
      const res = inTx
        ? await db.query(sql, params || [], false)
        : await db.query(sql, params || []);
      return (res && res.values) || [];
    },

    async transaction(fn) {
      const isOuter = transactionDepth === 0;

      if (isOuter) {
        // If a transaction is already active from a failed earlier run, roll it back before starting a new one.
        if (typeof db.isTransactionActive === 'function') {
          try {
            const active = await db.isTransactionActive();
            if (active && active.result) {
              await db.rollbackTransaction();
            }
          } catch (e) {
            // Ignore rollback error on stale transaction cleanup
          }
        }
        await db.beginTransaction();
      }

      transactionDepth++;

      try {
        const result = await fn(adapter);
        if (isOuter) {
          await db.commitTransaction();
        }
        return result;
      } catch (err) {
        if (isOuter) {
          try {
            if (typeof db.isTransactionActive === 'function') {
              const active = await db.isTransactionActive();
              if (active && active.result) {
                await db.rollbackTransaction();
              }
            } else {
              await db.rollbackTransaction();
            }
          } catch (e) {
            // Absorb rollback failure to ensure original error is rethrown
          }
        }
        throw err;
      } finally {
        transactionDepth = Math.max(0, transactionDepth - 1);
      }
    },

    async close() {
      adapterCache.delete(databaseName);
      transactionDepth = 0;
      try {
        if (typeof db.isTransactionActive === 'function') {
          const active = await db.isTransactionActive();
          if (active && active.result) {
            await db.rollbackTransaction();
          }
        }
      } catch (e) {}
      try {
        if (typeof db.isDBOpen === 'function') {
          const isOpen = (await db.isDBOpen()).result;
          if (isOpen) {
            await db.close();
          }
        } else if (typeof db.close === 'function') {
          await db.close();
        }
      } catch (e) {}
      try {
        if (sqlite && typeof sqlite.closeConnection === 'function') {
          await sqlite.closeConnection(databaseName, false);
        }
      } catch (e) {}
    },
  };

  return adapter;
}

/**
 * Creates an SQLite adapter using @capacitor-community/sqlite for Android/iOS runtime.
 * Implements { exec(sql, params), query(sql, params), transaction(fn) }.
 * Ensures connection is created only once and opening an existing connection does not fail.
 * 
 * @param {string} [databaseName='expense_tracker'] - SQLite database name.
 * @returns {Promise<object>} Database adapter.
 */
export async function createCapacitorSqliteAdapter(databaseName = 'expense_tracker') {
  if (adapterCache.has(databaseName)) {
    return adapterCache.get(databaseName);
  }

  const sqlite = getSqliteConnection();

  const ret = await sqlite.checkConnectionsConsistency();
  const isConn = (await sqlite.isConnection(databaseName, false)).result;

  let db;
  if (ret.result && isConn) {
    db = await sqlite.retrieveConnection(databaseName, false);
  } else {
    db = await sqlite.createConnection(databaseName, false, 'no-encryption', 1, false);
  }

  // Ensure database is only opened if not already open
  const isAlreadyOpen = (await db.isDBOpen()).result;
  if (!isAlreadyOpen) {
    await db.open();
  }

  const adapter = createSqliteAdapterFromDb(db, databaseName, sqlite);
  adapterCache.set(databaseName, adapter);
  return adapter;
}
