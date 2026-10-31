import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { createMemoryStorage } from './testing/memoryStorage.js';
import { ensureDevice } from './device.js';
import { createWriter } from './writer.js';
import { readAllEvents } from './reader.js';
import { syncNow, rebuildFromLogs } from './engine.js';

import { createSqljsAdapter } from '../db/testing/sqljsAdapter.js';
import { migrate, dumpDatabase, listExpenses, settings, syncState } from '../db/index.js';
import {
  createEvent,
  serializeEvent,
  expenseIdFromDedupeKey,
  canonicalJson,
} from '../events/index.js';
import { calculateEventCrc } from '../events/crc32.js';

describe('PHASE P4 - Sync Engine', () => {
  let storage;

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  describe('Device Bootstrap (ensureDevice)', () => {
    it('creates deviceId and deviceLabel in settings and writes device-<id>.json; idempotent on later runs', async () => {
      const db = await createSqljsAdapter();
      await migrate(db);

      // 1. First run: provisions device
      const dev1 = await ensureDevice({ db, storage, label: 'Pixel 9 Pro' });
      expect(dev1.deviceId).toMatch(/^dev-[0-9a-z]{6}$/);
      expect(dev1.label).toBe('Pixel 9 Pro');

      // Check DB settings
      const storedId = await settings.getSetting(db, 'deviceId');
      const storedLabel = await settings.getSetting(db, 'deviceLabel');
      expect(storedId).toBe(dev1.deviceId);
      expect(storedLabel).toBe('Pixel 9 Pro');

      // Check device-<id>.json file
      const fileContent = await storage.readFile(`device-${dev1.deviceId}.json`);
      expect(fileContent).not.toBeNull();
      const meta = JSON.parse(fileContent);
      expect(meta.deviceId).toBe(dev1.deviceId);
      expect(meta.label).toBe('Pixel 9 Pro');
      expect(meta.createdAt).toBeDefined();

      // 2. Second run: returns existing device info without modifying
      const dev2 = await ensureDevice({ db, storage, label: 'Different Name' });
      expect(dev2.deviceId).toBe(dev1.deviceId);
      expect(dev2.label).toBe('Pixel 9 Pro');
    });
  });

  describe('Sync Scenarios', () => {
    it('Two simulated devices A and B, each with its own database and the SAME shared storage. A writes 3 events, B writes 2 events, both sync: their dumpDatabase output is identical.', async () => {
      const dbA = await createSqljsAdapter();
      await migrate(dbA);
      const dbB = await createSqljsAdapter();
      await migrate(dbB);

      const devA = await ensureDevice({ db: dbA, storage, label: 'Device A' });
      const devB = await ensureDevice({ db: dbB, storage, label: 'Device B' });

      const writerA = createWriter({ deviceId: devA.deviceId, storage, db: dbA });
      const writerB = createWriter({ deviceId: devB.deviceId, storage, db: dbB });

      // Dev A writes 3 events
      await writerA.write('expense.created', {
        expenseId: 'e_a1',
        amount_paise: 15000,
        date: '2026-10-31',
        txn_ts: '2026-10-31T10:00:00+05:30',
        direction: 'debit',
        kind: 'spend',
        merchant_raw: 'Store A1',
        status: 'active',
      });
      await writerA.write('category.upserted', {
        id: 'cat_groceries',
        name: 'Groceries',
        color: '#22c55e',
      });
      await writerA.write('expense.updated', {
        expenseId: 'e_a1',
        patch: { category_id: 'cat_groceries' },
      });

      // Dev B writes 2 events
      await writerB.write('expense.created', {
        expenseId: 'e_b1',
        amount_paise: 42000,
        date: '2026-10-31',
        txn_ts: '2026-10-31T11:00:00+05:30',
        direction: 'debit',
        kind: 'spend',
        merchant_raw: 'Store B1',
        status: 'active',
      });
      await writerB.write('account.upserted', {
        id: 'acc_hdfc',
        name: 'HDFC Bank',
        type: 'bank',
      });

      // Both devices sync
      await syncNow({ storage, db: dbA, deviceId: devA.deviceId });
      await syncNow({ storage, db: dbB, deviceId: devB.deviceId });

      const dumpA = await dumpDatabase(dbA);
      const dumpB = await dumpDatabase(dbB);

      expect(dumpA).toEqual(dumpB);
      expect(dumpA.expenses).toHaveLength(2);
      expect(dumpA.categories).toHaveLength(1);
      expect(dumpA.accounts).toHaveLength(1);
      expect(dumpA.applied_events).toHaveLength(5);
    });

    it('Same events delivered twice (sync run twice, and a file listed twice): applied once.', async () => {
      const dbA = await createSqljsAdapter();
      await migrate(dbA);
      const dbB = await createSqljsAdapter();
      await migrate(dbB);

      const devA = await ensureDevice({ db: dbA, storage });
      const devB = await ensureDevice({ db: dbB, storage });

      const writerA = createWriter({ deviceId: devA.deviceId, storage, db: dbA });
      await writerA.write('expense.created', {
        expenseId: 'e_once',
        amount_paise: 9900,
        date: '2026-10-31',
        txn_ts: '2026-10-31T12:00:00+05:30',
        direction: 'debit',
        kind: 'spend',
        merchant_raw: 'Only Once',
        status: 'active',
      });

      // First sync on B
      const res1 = await syncNow({ storage, db: dbB, deviceId: devB.deviceId });
      expect(res1.newEvents).toBe(1);
      expect(res1.applied).toBe(1);

      // Second sync on B: safe to run twice in a row, returns newEvents: 0
      const res2 = await syncNow({ storage, db: dbB, deviceId: devB.deviceId });
      expect(res2.newEvents).toBe(0);
      expect(res2.applied).toBe(0);

      // Simulate file listed twice or duplicate entries returned by storage
      const originalListFiles = storage.listFiles.bind(storage);
      storage.listFiles = async (prefix) => {
        const files = await originalListFiles(prefix);
        return [...files, ...files];
      };

      const res3 = await syncNow({ storage, db: dbB, deviceId: devB.deviceId, full: true });
      expect(res3.newEvents).toBe(0);

      const expenses = await listExpenses(dbB);
      expect(expenses).toHaveLength(1);
    });

    it('Partial last line (no "\\n"): ignored on this sync, picked up on the next sync once completed.', async () => {
      const db = await createSqljsAdapter();
      await migrate(db);

      const devId = 'dev-part12';
      const ev1 = createEvent({
        type: 'expense.created',
        dev: devId,
        seq: 1,
        ts: '2026-10-31T10:00:00+05:30',
        data: { expenseId: 'e_complete', amount_paise: 5000 },
      });
      const ev2 = createEvent({
        type: 'expense.created',
        dev: devId,
        seq: 2,
        ts: '2026-10-31T10:01:00+05:30',
        data: { expenseId: 'e_partial', amount_paise: 7500 },
      });

      const line1 = serializeEvent(ev1); // has trailing \n
      const line2Full = serializeEvent(ev2); // has trailing \n
      const line2Partial = line2Full.slice(0, -10); // incomplete line without \n

      // Write complete line 1 + partial line 2
      storage.setRawContent(`events-${devId}.jsonl`, line1 + line2Partial);

      // First sync: partial line must be ignored
      const res1 = await syncNow({ storage, db, deviceId: 'dev-local' });
      expect(res1.linesRead).toBe(1);
      expect(res1.newEvents).toBe(1);
      const expensesAfter1 = await listExpenses(db);
      expect(expensesAfter1).toHaveLength(1);
      expect(expensesAfter1[0].id).toBe('e_complete');

      // Now complete line 2
      storage.setRawContent(`events-${devId}.jsonl`, line1 + line2Full);

      // Second sync: line 2 is now complete and picked up
      const res2 = await syncNow({ storage, db, deviceId: 'dev-local' });
      expect(res2.linesRead).toBe(1);
      expect(res2.newEvents).toBe(1);
      const expensesAfter2 = await listExpenses(db);
      expect(expensesAfter2).toHaveLength(2);
      expect(expensesAfter2.map((e) => e.id)).toContain('e_partial');
    });

    it('A line with bad CRC, one with bad JSON, one unknown version: skipped, reported in issues with the line number; the other lines still apply.', async () => {
      const db = await createSqljsAdapter();
      await migrate(db);

      const devId = 'dev-corrupt';
      const ev1 = createEvent({
        type: 'expense.created',
        dev: devId,
        seq: 1,
        ts: '2026-10-31T10:00:00+05:30',
        data: { expenseId: 'e_valid1', amount_paise: 1000 },
      });
      const ev2 = createEvent({
        type: 'expense.created',
        dev: devId,
        seq: 5,
        ts: '2026-10-31T10:05:00+05:30',
        data: { expenseId: 'e_valid2', amount_paise: 2000 },
      });

      const validLine1 = serializeEvent(ev1);
      const badCrcLine = JSON.stringify({ ...ev1, id: 'ev_bad_crc', seq: 2, crc: '00000000' }) + '\n';
      const badJsonLine = '{"broken json line seq: 3\n';
      const badVerLine = JSON.stringify({ ...ev1, id: 'ev_bad_ver', seq: 4, v: 99, crc: '12345678' }) + '\n';
      const validLine2 = serializeEvent(ev2);

      const content = validLine1 + badCrcLine + badJsonLine + badVerLine + validLine2;
      storage.setRawContent(`events-${devId}.jsonl`, content);

      const { events, issues } = await readAllEvents({ storage, db });

      // Corrupt lines skipped, valid lines returned
      expect(events).toHaveLength(2);
      expect(events[0].id).toBe(ev1.id);
      expect(events[1].id).toBe(ev2.id);

      // Issues reported with line numbers
      expect(issues).toHaveLength(3);
      expect(issues.find((i) => i.lineNo === 2)).toBeDefined();
      expect(issues.find((i) => i.lineNo === 3)).toBeDefined();
      expect(issues.find((i) => i.lineNo === 4)).toBeDefined();

      // Apply in syncNow: valid events apply without throwing
      const res = await syncNow({ storage, db, deviceId: 'dev-local' });
      expect(res.applied).toBe(2);
      const expenses = await listExpenses(db);
      expect(expenses).toHaveLength(2);
    });

    it('Conflict copy "events-dev-abc123 (1).jsonl" containing events that are missing from the original file: they are applied.', async () => {
      const db = await createSqljsAdapter();
      await migrate(db);

      const devId = 'dev-abc123';
      const ev1 = createEvent({
        type: 'expense.created',
        dev: devId,
        seq: 1,
        ts: '2026-10-31T10:00:00+05:30',
        data: { expenseId: 'e_orig', amount_paise: 3000 },
      });
      const ev2 = createEvent({
        type: 'expense.created',
        dev: devId,
        seq: 2,
        ts: '2026-10-31T10:01:00+05:30',
        data: { expenseId: 'e_conflict_only', amount_paise: 7000 },
      });

      // Original file has only ev1
      storage.setRawContent(`events-${devId}.jsonl`, serializeEvent(ev1));
      // Conflict copy has both ev1 and ev2
      storage.setRawContent(`events-${devId} (1).jsonl`, serializeEvent(ev1) + serializeEvent(ev2));

      const res = await syncNow({ storage, db, deviceId: 'dev-local' });
      expect(res.applied).toBe(2);
      expect(res.issues.some((i) => i.type === 'warning' && i.file.includes('(1)'))).toBe(true);

      const expenses = await listExpenses(db);
      expect(expenses).toHaveLength(2);
      expect(expenses.map((e) => e.id)).toContain('e_conflict_only');
    });

    it('File replaced by an older shorter version, then restored: no crash, no lost events after a full sync.', async () => {
      const db = await createSqljsAdapter();
      await migrate(db);

      const devId = 'dev-replace';
      const ev1 = createEvent({
        type: 'expense.created',
        dev: devId,
        seq: 1,
        ts: '2026-10-31T10:00:00+05:30',
        data: { expenseId: 'e_1', amount_paise: 1000 },
      });
      const ev2 = createEvent({
        type: 'expense.created',
        dev: devId,
        seq: 2,
        ts: '2026-10-31T10:01:00+05:30',
        data: { expenseId: 'e_2', amount_paise: 2000 },
      });
      const ev3 = createEvent({
        type: 'expense.created',
        dev: devId,
        seq: 3,
        ts: '2026-10-31T10:02:00+05:30',
        data: { expenseId: 'e_3', amount_paise: 3000 },
      });

      // 1. Initial 3 events
      storage.setRawContent(`events-${devId}.jsonl`, serializeEvent(ev1) + serializeEvent(ev2) + serializeEvent(ev3));
      const res1 = await syncNow({ storage, db, deviceId: 'dev-local' });
      expect(res1.linesRead).toBe(3);
      expect(res1.applied).toBe(3);

      // 2. File replaced by older shorter version with 1 event
      storage.setRawContent(`events-${devId}.jsonl`, serializeEvent(ev1));
      const res2 = await syncNow({ storage, db, deviceId: 'dev-local' });
      // Shorter file re-reads from line 0, 1 line read, 0 new events, no crash
      expect(res2.linesRead).toBe(1);
      expect(res2.newEvents).toBe(0);

      // 3. File restored with all 3 events + 4th event
      const ev4 = createEvent({
        type: 'expense.created',
        dev: devId,
        seq: 4,
        ts: '2026-10-31T10:03:00+05:30',
        data: { expenseId: 'e_4', amount_paise: 4000 },
      });
      storage.setRawContent(
        `events-${devId}.jsonl`,
        serializeEvent(ev1) + serializeEvent(ev2) + serializeEvent(ev3) + serializeEvent(ev4)
      );

      // Full sync / rebuild recovers everything without lost events
      const res3 = await rebuildFromLogs({ storage, db });
      expect(res3.totalEvents).toBe(4);

      const expenses = await listExpenses(db);
      expect(expenses).toHaveLength(4);
    });

    it('Incremental sync reads only new lines (assert on the number of lines read) and gives the same final database as a full sync.', async () => {
      const dbInc = await createSqljsAdapter();
      await migrate(dbInc);
      const dbFull = await createSqljsAdapter();
      await migrate(dbFull);

      const devA = await ensureDevice({ db: dbInc, storage, label: 'Device A' });
      const writerA = createWriter({ deviceId: devA.deviceId, storage, db: dbInc });

      // Dev A writes 2 events
      await writerA.write('expense.created', {
        expenseId: 'e_inc1',
        amount_paise: 1100,
        date: '2026-10-31',
        txn_ts: '2026-10-31T10:00:00+05:30',
        direction: 'debit',
        kind: 'spend',
        merchant_raw: 'Inc 1',
        status: 'active',
      });
      await writerA.write('expense.created', {
        expenseId: 'e_inc2',
        amount_paise: 2200,
        date: '2026-10-31',
        txn_ts: '2026-10-31T10:01:00+05:30',
        direction: 'debit',
        kind: 'spend',
        merchant_raw: 'Inc 2',
        status: 'active',
      });

      // Incremental sync on fresh DB2: reads exactly 2 lines
      const db2 = await createSqljsAdapter();
      await migrate(db2);
      const syncRes1 = await syncNow({ storage, db: db2, deviceId: 'dev-b' });
      expect(syncRes1.linesRead).toBe(2);
      expect(syncRes1.newEvents).toBe(2);

      // Dev A writes 3 more events
      await writerA.write('expense.created', {
        expenseId: 'e_inc3',
        amount_paise: 3300,
        date: '2026-10-31',
        txn_ts: '2026-10-31T10:02:00+05:30',
        direction: 'debit',
        kind: 'spend',
        merchant_raw: 'Inc 3',
        status: 'active',
      });
      await writerA.write('expense.created', {
        expenseId: 'e_inc4',
        amount_paise: 4400,
        date: '2026-10-31',
        txn_ts: '2026-10-31T10:03:00+05:30',
        direction: 'debit',
        kind: 'spend',
        merchant_raw: 'Inc 4',
        status: 'active',
      });
      await writerA.write('expense.created', {
        expenseId: 'e_inc5',
        amount_paise: 5500,
        date: '2026-10-31',
        txn_ts: '2026-10-31T10:04:00+05:30',
        direction: 'debit',
        kind: 'spend',
        merchant_raw: 'Inc 5',
        status: 'active',
      });

      // Incremental sync on DB2: reads ONLY the 3 new lines
      const syncRes2 = await syncNow({ storage, db: db2, deviceId: 'dev-b' });
      expect(syncRes2.linesRead).toBe(3);
      expect(syncRes2.newEvents).toBe(3);

      // Rebuild on fresh dbFull
      await rebuildFromLogs({ storage, db: dbFull });

      expect(await dumpDatabase(db2)).toEqual(await dumpDatabase(dbFull));
    });

    it('Crash simulation: the file append succeeds, the database apply throws. The next syncNow applies the event and seq numbering stays continuous.', async () => {
      const db = await createSqljsAdapter();
      await migrate(db);

      const devId = 'dev-crash';
      let shouldThrowOnDb = true;

      // Mock DB wrapper that throws during apply
      const flakyDb = {
        exec: db.exec.bind(db),
        query: db.query.bind(db),
        transaction: async (fn) => {
          if (shouldThrowOnDb) {
            throw new Error('Simulated SQLite disk write failure');
          }
          return db.transaction(fn);
        },
      };

      const writer = createWriter({ deviceId: devId, storage, db: flakyDb });

      // Write event 1 (fails at db step)
      let thrownError = null;
      try {
        await writer.write('expense.created', {
          expenseId: 'e_crash1',
          amount_paise: 5000,
          date: '2026-10-31',
          txn_ts: '2026-10-31T10:00:00+05:30',
          direction: 'debit',
          kind: 'spend',
          merchant_raw: 'Crash Store',
          status: 'active',
        });
      } catch (err) {
        thrownError = err;
      }

      expect(thrownError).not.toBeNull();
      expect(thrownError.message).toContain('Database apply failed');

      // The file was appended and remains intact
      const content = await storage.readFile(`events-${devId}.jsonl`);
      expect(content).toContain('e_crash1');

      // The event is not in DB yet
      const expensesBefore = await listExpenses(db);
      expect(expensesBefore).toHaveLength(0);

      // Next syncNow heals by reading the own file and applying the event
      shouldThrowOnDb = false;
      const syncRes = await syncNow({ storage, db, deviceId: devId });
      expect(syncRes.newEvents).toBe(1);
      expect(syncRes.applied).toBe(1);

      const expensesAfter = await listExpenses(db);
      expect(expensesAfter).toHaveLength(1);
      expect(expensesAfter[0].id).toBe('e_crash1');

      // Subsequent write: seq continues without gap
      const ev2 = await writer.write('expense.created', {
        expenseId: 'e_crash2',
        amount_paise: 6000,
        date: '2026-10-31',
        txn_ts: '2026-10-31T10:05:00+05:30',
        direction: 'debit',
        kind: 'spend',
        merchant_raw: 'Crash Store 2',
        status: 'active',
      });
      expect(ev2.seq).toBe(2);
    });

    it('seq continues after a restart (new writer on the same file).', async () => {
      const db = await createSqljsAdapter();
      await migrate(db);

      const devId = 'dev-restart';

      // First writer instance writes 3 events
      const writer1 = createWriter({ deviceId: devId, storage, db });
      const ev1 = await writer1.write('expense.created', { expenseId: 'e_r1', amount_paise: 100 });
      const ev2 = await writer1.write('expense.created', { expenseId: 'e_r2', amount_paise: 200 });
      const ev3 = await writer1.write('expense.created', { expenseId: 'e_r3', amount_paise: 300 });

      expect(ev1.seq).toBe(1);
      expect(ev2.seq).toBe(2);
      expect(ev3.seq).toBe(3);

      // Simulate app restart: create brand-new writer instance on same device and storage
      const writer2 = createWriter({ deviceId: devId, storage, db });
      const ev4 = await writer2.write('expense.created', { expenseId: 'e_r4', amount_paise: 400 });

      expect(ev4.seq).toBe(4);
    });

    it('ts never goes backwards when the clock is set back.', async () => {
      const db = await createSqljsAdapter();
      await migrate(db);

      const devId = 'dev-skew';
      let simulatedTime = 1730370000000; // t0

      const writer = createWriter({
        deviceId: devId,
        storage,
        db,
        now: () => simulatedTime,
      });

      const ev1 = await writer.write('expense.created', { expenseId: 'e_t1', amount_paise: 100 });
      const ts1Ms = Date.parse(ev1.ts);

      // System clock skew: time goes backwards by 1 hour (3,600,000 ms)
      simulatedTime -= 3600000;

      const ev2 = await writer.write('expense.created', { expenseId: 'e_t2', amount_paise: 200 });
      const ts2Ms = Date.parse(ev2.ts);

      // ts must not go backwards
      expect(ts2Ms).toBeGreaterThanOrEqual(ts1Ms);
    });

    it('Reinstall: a brand-new device ID plus rebuildFromLogs reconstructs exactly the state of the old device\'s database.', async () => {
      const dbOld = await createSqljsAdapter();
      await migrate(dbOld);

      const devOld = await ensureDevice({ db: dbOld, storage, label: 'Old Phone' });
      const writerOld = createWriter({ deviceId: devOld.deviceId, storage, db: dbOld });

      await writerOld.write('category.upserted', { id: 'cat_dining', name: 'Dining', color: '#f97316' });
      await writerOld.write('account.upserted', { id: 'acc_icici', name: 'ICICI Bank', type: 'bank' });
      await writerOld.write('expense.created', {
        expenseId: 'e_food1',
        amount_paise: 85000,
        date: '2026-10-31',
        txn_ts: '2026-10-31T13:00:00+05:30',
        direction: 'debit',
        kind: 'spend',
        merchant_raw: 'Restaurant',
        category_id: 'cat_dining',
        account_id: 'acc_icici',
        status: 'active',
      });
      await writerOld.write('expense.created', {
        expenseId: 'e_food2',
        amount_paise: 12000,
        date: '2026-10-31',
        txn_ts: '2026-10-31T14:00:00+05:30',
        direction: 'debit',
        kind: 'spend',
        merchant_raw: 'Cafe',
        category_id: 'cat_dining',
        status: 'active',
      });

      // Reinstall: new device ID, fresh database
      const dbNew = await createSqljsAdapter();
      await migrate(dbNew);

      const devNew = await ensureDevice({ db: dbNew, storage, label: 'New Phone' });
      expect(devNew.deviceId).not.toBe(devOld.deviceId);

      // Run rebuildFromLogs on new device
      await rebuildFromLogs({ storage, db: dbNew });

      // Read model projection tables must be identical
      const dumpOld = await dumpDatabase(dbOld);
      const dumpNew = await dumpDatabase(dbNew);
      expect(dumpNew).toEqual(dumpOld);
    });

    it('Joint-account duplicate: A and B each write expense.created for the same dedupeKey (same deterministic expenseId): after syncing there is ONE expense.', async () => {
      const dbA = await createSqljsAdapter();
      await migrate(dbA);
      const dbB = await createSqljsAdapter();
      await migrate(dbB);

      const devA = await ensureDevice({ db: dbA, storage, label: 'Spouse A' });
      const devB = await ensureDevice({ db: dbB, storage, label: 'Spouse B' });

      const writerA = createWriter({ deviceId: devA.deviceId, storage, db: dbA });
      const writerB = createWriter({ deviceId: devB.deviceId, storage, db: dbB });

      const jointDedupeKey = 'hdfc-joint-sms-tx-994411';
      const deterministicExpenseId = expenseIdFromDedupeKey(jointDedupeKey);

      // Spouse A records the expense
      await writerA.write('expense.created', {
        expenseId: deterministicExpenseId,
        amount_paise: 350000,
        date: '2026-10-31',
        txn_ts: '2026-10-31T15:00:00+05:30',
        direction: 'debit',
        kind: 'spend',
        merchant_raw: 'Supermarket',
        dedupe_key: jointDedupeKey,
        status: 'active',
      });

      // Spouse B records the same transaction independently with same dedupeKey
      await writerB.write('expense.created', {
        expenseId: deterministicExpenseId,
        amount_paise: 350000,
        date: '2026-10-31',
        txn_ts: '2026-10-31T15:00:00+05:30',
        direction: 'debit',
        kind: 'spend',
        merchant_raw: 'Supermarket',
        dedupe_key: jointDedupeKey,
        status: 'active',
      });

      // Both sync
      await syncNow({ storage, db: dbA, deviceId: devA.deviceId });
      await syncNow({ storage, db: dbB, deviceId: devB.deviceId });

      const expensesA = await listExpenses(dbA);
      const expensesB = await listExpenses(dbB);

      expect(expensesA).toHaveLength(1);
      expect(expensesB).toHaveLength(1);
      expect(expensesA[0].id).toBe(deterministicExpenseId);
      expect(expensesB[0].id).toBe(deterministicExpenseId);
    });

    it('Rebuild vs incremental: dumpDatabase is identical.', async () => {
      const dbInc = await createSqljsAdapter();
      await migrate(dbInc);
      const dbRebuilt = await createSqljsAdapter();
      await migrate(dbRebuilt);

      const dev1 = await ensureDevice({ db: dbInc, storage, label: 'Dev 1' });
      const dev2 = await ensureDevice({ db: dbInc, storage, label: 'Dev 2' });

      const writer1 = createWriter({ deviceId: dev1.deviceId, storage, db: dbInc });
      const writer2 = createWriter({ deviceId: dev2.deviceId, storage, db: dbInc });

      // Step 1: Create categories and rules
      await writer1.write('category.upserted', { id: 'c_fuel', name: 'Fuel', color: '#eab308' });
      await writer1.write('rule.upserted', { id: 'r_shell', pattern: 'SHELL', category_id: 'c_fuel' });
      await syncNow({ storage, db: dbInc, deviceId: dev1.deviceId });

      // Step 2: Create expenses
      await writer2.write('expense.created', {
        expenseId: 'e_fuel1',
        amount_paise: 250000,
        date: '2026-10-31',
        txn_ts: '2026-10-31T16:00:00+05:30',
        direction: 'debit',
        kind: 'spend',
        merchant_raw: 'SHELL STATION',
        category_id: 'c_fuel',
        status: 'active',
      });
      await writer1.write('expense.created', {
        expenseId: 'e_fuel2',
        amount_paise: 180000,
        date: '2026-10-31',
        txn_ts: '2026-10-31T16:30:00+05:30',
        direction: 'debit',
        kind: 'spend',
        merchant_raw: 'HP PETROL',
        status: 'active',
      });
      await syncNow({ storage, db: dbInc, deviceId: dev1.deviceId });

      // Step 3: Update and merge
      await writer2.write('expense.updated', {
        expenseId: 'e_fuel2',
        patch: { note: 'Two-wheeler petrol' },
      });
      await writer1.write('expense.created', {
        expenseId: 'e_fuel_dup',
        amount_paise: 180000,
        date: '2026-10-31',
        txn_ts: '2026-10-31T16:30:00+05:30',
        direction: 'debit',
        kind: 'spend',
        merchant_raw: 'HP PETROL',
        status: 'active',
      });
      await writer1.write('expense.merged', {
        keepId: 'e_fuel2',
        dropId: 'e_fuel_dup',
      });
      await syncNow({ storage, db: dbInc, deviceId: dev1.deviceId });

      // Now rebuild on dbRebuilt from raw logs
      await rebuildFromLogs({ storage, db: dbRebuilt });

      const dumpInc = await dumpDatabase(dbInc);
      const dumpReb = await dumpDatabase(dbRebuilt);

      expect(dumpInc).toEqual(dumpReb);
    });

    it('nothing in src/core imports Capacitor, React, or SQLite native bindings', () => {
      const coreDir = resolve(process.cwd(), 'src/core');
      const filesToCheck = [];

      function walk(dir) {
        const entries = readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = resolve(dir, entry.name);
          if (entry.isDirectory()) {
            walk(fullPath);
          } else if (entry.isFile() && entry.name.endsWith('.js') && !entry.name.endsWith('.test.js')) {
            filesToCheck.push(fullPath);
          }
        }
      }

      walk(coreDir);

      const forbiddenPatterns = [
        '@capacitor/core',
        '@capacitor-community/sqlite',
        'react',
        'src/native',
      ];

      for (const filePath of filesToCheck) {
        const content = readFileSync(filePath, 'utf8');
        for (const pattern of forbiddenPatterns) {
          expect(content).not.toContain(pattern);
        }
      }
    });
  });
});

