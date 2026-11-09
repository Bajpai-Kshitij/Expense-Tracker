import { describe, it, expect } from 'vitest';
import { createSqljsAdapter } from '../db/testing/sqljsAdapter.js';
import { createSqliteAdapterFromDb } from '../../native/sqlite.js';
import { createMemoryStorage } from './testing/memoryStorage.js';
import { createWriter } from './writer.js';
import { ensureDevice } from './device.js';
import { syncNow, rebuildFromLogs } from './engine.js';
import { migrate } from '../db/index.js';
import { seedIfEmpty, SEED_CATEGORIES } from '../seed/seed.js';

async function fresh() { const db = await createSqljsAdapter(); await migrate(db); return db; }
const T = (h) => Date.parse(`2026-11-01T${h}:00:00Z`);
const exp = (id) => ({ expenseId: id, amountPaise: 100, date: '2026-11-01', direction: 'debit', kind: 'spend', source: 'manual' });
const nameOf = async (db, id) => (await db.query('SELECT name FROM categories WHERE id = ?;', [id]))[0]?.name;

describe('two phones converge', () => {
  it('a late older category edit does not beat a newer one', async () => {
    const storage = createMemoryStorage();
    const db = await fresh();
    const A = createWriter({ deviceId: 'dev-a', storage, db, now: () => T('12') });
    const B = createWriter({ deviceId: 'dev-b', storage, now: () => T('10') });
    await A.init(); await B.init();
    await A.write('category.upserted', { id: 'cat_x', name: 'NEWER' });
    await B.write('category.upserted', { id: 'cat_x', name: 'OLDER' });
    await syncNow({ storage, db, deviceId: 'dev-a' });
    expect(await nameOf(db, 'cat_x')).toBe('NEWER');
  });

  it('a late older rule edit does not bring back a deleted rule', async () => {
    const storage = createMemoryStorage();
    const db = await fresh();
    const A = createWriter({ deviceId: 'dev-a', storage, db, now: () => T('12') });
    const B = createWriter({ deviceId: 'dev-b', storage, now: () => T('10') });
    await A.init(); await B.init();
    await A.write('rule.upserted', { id: 'r1', pattern: 'X', categoryId: 'cat_x', active: true });
    await A.write('rule.deleted', { id: 'r1' });
    await B.write('rule.upserted', { id: 'r1', pattern: 'OLD', categoryId: 'cat_x', active: true });
    await syncNow({ storage, db, deviceId: 'dev-a' });
    const [row] = await db.query("SELECT extras FROM rules WHERE id='r1';");
    expect(row === undefined || JSON.parse(row.extras).active === false).toBe(true);
  });

  it('a second phone seeding late does not undo a rename', async () => {
    const sA = createMemoryStorage();
    const dbA = await fresh();
    let now = T('10');
    const A = createWriter({ deviceId: 'dev-a', storage: sA, db: dbA, now: () => now });
    await A.init();
    await seedIfEmpty({ writer: A, db: dbA });
    now = T('11');
    await A.write('category.upserted', { id: 'cat_food', name: 'Dining Out', icon: 'x', color: '#000' });
    const sB = createMemoryStorage();
    const dbB = await fresh();
    const B = createWriter({ deviceId: 'dev-b', storage: sB, db: dbB, now: () => T('12') });
    await B.init();
    await seedIfEmpty({ writer: B, db: dbB });
    await sA.writeFile('events-dev-b.jsonl', await sB.readFile('events-dev-b.jsonl'));
    await sB.writeFile('events-dev-a.jsonl', await sA.readFile('events-dev-a.jsonl'));
    await syncNow({ storage: sA, db: dbA, deviceId: 'dev-a' });
    await syncNow({ storage: sB, db: dbB, deviceId: 'dev-b' });
    expect(await nameOf(dbA, 'cat_food')).toBe('Dining Out');
    expect(await nameOf(dbB, 'cat_food')).toBe('Dining Out');
    await rebuildFromLogs({ storage: sA, db: dbA });
    expect(await nameOf(dbA, 'cat_food')).toBe('Dining Out');
  });

  it('adds Fees and Taxes to an install seeded before it existed, once', async () => {
    const db = await fresh();
    const storage = createMemoryStorage();
    const w = createWriter({ deviceId: 'dev-a', storage, db });
    await w.init();
    await db.exec("INSERT INTO settings (key, value) VALUES ('seeded', '1');");
    expect((await seedIfEmpty({ writer: w, db })).writtenCount).toBe(1);
    expect(await nameOf(db, 'cat_fees')).toBe('Fees and Taxes');
    expect((await seedIfEmpty({ writer: w, db })).writtenCount).toBe(0);
    expect(SEED_CATEGORIES.some((c) => c.id === 'cat_fees')).toBe(true);
  });

  it('keeps the label chosen in onboarding', async () => {
    const db = await fresh();
    const storage = createMemoryStorage();
    await db.exec("INSERT INTO settings (key, value) VALUES ('deviceLabel', 'Wife');");
    const dev = await ensureDevice({ db, storage });
    expect(dev.label).toBe('Wife');
    expect(JSON.parse(await storage.readFile(`device-${dev.deviceId}.json`)).label).toBe('Wife');
  });
});

describe('saving during a sync, through the real Capacitor adapter', () => {
  const tick = () => new Promise((r) => setTimeout(r, 0));
  async function realAdapter() {
    const raw = await createSqljsAdapter();
    let active = false;
    const conn = {
      run: async (s, p) => { await tick(); await raw.exec(s, p); },
      execute: async (s) => { await tick(); await raw.exec(s); },
      query: async (s, p) => { await tick(); return { values: await raw.query(s, p) }; },
      beginTransaction: async () => { await tick(); await raw.exec('BEGIN;'); active = true; },
      commitTransaction: async () => { await tick(); await raw.exec('COMMIT;'); active = false; },
      rollbackTransaction: async () => { await tick(); await raw.exec('ROLLBACK;'); active = false; },
      isTransactionActive: async () => ({ result: active }),
    };
    const a = createSqliteAdapterFromDb(conn, `t${Math.random()}`);
    await migrate(a);
    return a;
  }

  it('never loses an expense or reports a false failure', async () => {
    for (let trial = 0; trial < 8; trial += 1) {
      const storage = createMemoryStorage();
      const db = await realAdapter();
      const A = createWriter({ deviceId: 'dev-a', storage, db });
      await A.init();
      for (let i = 0; i < 10; i += 1) await A.write('expense.created', exp(`old${i}`));
      const B = createWriter({ deviceId: 'dev-b', storage });
      await B.init();
      await B.write('expense.created', exp('other'));
      const sync = syncNow({ storage, db, deviceId: 'dev-a' });
      await new Promise((r) => setTimeout(r, trial * 6));
      await Promise.all([sync, A.write('expense.created', exp('mine'))]);
      const ids = (await db.query('SELECT id FROM expenses;')).map((r) => r.id);
      expect(ids).toContain('mine');
      expect(ids).toContain('other');
    }
  }, 60000);

  it('an unrelated transaction waits instead of joining the running one', async () => {
    const db = await realAdapter();
    const order = [];
    let release;
    const gate = new Promise((r) => { release = r; });
    const first = db.transaction(async (tx) => {
      await tx.exec("INSERT INTO settings (key, value) VALUES ('a', '1');");
      order.push('first-started');
      await gate;
      order.push('first-done');
    });
    const second = db.transaction(async () => { order.push('second'); });
    await tick(); await tick(); await tick(); await tick(); await tick();
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first-started', 'first-done', 'second']);
  });
});
