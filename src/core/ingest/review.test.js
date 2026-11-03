import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { planImport, applyImport } from './pipeline.js';
import {
  assignAccountAlias,
  resolveDuplicate,
  dismissUnparsed,
  listReviewItems,
  countOpenReviewItems,
} from './review.js';
import { createSqljsAdapter } from '../db/testing/sqljsAdapter.js';
import { createMemoryStorage } from '../sync/testing/memoryStorage.js';
import { createWriter } from '../sync/writer.js';
import { syncNow, rebuildFromLogs } from '../sync/engine.js';
import { migrate } from '../db/migrations.js';
import { rowsToState, listExpenses } from '../db/index.js';
import { seedIfEmpty } from '../seed/seed.js';
import { seedBrandsIfEmpty } from '../seed/brandSeed.js';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');

describe('src/core/ingest/review.js - Review Resolutions', () => {
  let db;
  let storage;
  let writer;
  let state;
  let ctx;
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
      ownerNames: ['Test Owner'],
    };
  });

  it('Hold and alias: ICICI XX7922 held, alias assigned, reprocessed once, resolved, survives rebuild', async () => {
    const iciciPayrecvBody = fs.readFileSync(
      path.join(FIXTURES_DIR, 'icici_payrecv.txt'),
      'utf-8'
    );
    const messages = [{ address: 'BANK_SMS', body: iciciPayrecvBody, date: 1700000000000 }];

    const plan = planImport({ messages, ctx, state, seenHashes: new Set(), allowlist });
    expect(plan.summary.held).toBe(1);
    expect(plan.summary.created).toBe(0);
    await applyImport({ plan, writer, db });

    // Review item exists
    const openItems = await listReviewItems(db, 'unknown_account');
    expect(openItems).toHaveLength(1);
    expect(openItems[0].payload.digits).toBe('7922');

    // Assign alias to acc_icici_amazonpay
    const reprocessSummary = await assignAccountAlias({
      issuer: 'icici',
      digits: '7922',
      accountId: 'acc_icici_amazonpay',
      writer,
      state,
      db,
    });

    expect(reprocessSummary.created).toBe(1);

    // Verify expense created in database
    const expList = await listExpenses(db, { includeFixed: true });
    const createdExp = expList.find((e) => e.account_id === 'acc_icici_amazonpay');
    expect(createdExp).toBeDefined();
    expect(createdExp.amount_paise).toBe(3716609);
    expect(createdExp.dedupe_key).toBe('fp:acc_icici_amazonpay|3716609|20261022|payrecv');

    // Review item is resolved
    const openAfter = await listReviewItems(db, 'unknown_account');
    expect(openAfter).toHaveLength(0);

    // Second reprocess creates nothing
    const secondPlan = planImport({
      messages,
      ctx: { ...ctx, accounts: state.accounts },
      state,
      seenHashes: new Set([plan.rawRows[0].hash]),
      allowlist,
    });
    expect(secondPlan.summary.created).toBe(0);

    // Rebuild from logs gives the same result
    await rebuildFromLogs({ storage, db });
    const rebuiltExpList = await listExpenses(db, { includeFixed: true });
    expect(rebuiltExpList.some((e) => e.dedupe_key === 'fp:acc_icici_amazonpay|3716609|20261022|payrecv')).toBe(true);
  });

  it('Manual duplicate: manual expense + SMS creates both and possible_duplicate item; merge keeps manual fields', async () => {
    // 1. Create a manual expense on acc_hdfc_pixel for 360.00 dated 2026-10-27
    await writer.write('expense.created', {
      expenseId: 'exp_manual_hdfc',
      amountPaise: 36000,
      date: '2026-10-27',
      direction: 'debit',
      kind: 'spend',
      merchantRaw: 'Manual Blinkit',
      categoryId: 'cat_groceries',
      categoryLocked: 1,
      accountId: 'acc_hdfc_pixel',
      source: 'manual',
      note: 'bought coffee and bread',
    });

    // Refresh state
    const rows = {
      expenses: await db.query('SELECT * FROM expenses;'),
      categories: await db.query('SELECT * FROM categories;'),
      accounts: await db.query('SELECT * FROM accounts;'),
      brands: await db.query('SELECT * FROM brands;'),
      rules: await db.query('SELECT * FROM rules;'),
    };
    state = rowsToState(rows);

    // 2. Import HDFC SMS (hdfc_upi_1.txt, 360.00 dated 2026-10-27)
    const hdfcBody = fs.readFileSync(path.join(FIXTURES_DIR, 'hdfc_upi_1.txt'), 'utf-8');
    const messages = [{ address: 'BANK_SMS', body: hdfcBody, date: 1700000000000 }];

    const plan = planImport({ messages, ctx, state, seenHashes: new Set(), allowlist });
    expect(plan.summary.created).toBe(1);
    expect(plan.summary.possibleDuplicates).toBe(1);
    await applyImport({ plan, writer, db });

    const openDuplicates = await listReviewItems(db, 'possible_duplicate');
    expect(openDuplicates).toHaveLength(1);
    const reviewItem = openDuplicates[0];
    const importedId = reviewItem.payload.importedId;

    // Merge decision
    await resolveDuplicate({
      reviewId: reviewItem.id,
      decision: 'merge',
      keepId: importedId,
      dropId: 'exp_manual_hdfc',
      writer,
      state,
      db,
    });

    // One active expense left
    const activeExpenses = await listExpenses(db);
    expect(activeExpenses).toHaveLength(1);
    const kept = activeExpenses[0];
    expect(kept.id).toBe(importedId);
    expect(kept.note).toBe('bought coffee and bread');
    expect(kept.category_id).toBe('cat_groceries');
    expect(kept.category_locked).toBe(1);

    // Review item is marked resolved
    const countAfter = await countOpenReviewItems(db);
    expect(countAfter).toBe(0);
  });

  it('Manual duplicate with keep_both keeps both active expenses', async () => {
    await writer.write('expense.created', {
      expenseId: 'exp_manual_hdfc_2',
      amountPaise: 36000,
      date: '2026-10-27',
      direction: 'debit',
      kind: 'spend',
      merchantRaw: 'Manual Store',
      accountId: 'acc_hdfc_pixel',
      source: 'manual',
    });

    const rows = {
      expenses: await db.query('SELECT * FROM expenses;'),
      categories: await db.query('SELECT * FROM categories;'),
      accounts: await db.query('SELECT * FROM accounts;'),
      brands: await db.query('SELECT * FROM brands;'),
      rules: await db.query('SELECT * FROM rules;'),
    };
    state = rowsToState(rows);

    const hdfcBody = fs.readFileSync(path.join(FIXTURES_DIR, 'hdfc_upi_1.txt'), 'utf-8');
    const plan = planImport({
      messages: [{ address: 'BANK_SMS', body: hdfcBody, date: 1700000000000 }],
      ctx,
      state,
      seenHashes: new Set(),
      allowlist,
    });
    await applyImport({ plan, writer, db });

    const openDuplicates = await listReviewItems(db, 'possible_duplicate');
    await resolveDuplicate({
      reviewId: openDuplicates[0].id,
      decision: 'keep_both',
      writer,
      state,
      db,
    });

    const activeExpenses = await listExpenses(db);
    expect(activeExpenses).toHaveLength(2);
  });

  it('dismissUnparsed marks item resolved in review_queue and writes event', async () => {
    const unparsedBody = fs.readFileSync(path.join(FIXTURES_DIR, 'axis_debit_unknown_narration.txt'), 'utf-8');
    const plan = planImport({
      messages: [{ address: 'BANK_SMS', body: unparsedBody, date: 1700000000000 }],
      ctx,
      state,
      seenHashes: new Set(),
      allowlist,
    });
    await applyImport({ plan, writer, db });

    const items = await listReviewItems(db, 'unparsed');
    expect(items).toHaveLength(1);

    await dismissUnparsed({ reviewId: items[0].id, writer, db });
    const itemsAfter = await listReviewItems(db, 'unparsed');
    expect(itemsAfter).toHaveLength(0);
  });

  it('A review item resolved on device A does not reappear on device B after sync', async () => {
    const unparsedBody = fs.readFileSync(path.join(FIXTURES_DIR, 'icici_unknown_layout.txt'), 'utf-8');
    const plan = planImport({
      messages: [{ address: 'BANK_SMS', body: unparsedBody, date: 1700000000000 }],
      ctx,
      state,
      seenHashes: new Set(),
      allowlist,
    });
    await applyImport({ plan, writer, db });

    const itemsA = await listReviewItems(db, 'unparsed');
    expect(itemsA).toHaveLength(1);
    const reviewId = itemsA[0].id;

    // Resolve on Device A
    await dismissUnparsed({ reviewId, writer, db });

    // Sync Device A to storage
    await syncNow({ storage, db, deviceId: 'dev_A' });

    // Device B sets up and syncs
    const dbB = await createSqljsAdapter();
    await migrate(dbB);
    const writerB = createWriter({ deviceId: 'dev_B', storage, db: dbB });
    await writerB.init();
    await syncNow({ storage, db: dbB, deviceId: 'dev_B' });

    // Device B runs planImport on the same message
    const rowsB = {
      expenses: await dbB.query('SELECT * FROM expenses;'),
      categories: await dbB.query('SELECT * FROM categories;'),
      accounts: await dbB.query('SELECT * FROM accounts;'),
      brands: await dbB.query('SELECT * FROM brands;'),
      rules: await dbB.query('SELECT * FROM rules;'),
      review_queue: await dbB.query('SELECT * FROM review_queue;'),
    };
    const stateB = rowsToState(rowsB);

    const planB = planImport({
      messages: [{ address: 'BANK_SMS', body: unparsedBody, date: 1700000000000 }],
      ctx,
      state: stateB,
      seenHashes: new Set(),
      allowlist,
    });

    // Review item is not created because reviewId exists in stateB.reviews
    expect(planB.reviewItems).toHaveLength(0);
  });
});
