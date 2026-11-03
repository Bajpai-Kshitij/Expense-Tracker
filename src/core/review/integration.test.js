import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { planImport, applyImport } from '../ingest/pipeline.js';
import {
  assignAccountAlias,
  resolveDuplicate,
  dismissUnparsed,
  listReviewItems,
  countOpenReviewItems,
} from '../ingest/review.js';
import {
  groupReviewItems,
  describeUnknownAccount,
  describeDuplicate,
  describeUnparsed,
  reviewBadgeCount,
} from './viewModels.js';
import { createSqljsAdapter } from '../db/testing/sqljsAdapter.js';
import { createMemoryStorage } from '../sync/testing/memoryStorage.js';
import { createWriter } from '../sync/writer.js';
import { migrate } from '../db/migrations.js';
import { rowsToState } from '../db/index.js';
import { seedIfEmpty } from '../seed/seed.js';
import { seedBrandsIfEmpty } from '../seed/brandSeed.js';

const FIXTURES_DIR = path.resolve(__dirname, '../ingest/fixtures');

describe('src/core/review/integration.test.js - End-to-End Review Queue with SQL.js', () => {
  let db;
  let storage;
  let writer;
  let state;
  let ctx;
  const allowlist = ['BANK_SMS', 'VM-HDFCBK', 'BZ-ICICIB'];

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
      ownerNames: ['Test User'],
    };
  });

  it('runs planImport/applyImport, evaluates viewModels on stored items, and resolves each item updating counts', async () => {
    // 1. First write a manual expense that will match candidate for duplicate
    await writer.write('expense.created', {
      expenseId: 'e_manual_test',
      amountPaise: 21000,
      date: '2026-10-29',
      direction: 'debit',
      kind: 'spend',
      merchantRaw: 'SWIGGY PVT',
      brand: 'Swiggy',
      categoryId: 'cat_food',
      categoryLocked: 0,
      accountId: 'acc_axis_flipkart',
      mode: 'card',
      source: 'manual',
      refNo: null,
      dedupeKey: 'manual_21000',
      note: 'dinner',
      status: 'active',
    });

    // Refresh state
    state = rowsToState({
      expenses: await db.query('SELECT * FROM expenses;'),
      categories: await db.query('SELECT * FROM categories;'),
      accounts: await db.query('SELECT * FROM accounts;'),
      brands: await db.query('SELECT * FROM brands;'),
      rules: await db.query('SELECT * FROM rules;'),
      review_queue: await db.query('SELECT * FROM review_queue;'),
    });

    // 2. Prepare small inbox:
    // - Unknown account: ICICI XX7922
    const iciciPayrecvBody = fs.readFileSync(
      path.join(FIXTURES_DIR, 'icici_payrecv.txt'),
      'utf-8'
    );
    // - Unparsed: Axis debit unknown narration
    const unparsedBody = fs.readFileSync(
      path.join(FIXTURES_DIR, 'axis_debit_unknown_narration.txt'),
      'utf-8'
    );
    // - Duplicate candidate: Axis spend single on acc_axis_flipkart (3765) for 423.00
    const axisSpendBody = fs.readFileSync(
      path.join(FIXTURES_DIR, 'axis_spend_single_1.txt'),
      'utf-8'
    );

    const messages = [
      { id: '1', address: 'BZ-ICICIB', body: iciciPayrecvBody, date: 1768896000000 },
      { id: '2', address: 'BANK_SMS', body: unparsedBody, date: 1768897000000 },
      { id: '3', address: 'BANK_SMS', body: axisSpendBody, date: 1768898000000 },
    ];

    const plan = planImport({
      messages,
      ctx,
      state,
      seenHashes: new Set(),
      allowlist,
      now: 1768899000000,
    });

    await applyImport({ plan, writer, db });

    // 3. Query stored review items
    const storedItems = await listReviewItems(db);
    expect(storedItems.length).toBe(3);

    // 4. Test viewModels
    const grouped = groupReviewItems(storedItems);
    expect(grouped.unknownAccounts).toHaveLength(1);
    expect(grouped.unparsed).toHaveLength(1);
    expect(grouped.possibleDuplicates).toHaveLength(1);
    expect(reviewBadgeCount(storedItems)).toBe(3);

    // ViewModel descriptions
    const unknownItem = grouped.unknownAccounts[0];
    const descUnknown = describeUnknownAccount(unknownItem, 1, ctx.accounts);
    expect(descUnknown.title).toContain('ICICI');
    expect(descUnknown.title).toContain('7922');
    expect(descUnknown.subtitle).toBe('1 message waiting');
    expect(descUnknown.suggestions.length).toBeGreaterThan(0);

    const unparsedItem = grouped.unparsed[0];
    const descUnparsed = describeUnparsed(unparsedItem);
    expect(descUnparsed.preview.length).toBeLessThanOrEqual(60);

    const dupItem = grouped.possibleDuplicates[0];
    const allExpenses = await db.query('SELECT * FROM expenses;');
    const descDup = describeDuplicate(dupItem, allExpenses);
    expect(descDup.stale).toBe(false);
    expect(descDup.imported).toBeDefined();
    expect(descDup.manual).toHaveLength(1);

    // 5. Resolve each type one by one and check open counts update
    // a. Resolve unknown account with alias
    await assignAccountAlias({
      accountId: 'acc_icici_coral',
      issuer: 'icici',
      digits: '7922',
      writer,
      state,
      db,
    });

    let openCount = await countOpenReviewItems(db);
    expect(openCount).toBe(2);

    // b. Resolve duplicate by merging
    await resolveDuplicate({
      reviewId: dupItem.id,
      decision: 'merge',
      keepId: descDup.imported.id,
      dropId: 'e_manual_test',
      writer,
      state,
      db,
    });

    openCount = await countOpenReviewItems(db);
    expect(openCount).toBe(1);

    // c. Dismiss unparsed
    await dismissUnparsed({
      reviewId: unparsedItem.id,
      writer,
      db,
    });

    openCount = await countOpenReviewItems(db);
    expect(openCount).toBe(0);

    const finalOpen = await listReviewItems(db);
    expect(finalOpen).toHaveLength(0);
  });
});
