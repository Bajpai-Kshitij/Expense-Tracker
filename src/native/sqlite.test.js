import { describe, it, expect, beforeEach } from 'vitest';
import initSqlJs from 'sql.js';
import { createSqliteAdapterFromDb, clearSqliteAdapterCache } from './sqlite.js';
import { migrate } from '../core/db/migrations.js';

/**
 * Creates a mock DB connection behaving like @capacitor-community/sqlite:
 * - Records all calls in calls array.
 * - Throws "cannot start a transaction within a transaction" if a BEGIN happens while a transaction is active.
 * - Throws "cannot start a transaction within a transaction" if run or execute is invoked with transaction=true (or omitted) while a transaction is active.
 * - Backed by an in-memory sql.js instance to faithfully test table creation, queries, rollbacks, and migrations.
 */
async function createMockPluginConnection() {
  const SQL = await initSqlJs();
  const sqlDb = new SQL.Database();
  let isTxActive = false;
  const calls = [];

  const mockDb = {
    get calls() {
      return calls;
    },
    get isTxActive() {
      return isTxActive;
    },
    set isTxActive(val) {
      isTxActive = val;
    },

    async isDBOpen() {
      calls.push({ method: 'isDBOpen' });
      return { result: true };
    },

    async isTransactionActive() {
      calls.push({ method: 'isTransactionActive' });
      return { result: isTxActive };
    },

    async beginTransaction() {
      calls.push({ method: 'beginTransaction' });
      if (isTxActive) {
        throw new Error('Run: error code 1: cannot start a transaction within a transaction');
      }
      isTxActive = true;
      sqlDb.run('BEGIN TRANSACTION;');
      return { changes: 0 };
    },

    async commitTransaction() {
      calls.push({ method: 'commitTransaction' });
      if (!isTxActive) {
        throw new Error('cannot commit: no transaction active');
      }
      isTxActive = false;
      sqlDb.run('COMMIT;');
      return { changes: 0 };
    },

    async rollbackTransaction() {
      calls.push({ method: 'rollbackTransaction' });
      if (isTxActive) {
        isTxActive = false;
        sqlDb.run('ROLLBACK;');
      }
      return { changes: 0 };
    },

    async execute(statements, transaction = true) {
      calls.push({ method: 'execute', statements, transaction });
      if (isTxActive && transaction !== false) {
        throw new Error('Run: error code 1: cannot start a transaction within a transaction');
      }
      if (!isTxActive && transaction !== false) {
        sqlDb.run('BEGIN TRANSACTION;');
        try {
          sqlDb.exec(statements);
          sqlDb.run('COMMIT;');
        } catch (e) {
          sqlDb.run('ROLLBACK;');
          throw e;
        }
      } else {
        sqlDb.exec(statements);
      }
      return { changes: 0 };
    },

    async run(statement, values = [], transaction = true) {
      calls.push({ method: 'run', statement, values, transaction });
      if (isTxActive && transaction !== false) {
        throw new Error('Run: error code 1: cannot start a transaction within a transaction');
      }
      if (!isTxActive && transaction !== false) {
        sqlDb.run('BEGIN TRANSACTION;');
        try {
          sqlDb.run(statement, values);
          sqlDb.run('COMMIT;');
        } catch (e) {
          sqlDb.run('ROLLBACK;');
          throw e;
        }
      } else {
        sqlDb.run(statement, values);
      }
      return { changes: { changes: 1 } };
    },

    async query(statement, values = [], isSQL92 = true) {
      calls.push({ method: 'query', statement, values, isSQL92 });
      const stmt = sqlDb.prepare(statement);
      if (values && values.length > 0) {
        stmt.bind(values);
      }
      const rows = [];
      while (stmt.step()) {
        rows.push(stmt.getAsObject());
      }
      stmt.free();
      return { values: rows };
    },

    async close() {
      calls.push({ method: 'close' });
      sqlDb.close();
    },
  };

  return mockDb;
}

