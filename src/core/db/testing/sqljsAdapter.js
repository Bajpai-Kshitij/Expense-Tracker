import initSqlJs from 'sql.js';

/**
 * Creates an in-memory SQLite adapter powered by sql.js for Node unit tests.
 * Implements { exec(sql, params), query(sql, params), transaction(fn) }.
 * 
 * @returns {Promise<object>} Database adapter.
 */
export async function createSqljsAdapter() {
  const SQL = await initSqlJs();
  const db = new SQL.Database();

  // Same rule as the Capacitor adapter: top-level operations run one at a time.
  let queue = Promise.resolve();
  const enqueue = (op) => {
    const run = queue.then(op, op);
    queue = run.catch(() => {});
    return run;
  };

  const handle = {
    async exec(sql, params = []) {
      if (!params || params.length === 0) {
        db.run(sql);
      } else {
        db.run(sql, params);
      }
    },

    async query(sql, params = []) {
      const stmt = db.prepare(sql);
      if (params && params.length > 0) {
        stmt.bind(params);
      }
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return rows;
    },

    transaction: (fn) => fn(handle),
  };

  const adapter = {
    exec: (sql, params) => enqueue(() => handle.exec(sql, params)),
    query: (sql, params) => enqueue(() => handle.query(sql, params)),
    transaction: (fn) =>
      enqueue(async () => {
        db.run('BEGIN TRANSACTION;');
        try {
          const result = await fn(handle);
          db.run('COMMIT;');
          return result;
        } catch (err) {
          db.run('ROLLBACK;');
          throw err;
        }
      }),

    export() {
      return db.export();
    },

    close() {
      db.close();
    },
  };

  return adapter;
}

