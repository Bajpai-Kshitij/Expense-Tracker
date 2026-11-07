import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { planImport, applyImport, ensureUnparsedReviewItems } from './pipeline.js';
import { createSqljsAdapter } from '../db/testing/sqljsAdapter.js';
import { createMemoryStorage } from '../sync/testing/memoryStorage.js';
import { createWriter } from '../sync/writer.js';
import { syncNow, rebuildFromLogs } from '../sync/engine.js';
import { migrate } from '../db/migrations.js';
import { rowsToState, totals, listExpenses, dumpDatabase, uncategorizedInbox } from '../db/index.js';
import { seedIfEmpty } from '../seed/seed.js';
import { seedBrandsIfEmpty } from '../seed/brandSeed.js';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

describe('src/core/ingest/pipeline.js - E2E SMS Pipeline', () => {
  let db;
  let storage;
  let writer;
  let state;
  let ctx;
  let inboxMessages;
  const allowlist = ['BANK_SMS'];

  beforeEach(async () => {
    db = await createSqljsAdapter();
    await migrate(db);
    storage = createMemoryStorage();
    writer = createWriter({ deviceId: 'dev_A', storage, db });
    await writer.init();
    await seedIfEmpty({ writer, db });
    await seedBrandsIfEmpty({ writer, db });

    const rows = {
      expenses: await db.query('SELECT * FROM expenses;'),
      categories: await db.query('SELECT * FROM categories;'),
      accounts: await db.query('SELECT * FROM accounts;'),
      brands: await db.query('SELECT * FROM brands;'),
      rules: await db.query('SELECT * FROM rules;'),
      review_queue: await db.query('SELECT * FROM review_queue;'),
    };
    state = rowsToState(rows);
    ctx = {
      accounts: state.accounts,
      brands: state.brands,
      rules: state.rules,
      categories: state.categories,
      ownerNames: ['Test Owner', 'Test Owner Longname'],
    };

    const files = fs
      .readdirSync(FIXTURES_DIR)
      .filter((f) => f.endsWith('.txt'))
      .sort();

    inboxMessages = files.map((f, idx) => ({
      address: 'BANK_SMS',
      body: fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf-8'),
      date: 1700000000000 + idx * 1000,
    }));
  });

  it('End-to-end inbox: 26 expenses, 2 held, 4 unparsed, 10 ignored, net spend 526434 / 1026234', async () => {
    const plan = planImport({
      messages: inboxMessages,
      ctx,
      state,
      seenHashes: new Set(),
      allowlist,
    });

    expect(plan.summary.scanned).toBe(44);
    expect(plan.summary.created).toBe(26);
    expect(plan.summary.held).toBe(2);
    expect(plan.summary.unparsed).toBe(4);
    expect(plan.summary.ignored).toBe(10);
    expect(plan.summary.unknown).toBe(1);
    expect(plan.summary.duplicateTransaction).toBe(1); // hdfc_flattened duplicate of hdfc_upi_1

    await applyImport({ plan, writer, db });

    // Net spend (default filters, fixed excluded) is 526434 paise
    const totalExcl = await totals(db, { includeFixed: false });
    expect(totalExcl.netPaise).toBe(526434);

    // With includeFixed it is 1026234 paise
    const totalIncl = await totals(db, { includeFixed: true });
    expect(totalIncl.netPaise).toBe(1026234);

    // Income rows count only as income (not in spend)
    const incomeRows = await listExpenses(db, { includeFixed: true });
    const neftRows = incomeRows.filter((r) => r.kind === 'income');
    expect(neftRows).toHaveLength(3);
    expect(neftRows[0].amount_paise).toBe(2000000);
    expect(neftRows[1].amount_paise).toBe(10000000);
    expect(neftRows[2].amount_paise).toBe(10000000);
  });

  it('Scanning the same inbox twice creates 0 new expenses and 0 new events', async () => {
    const plan1 = planImport({
      messages: inboxMessages,
      ctx,
      state,
      seenHashes: new Set(),
      allowlist,
    });
    await applyImport({ plan: plan1, writer, db });

    // Fetch updated seenHashes from raw_messages
    const rawRows = await db.query('SELECT hash FROM raw_messages;');
    const seenHashes = new Set(rawRows.map((r) => r.hash));

    const plan2 = planImport({
      messages: inboxMessages,
      ctx,
      state,
      seenHashes,
      allowlist,
    });

    expect(plan2.summary.created).toBe(0);
    expect(plan2.events).toHaveLength(0);
    expect(plan2.summary.duplicateMessage).toBe(43); // All stored messages skipped by rawHash
  });

  it('Scanning in a shuffled order gives an identical database dump', async () => {
    const fixedNow = () => 1700000000000;
    const dbOrig = await createSqljsAdapter();
    await migrate(dbOrig);
    const storageOrig = createMemoryStorage();
    const writerOrig = createWriter({ deviceId: 'dev_A', storage: storageOrig, db: dbOrig, now: fixedNow });
    await writerOrig.init();
    await seedIfEmpty({ writer: writerOrig, db: dbOrig });
    await seedBrandsIfEmpty({ writer: writerOrig, db: dbOrig });

    const rowsOrig = {
      expenses: await dbOrig.query('SELECT * FROM expenses;'),
      categories: await dbOrig.query('SELECT * FROM categories;'),
      accounts: await dbOrig.query('SELECT * FROM accounts;'),
      brands: await dbOrig.query('SELECT * FROM brands;'),
      rules: await dbOrig.query('SELECT * FROM rules;'),
    };
    const stateOrig = rowsToState(rowsOrig);

    const plan1 = planImport({
      messages: inboxMessages,
      ctx,
      state: stateOrig,
      seenHashes: new Set(),
      allowlist,
    });
    await applyImport({ plan: plan1, writer: writerOrig, db: dbOrig });
    const dumpOriginal = await dumpDatabase(dbOrig);

    // Fresh database with shuffled messages
    const db2 = await createSqljsAdapter();
    await migrate(db2);
    const storage2 = createMemoryStorage();
    const writer2 = createWriter({ deviceId: 'dev_A', storage: storage2, db: db2, now: fixedNow });
    await writer2.init();
    await seedIfEmpty({ writer: writer2, db: db2 });
    await seedBrandsIfEmpty({ writer: writer2, db: db2 });

    const rows2 = {
      expenses: await db2.query('SELECT * FROM expenses;'),
      categories: await db2.query('SELECT * FROM categories;'),
      accounts: await db2.query('SELECT * FROM accounts;'),
      brands: await db2.query('SELECT * FROM brands;'),
      rules: await db2.query('SELECT * FROM rules;'),
    };
    const state2 = rowsToState(rows2);

    // Deterministic shuffle
    const shuffled = inboxMessages.slice().reverse();
    const plan2 = planImport({
      messages: shuffled,
      ctx,
      state: state2,
      seenHashes: new Set(),
      allowlist,
    });
    await applyImport({ plan: plan2, writer: writer2, db: db2 });
    const dumpShuffled = await dumpDatabase(db2);

    expect(dumpShuffled.expenses).toEqual(dumpOriginal.expenses);
  });

  it('Two devices (joint account) scan the same inbox, then sync: ONE expense per transaction, identical dumps', async () => {
    // Device A
    const planA = planImport({
      messages: inboxMessages,
      ctx,
      state,
      seenHashes: new Set(),
      allowlist,
    });
    await applyImport({ plan: planA, writer, db });

    // Device B
    const dbB = await createSqljsAdapter();
    await migrate(dbB);
    const writerB = createWriter({ deviceId: 'dev_B', storage, db: dbB });
    await writerB.init();
    await seedIfEmpty({ writer: writerB, db: dbB });
    await seedBrandsIfEmpty({ writer: writerB, db: dbB });

    const rowsB = {
      expenses: await dbB.query('SELECT * FROM expenses;'),
      categories: await dbB.query('SELECT * FROM categories;'),
      accounts: await dbB.query('SELECT * FROM accounts;'),
      brands: await dbB.query('SELECT * FROM brands;'),
      rules: await dbB.query('SELECT * FROM rules;'),
    };
    const stateB = rowsToState(rowsB);

    const planB = planImport({
      messages: inboxMessages,
      ctx,
      state: stateB,
      seenHashes: new Set(),
      allowlist,
    });
    await applyImport({ plan: planB, writer: writerB, db: dbB });

    // Sync A and B
    await syncNow({ storage, db, deviceId: 'dev_A' });
    await syncNow({ storage, db: dbB, deviceId: 'dev_B' });

    const expensesA = await listExpenses(db, { includeFixed: true });
    const expensesB = await listExpenses(dbB, { includeFixed: true });

    // Exactly ONE expense per transaction on both devices
    expect(expensesA).toHaveLength(26);
    expect(expensesB).toHaveLength(26);
    expect(expensesA.map((e) => e.id).sort()).toEqual(expensesB.map((e) => e.id).sort());

    // Rebuild from logs achieves complete canonical convergence
    await rebuildFromLogs({ storage, db });
    await rebuildFromLogs({ storage, db: dbB });

    const dumpA = await dumpDatabase(db);
    const dumpB = await dumpDatabase(dbB);

    expect(dumpA.expenses).toHaveLength(26);
    expect(dumpB.expenses).toHaveLength(26);
    expect(dumpA.expenses).toEqual(dumpB.expenses);
  });

  it('The two sides of the payment on card 7068 have the same linkId', async () => {
    const plan = planImport({
      messages: inboxMessages,
      ctx,
      state,
      seenHashes: new Set(),
      allowlist,
    });
    await applyImport({ plan, writer, db });

    const linkedEvents = plan.events.filter((e) => e.data.linkId);
    const links7068 = linkedEvents.filter((e) => e.data.amountPaise === 168468);
    expect(links7068).toHaveLength(2);
    expect(links7068[0].data.linkId).toBe(links7068[1].data.linkId);
    expect(links7068[0].data.linkId.startsWith('pay_')).toBe(true);

    const otherLinks = linkedEvents.filter((e) => e.data.amountPaise !== 168468);
    for (const other of otherLinks) {
      expect(other.data.linkId).not.toBe(links7068[0].data.linkId);
    }
  });

  it('The OTP message never creates an expense', async () => {
    const otpBody = 'Your OTP for Axis Bank Card verification is 123456. Do not share.';
    const plan = planImport({
      messages: [{ address: 'BANK_SMS', body: otpBody, date: 1700000000000 }],
      ctx,
      state,
      seenHashes: new Set(),
      allowlist,
    });

    expect(plan.summary.created).toBe(0);
    expect(plan.summary.ignored).toBe(1);
    expect(plan.events).toHaveLength(0);
  });

  it('Crash tests: (1) fail after writeMany, next scan creates 0 duplicates and completes raw rows', async () => {
    const plan = planImport({
      messages: inboxMessages,
      ctx,
      state,
      seenHashes: new Set(),
      allowlist,
    });

    // Step 1: writeMany succeeds
    await writer.writeMany(plan.events);

    // Crash: Step 2 not executed!
    // Check raw_messages is still empty
    const rawBefore = await db.query('SELECT count(*) as c FROM raw_messages;');
    expect(Number(rawBefore[0].c)).toBe(0);

    // Next scan: re-plans inbox
    const freshRows = {
      expenses: await db.query('SELECT * FROM expenses;'),
      categories: await db.query('SELECT * FROM categories;'),
      accounts: await db.query('SELECT * FROM accounts;'),
      brands: await db.query('SELECT * FROM brands;'),
      rules: await db.query('SELECT * FROM rules;'),
    };
    const freshState = rowsToState(freshRows);

    const plan2 = planImport({
      messages: inboxMessages,
      ctx,
      state: freshState,
      seenHashes: new Set(),
      allowlist,
    });

    expect(plan2.summary.created).toBe(0);
    expect(plan2.summary.duplicateTransaction).toBe(27); // All parsed transactions recognized as duplicates

    // Step 2 completes
    await applyImport({ plan: plan2, writer, db });

    const rawAfter = await db.query('SELECT count(*) as c FROM raw_messages;');
    expect(Number(rawAfter[0].c)).toBe(43); // All messages successfully recorded locally
  });

  it('A deleted imported expense is not resurrected by a rescan', async () => {
    const plan = planImport({
      messages: inboxMessages,
      ctx,
      state,
      seenHashes: new Set(),
      allowlist,
    });
    await applyImport({ plan, writer, db });

    // Delete one expense
    const firstExp = (await listExpenses(db))[0];
    await writer.write('expense.deleted', { expenseId: firstExp.id });

    // Refresh state
    const currentRows = {
      expenses: await db.query('SELECT * FROM expenses;'),
      categories: await db.query('SELECT * FROM categories;'),
      accounts: await db.query('SELECT * FROM accounts;'),
      brands: await db.query('SELECT * FROM brands;'),
      rules: await db.query('SELECT * FROM rules;'),
    };
    const currentState = rowsToState(currentRows);

    // Rescan with empty seenHashes (simulating clean local raw or rescan)
    const plan2 = planImport({
      messages: inboxMessages,
      ctx,
      state: currentState,
      seenHashes: new Set(),
      allowlist,
    });

    expect(plan2.summary.created).toBe(0);
    expect(plan2.summary.skippedDeleted).toBe(1);

    const activeList = await listExpenses(db);
    expect(activeList.some((e) => e.id === firstExp.id)).toBe(false);
  });

  it('Categorization in import: SWIGGY gets Food, DISTRICT MO gets Entertainment, POLICYBAZAAR gets kind fixed', async () => {
    const plan = planImport({
      messages: inboxMessages,
      ctx,
      state,
      seenHashes: new Set(),
      allowlist,
    });

    const swiggyExp = plan.events.find((e) => e.data.merchantRaw.includes('SWIGGY'));
    expect(swiggyExp).toBeDefined();
    expect(swiggyExp.data.categoryId).toBe('cat_food');
    expect(swiggyExp.data.categoryLocked).toBe(0);

    const districtExp = plan.events.find((e) => e.data.merchantRaw.includes('DISTRICT MO'));
    expect(districtExp).toBeDefined();
    expect(districtExp.data.categoryId).toBe('cat_entertainment');

    const pbExp = plan.events.find((e) => e.data.merchantRaw.includes('POLICYBAZAAR'));
    expect(pbExp).toBeDefined();
    expect(pbExp.data.kind).toBe('fixed');
  });

  it('ensureUnparsedReviewItems rebuilds review items for unparsed and held messages', async () => {
    const plan = planImport({
      messages: inboxMessages,
      ctx,
      state,
      seenHashes: new Set(),
      allowlist,
    });
    await applyImport({ plan, writer, db });

    // Clear review_queue table to simulate loss or migration
    await db.exec('DELETE FROM review_queue;');
    const countBefore = await db.query('SELECT count(*) as c FROM review_queue;');
    expect(Number(countBefore[0].c)).toBe(0);

    await ensureUnparsedReviewItems(db, state);

    const countAfter = await db.query('SELECT count(*) as c FROM review_queue;');
    expect(Number(countAfter[0].c)).toBe(6); // 4 unparsed + 2 held unknown_accounts
  });

  it('FEATURE E TESTS: same joint SMS on 2 devices produces 1 expense; rescanning creates 0; joint credits never in uncategorized inbox', async () => {
    // 1. Joint SMS messages
    const jointCreditMsg = {
      address: 'VM-ICICIB',
      body: 'Dear Customer, Acct XX425 is credited with Rs 20000.00 on 04-Nov-26 from PERSON TWO. UPI:111111111105-ICICI Bank.',
      date: 1700000000000,
    };
    const jointDebitMsg = {
      address: 'VM-ICICIB',
      body: 'ICICI Bank Acct XX425 debited for Rs 210.00 on 06-Nov-26; PERSON ONE credited. UPI:111111111101. Call 18002662 for dispute. SMS BLOCK 425 to 9215676766.',
      date: 1700000001000,
    };
    const jointMessages = [jointCreditMsg, jointDebitMsg];

    // Setup Device 1 & Device 2 sharing the same sync storage
    const jointStorage = createMemoryStorage();
    const db1 = await createSqljsAdapter();
    await migrate(db1);
    const writer1 = createWriter({ deviceId: 'dev_1', storage: jointStorage, db: db1 });
    await writer1.init();
    await seedIfEmpty({ writer: writer1, db: db1 });

    const db2 = await createSqljsAdapter();
    await migrate(db2);
    const writer2 = createWriter({ deviceId: 'dev_2', storage: jointStorage, db: db2 });
    await writer2.init();
    await seedIfEmpty({ writer: writer2, db: db2 });

    const jointCtx = {
      ...ctx,
      ownerNames: ['Test Owner Longname'],
    };

    // Both devices parse and import the exact same joint SMS
    const plan1 = planImport({ messages: jointMessages, ctx: jointCtx, state: rowsToState({ expenses: [] }), seenHashes: new Set(), allowlist: ['VM-ICICIB'] });
    const plan2 = planImport({ messages: jointMessages, ctx: jointCtx, state: rowsToState({ expenses: [] }), seenHashes: new Set(), allowlist: ['VM-ICICIB'] });
    expect(plan1.summary.created).toBe(2);
    expect(plan2.summary.created).toBe(2);

    await applyImport({ plan: plan1, writer: writer1, db: db1 });
    await applyImport({ plan: plan2, writer: writer2, db: db2 });

    // Sync dev_1 and dev_2
    await syncNow({ storage: jointStorage, db: db1, deviceId: 'dev_1' });
    await syncNow({ storage: jointStorage, db: db2, deviceId: 'dev_2' });
    await syncNow({ storage: jointStorage, db: db1, deviceId: 'dev_1' });

    // (1) The same joint SMS parsed on two simulated devices produces ONE expense per transaction after sync
    const expenses1 = await listExpenses(db1, { includeFixed: true });
    const expenses2 = await listExpenses(db2, { includeFixed: true });
    expect(expenses1).toHaveLength(2);
    expect(expenses2).toHaveLength(2);
    expect(expenses1.map((e) => e.id).sort()).toEqual(expenses2.map((e) => e.id).sort());

    // (2) Rescanning creates 0 new expenses
    const rawRows1 = await db1.query('SELECT hash FROM raw_messages;');
    const rescanPlan = planImport({
      messages: jointMessages,
      ctx: jointCtx,
      state: rowsToState({ expenses: expenses1 }),
      seenHashes: new Set(rawRows1.map((r) => r.hash)),
      allowlist: ['VM-ICICIB'],
    });
    expect(rescanPlan.summary.created).toBe(0);
    expect(rescanPlan.events).toHaveLength(0);

    // (3) Imported joint credits never appear in the Uncategorized inbox
    const inboxRows = await uncategorizedInbox(db1);
    const creditInInbox = inboxRows.filter((r) => r.kind === 'income' || r.kind === 'transfer' || r.direction === 'credit');
    expect(creditInInbox).toHaveLength(0);
  });
});