describe('Capacitor SQLite Adapter with mocked native plugin', () => {
  beforeEach(() => {
    clearSqliteAdapterCache();
  });

  it('proves mock plugin enforces transaction constraints', async () => {
    const mockDb = await createMockPluginConnection();
    await mockDb.beginTransaction();

    // Direct beginTransaction while active must throw
    await expect(mockDb.beginTransaction()).rejects.toThrow('cannot start a transaction within a transaction');

    // run or execute with transaction=true while active must throw
    await expect(mockDb.run('SELECT 1', [], true)).rejects.toThrow('cannot start a transaction within a transaction');
    await expect(mockDb.execute('SELECT 1', true)).rejects.toThrow('cannot start a transaction within a transaction');

    await mockDb.rollbackTransaction();
    await mockDb.close();
  });

  it('runs schema migrations without "cannot start a transaction within a transaction"', async () => {
    const mockDb = await createMockPluginConnection();
    const adapter = createSqliteAdapterFromDb(mockDb, 'test_migrations');

    const version = await migrate(adapter);
    expect(version).toBe(2);

    // Verify schema_version table exists and has rows for migrations
    const rows = await adapter.query('SELECT version FROM schema_version ORDER BY version ASC;');
    expect(rows).toEqual([{ version: 1 }, { version: 2 }]);

    // Verify expenses table was created
    const expensesRows = await adapter.query('SELECT * FROM expenses;');
    expect(expensesRows).toEqual([]);

    // Verify transaction calls: begin and commit were called
    const beginCalls = mockDb.calls.filter((c) => c.method === 'beginTransaction');
    const commitCalls = mockDb.calls.filter((c) => c.method === 'commitTransaction');
    expect(beginCalls.length).toBeGreaterThan(0);
    expect(commitCalls.length).toBe(beginCalls.length);

    // Verify all execute and run calls during the transaction had transaction === false
    const inTxExecCalls = mockDb.calls.filter(
      (c) => (c.method === 'execute' || c.method === 'run') && c.transaction === false
    );
    expect(inTxExecCalls.length).toBeGreaterThan(0);

    await adapter.close();
  });

  it('rolls back completely when a statement fails inside transaction', async () => {
    const mockDb = await createMockPluginConnection();
    const adapter = createSqliteAdapterFromDb(mockDb, 'test_rollback');

    await adapter.exec('CREATE TABLE test_items (id INT, name TEXT);');

    await expect(
      adapter.transaction(async (tx) => {
        await tx.exec('INSERT INTO test_items (id, name) VALUES (?, ?);', [1, 'first']);
        throw new Error('Simulated failure during transaction');
      })
    ).rejects.toThrow('Simulated failure during transaction');

    // Confirm rollbackTransaction was called
    const rollbackCalls = mockDb.calls.filter((c) => c.method === 'rollbackTransaction');
    expect(rollbackCalls.length).toBe(1);

    // Confirm table is empty (inserted item was rolled back)
    const items = await adapter.query('SELECT * FROM test_items;');
    expect(items).toEqual([]);

    await adapter.close();
  });

  it('joins nested transaction(fn) calls into outer transaction with depth counter', async () => {
    const mockDb = await createMockPluginConnection();
    const adapter = createSqliteAdapterFromDb(mockDb, 'test_nested');

    await adapter.exec('CREATE TABLE test_nested (val TEXT);');

    const result = await adapter.transaction(async (tx1) => {
      await tx1.exec('INSERT INTO test_nested (val) VALUES (?);', ['outer-1']);

      const innerResult = await tx1.transaction(async (tx2) => {
        await tx2.exec('INSERT INTO test_nested (val) VALUES (?);', ['inner']);
        return 'inner-ok';
      });

      await tx1.exec('INSERT INTO test_nested (val) VALUES (?);', ['outer-2']);
      return `outer-ok:${innerResult}`;
    });

    expect(result).toBe('outer-ok:inner-ok');

    // Only 1 beginTransaction and 1 commitTransaction should be recorded
    const beginCalls = mockDb.calls.filter((c) => c.method === 'beginTransaction');
    const commitCalls = mockDb.calls.filter((c) => c.method === 'commitTransaction');
    expect(beginCalls.length).toBe(1);
    expect(commitCalls.length).toBe(1);

    // All inserted values should be present
    const rows = await adapter.query('SELECT val FROM test_nested ORDER BY rowid ASC;');
    expect(rows).toEqual([
      { val: 'outer-1' },
      { val: 'inner' },
      { val: 'outer-2' },
    ]);

    await adapter.close();
  });

  it('recovers after an error and cleans up stale active transactions', async () => {
    const mockDb = await createMockPluginConnection();
    const adapter = createSqliteAdapterFromDb(mockDb, 'test_recover');

    await adapter.exec('CREATE TABLE test_recover (val TEXT);');

    // First transaction fails
    await expect(
      adapter.transaction(async (tx) => {
        await tx.exec('INSERT INTO test_recover (val) VALUES (?);', ['fail-val']);
        throw new Error('tx 1 exploded');
      })
    ).rejects.toThrow('tx 1 exploded');

    // Subsequent transaction succeeds cleanly
    await adapter.transaction(async (tx) => {
      await tx.exec('INSERT INTO test_recover (val) VALUES (?);', ['success-val']);
    });

    const rows1 = await adapter.query('SELECT val FROM test_recover;');
    expect(rows1).toEqual([{ val: 'success-val' }]);

    // Simulate stale uncommitted transaction left by a crashed previous operation
    mockDb.isTxActive = true;

    // Starting a new transaction rolls back the stale transaction before starting a new one
    await adapter.transaction(async (tx) => {
      await tx.exec('INSERT INTO test_recover (val) VALUES (?);', ['after-stale']);
    });

    const rows2 = await adapter.query('SELECT val FROM test_recover ORDER BY rowid ASC;');
    expect(rows2).toEqual([
      { val: 'success-val' },
      { val: 'after-stale' },
    ]);

    await adapter.close();
  });

  it('uses plugin default for single statement outside transaction', async () => {
    const mockDb = await createMockPluginConnection();
    const adapter = createSqliteAdapterFromDb(mockDb, 'test_outside');

    await adapter.exec('CREATE TABLE single_stmt (num INT);');
    await adapter.exec('INSERT INTO single_stmt (num) VALUES (?);', [42]);

    const execCall = mockDb.calls.find((c) => c.method === 'run' && c.statement.includes('INSERT INTO single_stmt'));
    expect(execCall).toBeDefined();
    // Outside transaction, transaction flag was not forced to false
    expect(execCall.transaction).not.toBe(false);

    await adapter.close();
  });
});

