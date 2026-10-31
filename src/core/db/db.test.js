import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { createSqljsAdapter } from './testing/sqljsAdapter.js';
import {
  migrate,
  stateToRows,
  rowsToState,
  rebuildFromEvents,
  applyEventsToDb,
  dumpDatabase,
  listExpenses,
  totals,
  totalsByCategory,
  totalsByMonth,
  uncategorizedInbox,
  rawMessages,
  settings,
  syncState,
} from './index.js';
import { createEvent, createEmptyState, applyEvents as applyReducerEvents } from '../events/index.js';

describe('PHASE P2 - SQLite Read Model', () => {
  let db;

  beforeEach(async () => {
    db = await createSqljsAdapter();
  });

  describe('Migrations', () => {
    it('Migrations create the schema from empty; running them twice is safe', async () => {
      // 1. Run migrations on fresh database
      const ver1 = await migrate(db);
      expect(ver1).toBe(1);

      // Verify tables exist by inserting test rows
      await db.exec("INSERT INTO settings (key, value) VALUES ('test_key', 'test_val');");
      const setting = await settings.getSetting(db, 'test_key');
      expect(setting).toBe('test_val');

      // 2. Run migrations second time (idempotent / no-op)
      const ver2 = await migrate(db);
      expect(ver2).toBe(1);

      // Verify existing data remains untouched
      const settingAfter = await settings.getSetting(db, 'test_key');
      expect(settingAfter).toBe('test_val');
    });
  });

  describe('State to rows mapping', () => {
    it('stateToRows then rowsToState round-trips the state exactly', () => {
      const e1 = createEvent({
        id: 'ev_1',
        type: 'expense.created',
        dev: 'dev-1',
        seq: 1,
        ts: '2026-10-30T10:00:00.000Z',
        data: {
          expenseId: 'e_101',
          amountPaise: 45000,
          date: '2026-10-30',
          direction: 'debit',
          kind: 'spend',
          merchantRaw: 'UBER TRIP 442',
          brand: 'Uber',
          categoryId: 'cat_transport',
          accountId: 'acc_hdfc',
          mode: 'card',
          source: 'sms',
          refNo: 'REF123',
          dedupeKey: 'dedupe:uber:45000',
          note: 'ride home',
        },
      });

      const e2 = createEvent({
        id: 'ev_2',
        type: 'category.upserted',
        dev: 'dev-1',
        seq: 2,
        ts: '2026-10-30T10:01:00.000Z',
        data: { categoryId: 'cat_transport', name: 'Transport', icon: 'car', color: '#ff0000' },
      });

      const e3 = createEvent({
        id: 'ev_3',
        type: 'brand.upserted',
        dev: 'dev-1',
        seq: 3,
        ts: '2026-10-30T10:02:00.000Z',
        data: { brandId: 'brand_uber', name: 'Uber', defaultCategoryId: 'cat_transport' },
      });

      const e4 = createEvent({
        id: 'ev_4',
        type: 'account.upserted',
        dev: 'dev-1',
        seq: 4,
        ts: '2026-10-30T10:03:00.000Z',
        data: { accountId: 'acc_hdfc', name: 'HDFC Regalia', type: 'credit_card' },
      });

      const originalState = applyReducerEvents(createEmptyState(), [e1, e2, e3, e4]);

      // Add a parked event to test pending_events roundtrip
      const orphanUpdate = createEvent({
        id: 'ev_orphan',
        type: 'expense.updated',
        dev: 'dev-2',
        seq: 1,
        ts: '2026-10-30T10:05:00.000Z',
        data: { expenseId: 'e_unknown', patch: { note: 'parked' } },
      });
      const stateWithParked = applyReducerEvents(originalState, [orphanUpdate]);

      const rows = stateToRows(stateWithParked);
      const hydratedState = rowsToState(rows);

      // Assert full round-trip equality
      expect(hydratedState.expenses).toEqual(stateWithParked.expenses);
      expect(hydratedState.categories).toEqual(stateWithParked.categories);
      expect(hydratedState.brands).toEqual(stateWithParked.brands);
      expect(hydratedState.accounts).toEqual(stateWithParked.accounts);
      expect(hydratedState.appliedEventIds).toEqual(stateWithParked.appliedEventIds);
      expect(hydratedState.parkedEvents).toEqual(stateWithParked.parkedEvents);
    });
  });

  describe('Rebuild and Apply determinism', () => {
    let testEvents;

    beforeEach(async () => {
      await migrate(db);

      testEvents = [
        createEvent({
          id: 'ev_init_1',
          type: 'expense.created',
          dev: 'dev-1',
          seq: 1,
          ts: '2026-10-30T10:00:00.000Z',
          data: {
            expenseId: 'e_001',
            amountPaise: 125000,
            date: '2026-10-30',
            direction: 'debit',
            kind: 'spend',
            merchantRaw: 'SWIGGY',
            brand: 'Swiggy',
            categoryId: 'cat_food',
            note: 'lunch',
          },
        }),
        createEvent({
          id: 'ev_init_2',
          type: 'category.upserted',
          dev: 'dev-1',
          seq: 2,
          ts: '2026-10-30T10:01:00.000Z',
          data: { categoryId: 'cat_food', name: 'Food & Dining' },
        }),
        createEvent({
          id: 'ev_init_3',
          type: 'expense.updated',
          dev: 'dev-2',
          seq: 1,
          ts: '2026-10-30T10:05:00.000Z',
          data: { expenseId: 'e_001', patch: { note: 'team lunch' } },
        }),
        createEvent({
          id: 'ev_init_4',
          type: 'expense.created',
          dev: 'dev-2',
          seq: 2,
          ts: '2026-10-30T10:10:00.000Z',
          data: {
            expenseId: 'e_002',
            amountPaise: 49900,
            date: '2026-10-30',
            direction: 'credit',
            kind: 'spend',
            merchantRaw: 'SWIGGY REFUND',
            brand: 'Swiggy',
            categoryId: 'cat_food',
            note: 'refund',
          },
        }),
      ];
    });

    it('rebuildFromEvents twice produces an identical database dump', async () => {
      await rebuildFromEvents(db, testEvents);
      const dump1 = await dumpDatabase(db);
      const bytes1 = db.export();

      await rebuildFromEvents(db, testEvents);
      const dump2 = await dumpDatabase(db);
      const bytes2 = db.export();

      expect(dump1).toEqual(dump2);
      expect(bytes1).toEqual(bytes2);
    });

    it('rebuildFromEvents on a shuffled copy of the same events produces an identical dump', async () => {
      await rebuildFromEvents(db, testEvents);
      const dumpOriginal = await dumpDatabase(db);
      const bytesOriginal = db.export();

      // Shuffled order: [e4, e1, e3, e2]
      const shuffled = [testEvents[3], testEvents[0], testEvents[2], testEvents[1]];

      const dbShuffled = await createSqljsAdapter();
      await migrate(dbShuffled);
      await rebuildFromEvents(dbShuffled, shuffled);
      const dumpShuffled = await dumpDatabase(dbShuffled);
      const bytesShuffled = dbShuffled.export();

      expect(dumpShuffled).toEqual(dumpOriginal);
      expect(bytesShuffled).toEqual(bytesOriginal);
    });

    it('applyEvents in two batches gives the same dump as rebuildFromEvents on all events', async () => {
      // Direct rebuild with all events
      await rebuildFromEvents(db, testEvents);
      const expectedDump = await dumpDatabase(db);
      const expectedBytes = db.export();

      // Incremental apply in two separate batches on a fresh DB
      const dbBatched = await createSqljsAdapter();
      await migrate(dbBatched);

      const batch1 = [testEvents[0], testEvents[1]];
      const batch2 = [testEvents[2], testEvents[3]];

      await applyEventsToDb(dbBatched, batch1);
      await applyEventsToDb(dbBatched, batch2);

      const actualDump = await dumpDatabase(dbBatched);
      const actualBytes = dbBatched.export();

      expect(actualDump).toEqual(expectedDump);
      expect(actualBytes).toEqual(expectedBytes);
    });

    it('A parked event survives a rebuild and applies once its create arrives', async () => {
      const orphanUpdate = createEvent({
        id: 'ev_orphan_up',
        type: 'expense.updated',
        dev: 'dev-1',
        seq: 10,
        ts: '2026-10-30T10:20:00.000Z',
        data: { expenseId: 'e_pending_target', patch: { note: 'patched note' } },
      });

      // Apply orphan update first -> parked in pending_events
      await applyEventsToDb(db, [orphanUpdate]);
      const pendingBefore = await db.query('SELECT * FROM pending_events;');
      expect(pendingBefore).toHaveLength(1);
      expect(pendingBefore[0].id).toBe('ev_orphan_up');

      // Rebuild with orphan update -> stays parked in pending_events
      await rebuildFromEvents(db, [orphanUpdate]);
      const pendingAfterRebuild = await db.query('SELECT * FROM pending_events;');
      expect(pendingAfterRebuild).toHaveLength(1);

      // Now create event arrives
      const targetCreate = createEvent({
        id: 'ev_target_create',
        type: 'expense.created',
        dev: 'dev-2',
        seq: 1,
        ts: '2026-10-30T10:15:00.000Z',
        data: {
          expenseId: 'e_pending_target',
          amountPaise: 75000,
          date: '2026-10-30',
          direction: 'debit',
          kind: 'spend',
          note: 'original note',
        },
      });

      // Apply targetCreate -> resolves the parked update!
      await applyEventsToDb(db, [targetCreate]);

      // pending_events is now empty
      const pendingFinal = await db.query('SELECT * FROM pending_events;');
      expect(pendingFinal).toHaveLength(0);

      // The expense exists and has the patched note applied
      const expenses = await db.query('SELECT * FROM expenses WHERE id = ?;', ['e_pending_target']);
      expect(expenses).toHaveLength(1);
      expect(expenses[0].amount_paise).toBe(75000);
      expect(expenses[0].note).toBe('patched note');
    });
  });

  describe('Queries & Totals calculations', () => {
    beforeEach(async () => {
      await migrate(db);

      // Setup representative test dataset:
      // 1. spend debit 1000
      // 2. credit refund 200
      // 3. transfer 5000 (excluded from totals)
      // 4. income 100000 (excluded from totals)
      // 5. deleted spend 400 (excluded from totals)
      // 6. fixed expense 3000 (excluded unless includeFixed: true)
      await db.exec(`
        INSERT INTO expenses (id, amount_paise, date, txn_ts, direction, kind, merchant_raw, brand, category_id, status)
        VALUES
          ('e_spend_1', 1000, '2026-10-15', '2026-10-15T10:00:00Z', 'debit', 'spend', 'Coffee Shop', 'Coffee', 'cat_food', 'active'),
          ('e_refund_1', 200, '2026-10-16', '2026-10-16T11:00:00Z', 'credit', 'spend', 'Coffee Refund', 'Coffee', 'cat_food', 'active'),
          ('e_transfer_1', 5000, '2026-10-17', '2026-10-17T12:00:00Z', 'debit', 'transfer', 'Bank Transfer', NULL, NULL, 'active'),
          ('e_income_1', 100000, '2026-10-18', '2026-10-18T13:00:00Z', 'credit', 'income', 'Salary', 'Employer', NULL, 'active'),
          ('e_deleted_1', 400, '2026-10-19', '2026-10-19T14:00:00Z', 'debit', 'spend', 'Deleted Snack', 'Snack', 'cat_food', 'deleted'),
          ('e_fixed_1', 3000, '2026-10-20', '2026-10-20T15:00:00Z', 'debit', 'fixed', 'Electricity Bill', 'PowerCorp', 'cat_utility', 'active');
      `);
    });

    it('totals: spend 1000 + credit refund 200 = net 800; a transfer, an income row and a deleted row are excluded; a fixed row is excluded unless includeFixed', async () => {
      // 1. Standard totals (includeFixed = false)
      const res = await totals(db);
      expect(res.spendPaise).toBe(1000);
      expect(res.refundPaise).toBe(200);
      expect(res.netPaise).toBe(800);
      expect(res.count).toBe(2);

      // 2. With includeFixed = true
      const resFixed = await totals(db, { includeFixed: true });
      expect(resFixed.spendPaise).toBe(4000); // 1000 + 3000
      expect(resFixed.refundPaise).toBe(200);
      expect(resFixed.netPaise).toBe(3800);
      expect(resFixed.count).toBe(3);
    });

    it('Filters: date range, category, uncategorizedOnly, text search, and combinations', async () => {
      // Date range filter
      const dateFiltered = await listExpenses(db, { from: '2026-10-16', to: '2026-10-17' });
      const idsDate = dateFiltered.map((e) => e.id);
      expect(idsDate).toEqual(['e_transfer_1', 'e_refund_1']);

      // Category filter
      const catFiltered = await listExpenses(db, { categoryId: 'cat_food' });
      expect(catFiltered.map((e) => e.id)).toEqual(['e_refund_1', 'e_spend_1']);

      // Uncategorized filter
      const uncatFiltered = await listExpenses(db, { uncategorizedOnly: true });
      expect(uncatFiltered.map((e) => e.id)).toEqual(['e_income_1', 'e_transfer_1']);

      // Text search
      const textFiltered = await listExpenses(db, { text: 'Coffee' });
      expect(textFiltered.map((e) => e.id)).toEqual(['e_refund_1', 'e_spend_1']);

      // Combination filter: date + category
      const comboFiltered = await listExpenses(db, { from: '2026-10-16', categoryId: 'cat_food' });
      expect(comboFiltered.map((e) => e.id)).toEqual(['e_refund_1']);

      // Deleted filter
      const withDeleted = await listExpenses(db, { includeDeleted: true, categoryId: 'cat_food' });
      expect(withDeleted.map((e) => e.id)).toEqual(['e_deleted_1', 'e_refund_1', 'e_spend_1']);
    });

    it('uncategorizedInbox: kind spend or fixed, category_id NULL, active, newest first', async () => {
      // Add an uncategorized spend and fixed expense
      await db.exec(`
        INSERT INTO expenses (id, amount_paise, date, txn_ts, direction, kind, merchant_raw, category_id, status)
        VALUES
          ('e_uncat_spend', 250, '2026-10-21', '2026-10-21T10:00:00Z', 'debit', 'spend', 'Corner Store', NULL, 'active'),
          ('e_uncat_fixed', 1500, '2026-10-22', '2026-10-22T10:00:00Z', 'debit', 'fixed', 'Water Bill', NULL, 'active');
      `);

      const inbox = await uncategorizedInbox(db);
      expect(inbox.map((e) => e.id)).toEqual(['e_uncat_fixed', 'e_uncat_spend']);
    });

    it('totalsByCategory and totalsByMonth aggregate correctly', async () => {
      const byCat = await totalsByCategory(db);
      expect(byCat).toHaveLength(1);
      expect(byCat[0].categoryId).toBe('cat_food');
      expect(byCat[0].netPaise).toBe(800);

      const byMonth = await totalsByMonth(db);
      expect(byMonth).toHaveLength(1);
      expect(byMonth[0].month).toBe('2026-10');
      expect(byMonth[0].netPaise).toBe(800);
    });

    it('purgeRawOlderThan deletes only rows older than the cutoff and leaves expenses untouched', async () => {
      const now = new Date('2026-10-31T12:00:00.000Z');

      // 70 days ago (older than 60)
      const oldDate = new Date('2026-08-20T10:00:00.000Z').toISOString();
      // 10 days ago (newer than 60)
      const recentDate = new Date('2026-10-21T10:00:00.000Z').toISOString();

      await rawMessages.insertRaw(db, {
        hash: 'hash_old',
        kind: 'sms',
        body: 'Debited 100 on card',
        receivedAt: oldDate,
        parsed: { amountPaise: 10000 },
      });

      await rawMessages.insertRaw(db, {
        hash: 'hash_recent',
        kind: 'sms',
        body: 'Debited 200 on card',
        receivedAt: recentDate,
        parsed: { amountPaise: 20000 },
      });

      expect(await rawMessages.existsRawHash(db, 'hash_old')).toBe(true);
      expect(await rawMessages.existsRawHash(db, 'hash_recent')).toBe(true);

      const expensesBeforeCount = (await db.query('SELECT COUNT(*) as c FROM expenses;'))[0].c;

      // Purge rows older than 60 days
      await rawMessages.purgeRawOlderThan(db, 60, now);

      expect(await rawMessages.existsRawHash(db, 'hash_old')).toBe(false);
      expect(await rawMessages.existsRawHash(db, 'hash_recent')).toBe(true);

      // Verify expenses table is completely untouched
      const expensesAfterCount = (await db.query('SELECT COUNT(*) as c FROM expenses;'))[0].c;
      expect(expensesAfterCount).toBe(expensesBeforeCount);
    });

    it('syncState and settings get/set work properly', async () => {
      expect(await syncState.getSyncState(db, 'events-dev-1.jsonl')).toBe(0);
      await syncState.setSyncState(db, 'events-dev-1.jsonl', 42);
      expect(await syncState.getSyncState(db, 'events-dev-1.jsonl')).toBe(42);

      expect(await settings.getSetting(db, 'theme')).toBeNull();
      await settings.setSetting(db, 'theme', 'dark');
      expect(await settings.getSetting(db, 'theme')).toBe('dark');
    });
  });

  describe('Isolation check', () => {
    it('nothing in src/core imports Capacitor (only src/native/sqlite.js may)', () => {
      const coreDir = resolve(process.cwd(), 'src/core');

      function scanDir(dir) {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = resolve(dir, entry.name);
          if (entry.isDirectory()) {
            scanDir(fullPath);
          } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
            const content = readFileSync(fullPath, 'utf8');
            expect(content).not.toMatch(/from\s+['"]@capacitor/);
            expect(content).not.toMatch(/from\s+['"]@capacitor-community\/sqlite/);
            expect(content).not.toMatch(/import\s+.*['"]@capacitor/);
          }
        }
      }

      scanDir(coreDir);
    });
  });
});

