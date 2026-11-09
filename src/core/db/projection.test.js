import { describe, it, expect } from 'vitest';
import { createSqljsAdapter } from './testing/sqljsAdapter.js';
import { createMemoryStorage } from '../sync/testing/memoryStorage.js';
import { createWriter } from '../sync/writer.js';
import { syncNow, rebuildFromLogs, upgradeProjectionIfNeeded } from '../sync/engine.js';
import { migrate, rowsToState, loadStateFromDb, getExpenseExtras } from './index.js';
import { markReviewResolved } from './reviewQueue.js';

const exp = (id, extra = {}) => ({ expenseId: id, amountPaise: 100, date: '2026-11-01', direction: 'debit', kind: 'spend', source: 'manual', ...extra });
async function setup() {
  const db = await createSqljsAdapter();
  await migrate(db);
  const storage = createMemoryStorage();
  const writer = createWriter({ deviceId: 'dev-a', storage, db });
  await writer.init();
  return { db, storage, writer };
}
const addOpenReview = (db, id, type = 'unparsed') =>
  db.exec('INSERT INTO review_queue (id, type, payload, status) VALUES (?, ?, ?, ?);', [id, type, JSON.stringify({ id, reviewId: id, type, status: 'open' }), 'open']);

describe('read model keeps every expense field', () => {
  it('stores EMI fields in their columns', async () => {
    const { db, writer } = await setup();
    await writer.write('expense.created', exp('e1', { kind: 'fixed', emiPlanKey: 'emi:x', emiNo: 6, emiTotal: 9, emiPart: 'interest', emiMonthlyPaise: 5, emiFinishDate: '2027-01-11', emiOutstandingPaise: 7, bankCategory: 'Food' }));
    const [row] = await db.query("SELECT * FROM expenses WHERE id='e1';");
    expect(row).toMatchObject({ emi_plan_key: 'emi:x', emi_no: 6, emi_total: 9, emi_part: 'interest', emi_monthly_paise: 5, emi_finish_date: '2027-01-11', emi_outstanding_paise: 7, bank_category: 'Food' });
  });

  it('keeps EMI and unknown fields after later writes rehydrate the state', async () => {
    const { db, writer } = await setup();
    await writer.write('expense.created', exp('e1', { emiPlanKey: 'emi:x', rawHash: 'abc', refundOf: 'e0', futureField: 1 }));
    await writer.write('expense.created', exp('e2'));
    const state = await loadStateFromDb(db);
    expect(state.expenses.e1).toMatchObject({ emiPlanKey: 'emi:x', rawHash: 'abc', refundOf: 'e0', futureField: 1 });
    const [row] = await db.query("SELECT * FROM expenses WHERE id='e1';");
    expect(getExpenseExtras(row).rawHash).toBe('abc');
  });
});

describe('writes touch only what changed', () => {
  it('uses a small, constant number of statements regardless of history', async () => {
    const { db, writer } = await setup();
    await writer.writeMany(Array.from({ length: 300 }, (_, i) => ({ type: 'expense.created', data: exp(`e${i}`) })));
    let execs = 0;
    const original = db.exec;
    db.exec = (...a) => { execs += 1; return original(...a); };
    await writer.write('expense.created', exp('one-more'));
    db.exec = original;
    expect(execs).toBeLessThan(10);
    expect((await db.query('SELECT count(*) c FROM expenses;'))[0].c).toBe(301);
  });

  it('does not reopen a review item resolved only locally', async () => {
    const { db, writer } = await setup();
    await addOpenReview(db, 'rv_1');
    await markReviewResolved(db, 'rv_1');
    await writer.write('expense.created', exp('e1'));
    expect((await db.query("SELECT status FROM review_queue WHERE id='rv_1';"))[0].status).toBe('resolved');
  });
});

describe('rebuild safety', () => {
  it('keeps open review items, which live only on this phone', async () => {
    const { db, storage, writer } = await setup();
    await writer.write('expense.created', exp('e1'));
    await addOpenReview(db, 'rv_open');
    await rebuildFromLogs({ storage, db });
    expect((await db.query("SELECT status FROM review_queue WHERE id='rv_open';"))[0].status).toBe('open');
  });

  it('refuses to wipe local data when the folder has no events', async () => {
    const { db, writer } = await setup();
    await writer.write('expense.created', exp('e1'));
    await expect(rebuildFromLogs({ storage: createMemoryStorage(), db })).rejects.toThrow(/no events/i);
    expect((await db.query('SELECT count(*) c FROM expenses;'))[0].c).toBe(1);
  });

  it('upgrades an old read model once', async () => {
    const { db, storage, writer } = await setup();
    await writer.write('expense.created', exp('e1', { rawHash: 'abc' }));
    await db.exec("UPDATE expenses SET extras = NULL WHERE id='e1';");
    expect(await upgradeProjectionIfNeeded({ storage, db })).toBe(true);
    expect(getExpenseExtras((await db.query("SELECT * FROM expenses WHERE id='e1';"))[0]).rawHash).toBe('abc');
    expect(await upgradeProjectionIfNeeded({ storage, db })).toBe(false);
  });
});

describe('import state', () => {
  it('includes keys linked to an expense', async () => {
    const { db, writer } = await setup();
    await writer.write('expense.created', exp('e1'));
    await writer.write('expense.linked', { expenseId: 'e1', key: 'ref:999' });
    expect((await loadStateFromDb(db)).expenses.e1.linkedKeys.has('ref:999')).toBe(true);
    expect(rowsToState({}).expenses).toEqual({});
  });
});
