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

  const adapter = {
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

    async transaction(fn) {
      db.run('BEGIN TRANSACTION;');
      try {
        const result = await fn(adapter);
        db.run('COMMIT;');
        return result;
      } catch (err) {
        db.run('ROLLBACK;');
        throw err;
      }
    },

    export() {
      return db.export();
    },

    close() {
      db.close();
    },
  };

  return adapter;
}

