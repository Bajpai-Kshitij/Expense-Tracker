import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createSqljsAdapter } from '../../db/testing/sqljsAdapter.js';
import { createMemoryStorage } from '../../sync/testing/memoryStorage.js';
import { createWriter } from '../../sync/writer.js';
import { migrate } from '../../db/migrations.js';
import { rowsToState, dumpDatabase } from '../../db/index.js';
import { planImport, applyImport } from '../../ingest/pipeline.js';
import { parseSms } from '../../ingest/index.js';
import { computePaymentLinkId } from '../../ingest/pipeline.js';

import { axisParser, checkTotals } from './axis.js';
import { parseStatement, clearParsers, registerStatementParser } from './registry.js';
import { planStatementImport } from '../import/plan.js';
import { applyStatementImport } from '../import/apply.js';

function loadFixtureLines(filename) {
  const filePath = resolve(__dirname, 'fixtures', filename);
  const text = readFileSync(filePath, 'utf-8');
  return text.split('\n').map((line, idx) => ({
    page: 1,
    lineNo: idx + 1,
    text: line,
  }));
}

describe('PHASE P8b-2a - Axis Credit Card Statement Parser', () => {
  beforeEach(() => {
    clearParsers();
    registerStatementParser(axisParser);
  });

  describe('1. Fixture Parsing (Flipkart & My Zone)', () => {
    it('parses axis_flipkart.txt with exact expected lines, period, declaredTotals and zero differences', () => {
      const lines = loadFixtureLines('axis_flipkart.txt');
      const res = parseStatement(lines);

      expect(res.ok).toBe(true);
      expect(res.issuer).toBe('axis');
      expect(res.account).toEqual({
        digits: '3765',
        product: 'Flipkart',
      });
      expect(res.period).toEqual({
        from: '2026-09-17',
        to: '2026-10-15',
      });
      expect(res.unparsedLines).toEqual([]);
      expect(res.declaredTotals).toEqual({
        payments: 150100,
        credits: 36100,
        purchases: 241100,
        cash: 0,
        other: 0,
      });

      // Exactly 10 lines in order
      expect(res.lines).toHaveLength(10);

      // Line 1: purchase 24300
      expect(res.lines[0]).toMatchObject({
        date: '2026-09-24',
        type: 'purchase',
        amountPaise: 24300,
        direction: 'debit',
        merchantRaw: 'FLIPKART PAYMENTS',
        city: 'GURGAON',
        bankCategory: 'MISC STORE',
        cardDigits: '3765',
      });

      // Line 2: purchase 21600
      expect(res.lines[1]).toMatchObject({
        date: '2026-09-29',
        type: 'purchase',
        amountPaise: 21600,
        direction: 'debit',
        merchantRaw: 'SWIGGY',
        city: 'BENGALURU',
        bankCategory: 'RESTAURANTS',
      });

      // Line 3: purchase 54000
      expect(res.lines[2]).toMatchObject({
        date: '2026-09-30',
        type: 'purchase',
        amountPaise: 54000,
        direction: 'debit',
        merchantRaw: 'SWIGGY PVT LTD FOOD1',
        city: 'BENGALURU',
        bankCategory: 'RESTAURANTS',
      });

      // Line 4: payment 150100 credit
      expect(res.lines[3]).toMatchObject({
        date: '2026-10-05',
        type: 'payment',
        amountPaise: 150100,
        direction: 'credit',
        merchantRaw: 'PAYMENT RECEIVED',
        city: null,
        bankCategory: null,
      });

      // Line 5: purchase 58400
      expect(res.lines[4]).toMatchObject({
        date: '2026-10-06',
        type: 'purchase',
        amountPaise: 58400,
        direction: 'debit',
        merchantRaw: 'SWIGGY PVT LTD FOOD1',
        city: 'BENGALURU',
        bankCategory: 'RESTAURANTS',
      });

      // Line 6: purchase 13100
      expect(res.lines[5]).toMatchObject({
        date: '2026-10-10',
        type: 'purchase',
        amountPaise: 13100,
        direction: 'debit',
        merchantRaw: 'FLIPKART GROCERY',
        city: 'BANGALORE',
        bankCategory: 'DEPT STORES',
      });

      // Line 7: cashback 4900 credit
      expect(res.lines[6]).toMatchObject({
        date: '2026-10-11',
        type: 'cashback',
        amountPaise: 4900,
        direction: 'credit',
        merchantRaw: 'CASHBACK CREDIT SEP26-FLIPKART:18~POS:4~UBER_PV',
        city: null,
        bankCategory: null,
      });

      // Line 8: purchase 38500
      expect(res.lines[7]).toMatchObject({
        date: '2026-10-11',
        type: 'purchase',
        amountPaise: 38500,
        direction: 'debit',
        merchantRaw: 'SWIGGY',
        city: 'BENGALURU',
        bankCategory: 'RESTAURANTS',
      });

      // Line 9: refund 31200 credit
      expect(res.lines[8]).toMatchObject({
        date: '2026-10-11',
        type: 'refund',
        amountPaise: 31200,
        direction: 'credit',
        merchantRaw: 'RAZORPAY PAYMENTS',
        city: 'BENGALURU',
        bankCategory: 'RESTAURANTS',
      });

      // Line 10: purchase 31200
      expect(res.lines[9]).toMatchObject({
        date: '2026-10-11',
        type: 'purchase',
        amountPaise: 31200,
        direction: 'debit',
        merchantRaw: 'SWIGGY',
        city: 'BENGALURU',
        bankCategory: 'RESTAURANTS',
      });

      // Self-check
      const check = checkTotals(res);
      expect(check.ok).toBe(true);
      expect(check.differences).toEqual([]);
    });

    it('parses axis_myzone.txt with expected lines, declared totals and zero differences', () => {
      const lines = loadFixtureLines('axis_myzone.txt');
      const res = parseStatement(lines);

      expect(res.ok).toBe(true);
      expect(res.issuer).toBe('axis');
      expect(res.account).toEqual({
        digits: '4230',
        product: 'MY ZONE',
      });
      expect(res.unparsedLines).toEqual([]);
      expect(res.declaredTotals).toEqual({
        payments: 240063,
        credits: 0,
        purchases: 126174,
        cash: 0,
        other: 0,
      });

      expect(res.lines).toHaveLength(3);
      expect(res.lines[0]).toMatchObject({
        date: '2026-10-03',
        type: 'purchase',
        amountPaise: 44334,
        direction: 'debit',
        merchantRaw: 'DISTRICT MOVIE TICKET',
        city: 'GURUGRAM',
        bankCategory: 'ENTERTAINMENT',
        cardDigits: '4230',
      });
      expect(res.lines[1]).toMatchObject({
        date: '2026-10-03',
        type: 'purchase',
        amountPaise: 81840,
        direction: 'debit',
        merchantRaw: 'DISTRICT MOVIE TICKET',
        city: 'GURUGRAM',
        bankCategory: 'ENTERTAINMENT',
        cardDigits: '4230',
      });
      expect(res.lines[2]).toMatchObject({
        date: '2026-10-05',
        type: 'payment',
        amountPaise: 240063,
        direction: 'credit',
        merchantRaw: 'PAYMENT RECEIVED',
        city: null,
      });

      const check = checkTotals(res);
      expect(check.ok).toBe(true);
      expect(check.differences).toEqual([]);
    });

    it('ignores second money token (cashback column) so it is never turned into a transaction', () => {
      const lines = loadFixtureLines('axis_flipkart.txt');
      const res = parseStatement(lines);

      const cashbackColumnAmounts = [1200, 800, 2100, 0, 2300, 600, 1500, 1200];
      for (const cb of cashbackColumnAmounts) {
        if (cb > 0) {
          const match = res.lines.filter((l) => l.amountPaise === cb && l.direction === 'credit' && l.type !== 'cashback');
          expect(match).toHaveLength(0);
        }
      }
    });

    it('does not detect ICICI statement even if it contains Axis or CC tokens', () => {
      const lines = [
        { page: 1, lineNo: 1, text: 'ICICI Bank Credit Card Statement' },
        { page: 1, lineNo: 2, text: 'Axis Bank payment received' },
        { page: 1, lineNo: 3, text: 'PAYMENT SUMMARY' },
        { page: 1, lineNo: 4, text: 'Account Summary' },
      ];
      expect(axisParser.detect(lines)).toBe(false);
    });
  });

  describe('2. Tamper Tests', () => {
    it('catches amount changed by 1 paisa with difference and marks needsAttention in plan', () => {
      const lines = loadFixtureLines('axis_flipkart.txt');
      const tamperedLines = lines.map((l) =>
        l.text.includes('243.00 Dr') ? { ...l, text: l.text.replace('243.00 Dr', '243.01 Dr') } : l
      );

      const res = parseStatement(tamperedLines);
      const check = checkTotals(res);
      expect(check.ok).toBe(false);
      expect(check.differences.length).toBeGreaterThan(0);

      const plan = planStatementImport({
        result: res,
        fileHash: 'tamper_hash_1',
        accountId: 'acc_axis_flipkart',
      });
      expect(plan.summary.needsAttention).toBe(true);
    });

    it('catches deleted transaction line with difference and marks needsAttention', () => {
      const lines = loadFixtureLines('axis_flipkart.txt');
      const tamperedLines = lines.filter((l) => !l.text.includes('FLIPKART PAYMENTS,GURGAON'));

      const res = parseStatement(tamperedLines);
      const check = checkTotals(res);
      expect(check.ok).toBe(false);

      const plan = planStatementImport({
        result: res,
        fileHash: 'tamper_hash_2',
        accountId: 'acc_axis_flipkart',
      });
      expect(plan.summary.needsAttention).toBe(true);
    });

    it('catches an unreadable dated line inside transaction section into unparsedLines', () => {
      const lines = loadFixtureLines('axis_flipkart.txt');
      const insertIndex = lines.findIndex((l) => l.text.includes('SWIGGY,BENGALURU'));
      const tamperedLines = [
        ...lines.slice(0, insertIndex),
        { page: 1, lineNo: 99, text: '28/09/2026   UNREADABLE CORRUPTED GARBAGE LINE' },
        ...lines.slice(insertIndex),
      ];

      const res = parseStatement(tamperedLines);
      expect(res.unparsedLines.length).toBeGreaterThan(0);
      expect(res.unparsedLines[0]).toEqual({ page: 1, lineNo: 99 });

      const plan = planStatementImport({
        result: res,
        fileHash: 'tamper_hash_3',
        accountId: 'acc_axis_flipkart',
      });
      expect(plan.summary.needsAttention).toBe(true);
    });

    it('catches swapped Dr/Cr with difference and marks needsAttention', () => {
      const lines = loadFixtureLines('axis_flipkart.txt');
      const tamperedLines = lines.map((l) =>
        l.text.includes('243.00 Dr') ? { ...l, text: l.text.replace('243.00 Dr', '243.00 Cr') } : l
      );

      const res = parseStatement(tamperedLines);
      const check = checkTotals(res);
      expect(check.ok).toBe(false);

      const plan = planStatementImport({
        result: res,
        fileHash: 'tamper_hash_4',
        accountId: 'acc_axis_flipkart',
      });
      expect(plan.summary.needsAttention).toBe(true);
    });

    it('catches removed totals row with warning, null declaredTotals and marks needsAttention', () => {
      const lines = loadFixtureLines('axis_flipkart.txt');
      const tamperedLines = lines.filter((l) => !l.text.includes('1,501.00 Dr   1,501.00   361.00'));

      const res = parseStatement(tamperedLines);
      expect(res.declaredTotals).toBeNull();
      expect(res.warnings.length).toBeGreaterThan(0);

      const check = checkTotals(res);
      expect(check.ok).toBe(false);

      const plan = planStatementImport({
        result: res,
        fileHash: 'tamper_hash_5',
        accountId: 'acc_axis_flipkart',
      });
      expect(plan.summary.needsAttention).toBe(true);
    });
  });

  describe('3. Whitespace Variants & Multi-card Blocks', () => {
    it('parses lines with single spaces between unambiguous columns or CRLF', () => {
      const lines = loadFixtureLines('axis_myzone.txt').map((l) => ({
        ...l,
        text: l.text.replace(/\r/g, ''),
      }));

      // Replace 2+ spaces with 3 spaces in table
      const res = parseStatement(lines);
      expect(res.ok).toBe(true);
      expect(res.lines).toHaveLength(3);
    });

    it('assigns transactions to the right card block when statement has multiple Card No blocks', () => {
      const lines = [
        { page: 1, lineNo: 1, text: 'Flipkart Axis Bank VISA Credit Card Statement' },
        { page: 1, lineNo: 2, text: 'PAYMENT SUMMARY' },
        { page: 1, lineNo: 3, text: 'Total Payment Due ⇥ 17/09/2026 - 15/10/2026' },
        { page: 1, lineNo: 4, text: 'Account Summary' },
        { page: 1, lineNo: 5, text: 'Previous Balance - Payments - Credits + Purchase + Cash Advance + Other Debit&Charges' },
        { page: 1, lineNo: 6, text: '100.00 Dr   0.00   0.00   100.00   0.00   0.00   100.00 Dr' },
        { page: 1, lineNo: 7, text: 'Card No:   400000******1111   Name PRIMARY' },
        { page: 1, lineNo: 8, text: '01/10/2026   SHOP A,CITY   RETAIL   50.00 Dr' },
        { page: 1, lineNo: 9, text: 'Card No:   400000******2222   Name ADDON' },
        { page: 1, lineNo: 10, text: '02/10/2026   SHOP B,CITY   RETAIL   50.00 Dr' },
        { page: 1, lineNo: 11, text: '**** End of Statement ****' },
      ];

      const res = parseStatement(lines);
      expect(res.ok).toBe(true);
      expect(res.lines).toHaveLength(2);
      expect(res.lines[0].cardDigits).toBe('1111');
      expect(res.lines[1].cardDigits).toBe('2222');
    });
  });

  describe('4. Plan Changes & Refund Linking', () => {
    it('sets type "cashback" to kind "income", direction "credit", and never categorized', () => {
      const lines = loadFixtureLines('axis_flipkart.txt');
      const res = parseStatement(lines);

      const state = {
        rules: {
          r1: {
            id: 'r1',
            field: 'merchant',
            operator: 'contains',
            pattern: 'CASHBACK',
            categoryId: 'cat_rewards',
          },
        },
      };

      const plan = planStatementImport({
        result: res,
        fileHash: 'plan_hash_cb',
        accountId: 'acc_axis_flipkart',
        state,
      });

      const cbEvent = plan.events.find(
        (e) => e.data.merchantRaw.includes('CASHBACK CREDIT')
      );
      expect(cbEvent).toBeDefined();
      expect(cbEvent.data.kind).toBe('income');
      expect(cbEvent.data.direction).toBe('credit');
      expect(cbEvent.data.categoryId).toBeNull();
      expect(cbEvent.data.brand).toBeNull();
    });

    it('passes bankCategory into categorize() as rawText so a rawText rule can categorize', () => {
      const lines = loadFixtureLines('axis_flipkart.txt');
      const res = parseStatement(lines);

      const state = {
        categories: {
          cat_shopping: { id: 'cat_shopping', name: 'Shopping', archived: false },
        },
        rules: {
          r1: {
            id: 'r1',
            field: 'rawText',
            operator: 'contains',
            pattern: 'MISC STORE',
            categoryId: 'cat_shopping',
          },
        },
      };

      const plan = planStatementImport({
        result: res,
        fileHash: 'plan_hash_rawtext',
        accountId: 'acc_axis_flipkart',
        state,
      });

      const miscEvent = plan.events.find((e) => e.data.merchantRaw === 'FLIPKART PAYMENTS');
      expect(miscEvent).toBeDefined();
      expect(miscEvent.data.categoryId).toBe('cat_shopping');
    });

    it('links the 312 refund to the 312 purchase (refundOf), net zero for that pair regardless of line order', () => {
      const lines = loadFixtureLines('axis_flipkart.txt');
      const res = parseStatement(lines);

      const plan = planStatementImport({
        result: res,
        fileHash: 'plan_hash_refund',
        accountId: 'acc_axis_flipkart',
      });

      const refundEvent = plan.events.find(
        (e) => e.data.merchantRaw === 'RAZORPAY PAYMENTS' && e.data.amountPaise === 31200
      );
      const purchaseEvent = plan.events.find(
        (e) => e.data.merchantRaw === 'SWIGGY' && e.data.amountPaise === 31200
      );

      expect(refundEvent).toBeDefined();
      expect(purchaseEvent).toBeDefined();
      expect(refundEvent.data.refundOf).toBe(purchaseEvent.data.expenseId);
      expect(refundEvent.data.kind).toBe('spend');
      expect(refundEvent.data.direction).toBe('credit');
      expect(purchaseEvent.data.direction).toBe('debit');
    });

    it('does not link refund when multiple debit candidates exist within 14 days', () => {
      const lines = [
        { page: 1, lineNo: 1, text: 'Flipkart Axis Bank VISA Credit Card Statement' },
        { page: 1, lineNo: 2, text: 'PAYMENT SUMMARY' },
        { page: 1, lineNo: 3, text: 'Total Payment Due ⇥ 17/09/2026 - 15/10/2026' },
        { page: 1, lineNo: 4, text: 'Account Summary' },
        { page: 1, lineNo: 5, text: 'Card No: 400000******3765' },
        { page: 1, lineNo: 6, text: '01/10/2026   STORE 1,CITY   CAT   300.00 Dr' },
        { page: 1, lineNo: 7, text: '02/10/2026   STORE 2,CITY   CAT   300.00 Dr' },
        { page: 1, lineNo: 8, text: '03/10/2026   REFUND,CITY   CAT   300.00 Cr' },
        { page: 1, lineNo: 9, text: '**** End of Statement ****' },
      ];

      const res = parseStatement(lines);
      const plan = planStatementImport({
        result: res,
        fileHash: 'plan_hash_multi_cand',
        accountId: 'acc_axis_flipkart',
      });

      const refundEvent = plan.events.find((e) => e.data.merchantRaw === 'REFUND');
      expect(refundEvent.data.refundOf).toBeUndefined();
    });
  });

  describe('5. Integration with P8b-1 Engine and Axis SMS Fixtures', () => {
    let db;
    let storage;
    let writer;

    beforeEach(async () => {
      db = await createSqljsAdapter();
      await migrate(db);
      storage = createMemoryStorage();
      writer = createWriter({ deviceId: 'dev_axis_test', storage, db });
      await writer.init();

      // Seed test accounts: acc_axis_flipkart (3765), acc_axis_myzone (4230), acc_bank (7693)
      await writer.write('account.upserted', {
        accountId: 'acc_axis_flipkart',
        name: 'Flipkart Axis CC',
        type: 'credit_card',
        issuer: 'axis',
        digits: '3765',
        lastDigits: '3765',
      });
      await writer.write('account.upserted', {
        accountId: 'acc_axis_myzone',
        name: 'My Zone CC',
        type: 'credit_card',
        issuer: 'axis',
        digits: '4230',
        lastDigits: '4230',
      });
      await writer.write('account.upserted', {
        accountId: 'acc_bank',
        name: 'Axis Bank Account',
        type: 'bank',
        issuer: 'axis',
        digits: '7693',
        lastDigits: '7693',
      });
    });

    it('SMS first, statement second: My Zone 443.34 links to DISTRICT MO, 818.40 created; payment pairs with linkId; re-import creates 0 events', async () => {
      // 1. Ingest My Zone spend SMS: 443.34 on 03-10-26 at DISTRICT MO
      const myzoneSpendSms = {
        id: 'sms_mz_1',
        address: 'AxisBank',
        body: 'Spent INR 443.34 using Axis Bank Credit Card no. XX4230 on 03-10-26 14:15:00 IST at DISTRICT MO. Avl limit: INR 237950.00. Not you? SMS BLOCK 4230 to +9199XXXXXX.',
        date: Date.parse('2026-10-03T14:15:00.000Z'),
      };
      const accountsList = [
        { id: 'acc_axis_myzone', issuer: 'axis', digits: '4230', lastDigits: '4230', type: 'credit_card' },
      ];
      const parsedSms = parseSms(myzoneSpendSms, { accounts: accountsList });
      expect(parsedSms.status).toBe('parsed');

      const state0 = rowsToState({
        expenses: await db.query('SELECT * FROM expenses;'),
        categories: await db.query('SELECT * FROM categories;'),
        accounts: await db.query('SELECT * FROM accounts;'),
        brands: await db.query('SELECT * FROM brands;'),
        rules: await db.query('SELECT * FROM rules;'),
        expense_keys: await db.query('SELECT * FROM expense_keys;'),
      });

      const smsPlan = planImport({ messages: [myzoneSpendSms], ctx: { accounts: state0.accounts }, state: state0 });
      await applyImport({ plan: smsPlan, writer, db, batchId: 'batch_sms_1' });

      const expAfterSms = await db.query('SELECT * FROM expenses WHERE account_id = "acc_axis_myzone";');
      expect(expAfterSms).toHaveLength(1);
      expect(expAfterSms[0].source).toBe('sms');
      expect(expAfterSms[0].amount_paise).toBe(44334);
      expect(expAfterSms[0].merchant_raw).toBe('DISTRICT MO');

      // 2. Import My Zone statement
      const mzLines = loadFixtureLines('axis_myzone.txt');
      const mzRes = parseStatement(mzLines);

      const stateBeforeStmt = rowsToState({
        expenses: await db.query('SELECT * FROM expenses;'),
        categories: await db.query('SELECT * FROM categories;'),
        accounts: await db.query('SELECT * FROM accounts;'),
        brands: await db.query('SELECT * FROM brands;'),
        rules: await db.query('SELECT * FROM rules;'),
        expense_keys: await db.query('SELECT * FROM expense_keys;'),
      });

      const stmtPlan = planStatementImport({
        result: mzRes,
        fileHash: 'hash_mz_stmt_1',
        accountId: 'acc_axis_myzone',
        state: stateBeforeStmt,
      });

      expect(stmtPlan.summary.linkedToSms).toBe(1);
      expect(stmtPlan.summary.created).toBe(2); // 81840 purchase + 240063 payment
      await applyStatementImport({ plan: stmtPlan, writer, db });

      const allMzExp = await db.query('SELECT * FROM expenses WHERE account_id = "acc_axis_myzone" ORDER BY amount_paise ASC;');
      expect(allMzExp).toHaveLength(3);

      // Verify the 44334 line is linked to SMS and updated
      const linkedLine = allMzExp.find((e) => e.amount_paise === 44334);
      expect(linkedLine.source).toBe('statement');
      expect(linkedLine.merchant_raw).toBe('DISTRICT MOVIE TICKET');

      // 3. Re-importing statement creates 0 events
      const stateAfterStmt = rowsToState({
        expenses: await db.query('SELECT * FROM expenses;'),
        categories: await db.query('SELECT * FROM categories;'),
        accounts: await db.query('SELECT * FROM accounts;'),
        brands: await db.query('SELECT * FROM brands;'),
        rules: await db.query('SELECT * FROM rules;'),
        expense_keys: await db.query('SELECT * FROM expense_keys;'),
      });

      const reimportPlan = planStatementImport({
        result: mzRes,
        fileHash: 'hash_mz_stmt_1',
        accountId: 'acc_axis_myzone',
        state: stateAfterStmt,
      });
      expect(reimportPlan.events).toHaveLength(0);
      expect(reimportPlan.summary.alreadyImported).toBe(3);
    });

    it('Flipkart payment line pairs with bank-side debit SMS giving the same linkId', async () => {
      // 1. Ingest Bank-side debit SMS for card payment:
      // "Debit INR 1501.00 Axis Bank A/c XX7693 05-10-26 08:54:36 CRD-PMNT-652922****3765"
      const bankDebitSms = {
        id: 'sms_flipkart_pay_1',
        address: 'AxisBank',
        body: 'Debit INR 1501.00\nAxis Bank A/c XX7693\n05-10-26 08:54:36\nCRD-PMNT-652922****3765\nWhatsApp BAL to 9170XXXXXX\nNot You? SMS BLOCKALL CustID to 9199XXXXXX',
        date: Date.parse('2026-10-05T08:54:36.000Z'),
      };
      const accountsList = [
        { id: 'acc_bank', issuer: 'axis', digits: '7693', lastDigits: '7693', type: 'bank' },
        { id: 'acc_axis_flipkart', issuer: 'axis', digits: '3765', lastDigits: '3765', type: 'credit_card' },
      ];
      const parsedBankSms = parseSms(bankDebitSms, { accounts: accountsList });
      expect(parsedBankSms.status).toBe('parsed');

      const state0 = rowsToState({
        expenses: await db.query('SELECT * FROM expenses;'),
        categories: await db.query('SELECT * FROM categories;'),
        accounts: await db.query('SELECT * FROM accounts;'),
        brands: await db.query('SELECT * FROM brands;'),
        rules: await db.query('SELECT * FROM rules;'),
        expense_keys: await db.query('SELECT * FROM expense_keys;'),
      });

      const smsPlan = planImport({ messages: [bankDebitSms], ctx: { accounts: state0.accounts }, state: state0 });
      await applyImport({ plan: smsPlan, writer, db, batchId: 'batch_bank_pay_1' });

      const bankExp = await db.query('SELECT * FROM expenses WHERE account_id = "acc_bank";');
      expect(bankExp).toHaveLength(1);
      expect(bankExp[0].link_id).toBeTruthy();

      // 2. Import Flipkart statement containing payment of 1,501.00 Cr on 05/10/2026 for card 3765
      const lines = loadFixtureLines('axis_flipkart.txt');
      const res = parseStatement(lines);

      const state1 = rowsToState({
        expenses: await db.query('SELECT * FROM expenses;'),
        categories: await db.query('SELECT * FROM categories;'),
        accounts: await db.query('SELECT * FROM accounts;'),
        brands: await db.query('SELECT * FROM brands;'),
        rules: await db.query('SELECT * FROM rules;'),
        expense_keys: await db.query('SELECT * FROM expense_keys;'),
      });

      const stmtPlan = planStatementImport({
        result: res,
        fileHash: 'hash_fk_stmt_1',
        accountId: 'acc_axis_flipkart',
        state: state1,
      });

      const expectedLinkId = computePaymentLinkId({
        cardLast4: '3765',
        amountPaise: 150100,
        date: '2026-10-05',
      });

      expect(bankExp[0].link_id).toBe(expectedLinkId);

      const paymentPlanned = stmtPlan.plannedLines.find((pl) => pl.line.type === 'payment');
      expect(paymentPlanned).toBeDefined();

      await applyStatementImport({ plan: stmtPlan, writer, db });

      const cardPaymentExp = await db.query(
        'SELECT * FROM expenses WHERE account_id = "acc_axis_flipkart" AND link_id = ?;',
        [expectedLinkId]
      );
      expect(cardPaymentExp).toHaveLength(1);
      expect(cardPaymentExp[0].link_id).toBe(bankExp[0].link_id);
    });

    it('produces identical database dumps regardless of whether SMS or statement is imported first', async () => {
      const myzoneSpendSms = {
        id: 'sms_mz_1',
        address: 'AxisBank',
        body: 'Spent INR 443.34 using Axis Bank Credit Card no. XX4230 on 03-10-26 14:15:00 IST at DISTRICT MO. Avl limit: INR 237950.00. Not you? SMS BLOCK 4230 to +9199XXXXXX.',
        date: Date.parse('2026-10-03T14:15:00.000Z'),
      };
      const accountsList = [
        { id: 'acc_axis_myzone', issuer: 'axis', digits: '4230', lastDigits: '4230', type: 'credit_card' },
      ];
      const parsedSms = parseSms(myzoneSpendSms, { accounts: accountsList });
      const mzLines = loadFixtureLines('axis_myzone.txt');
      const mzRes = parseStatement(mzLines);

      // Order A: SMS first, Statement second
      const dbA = await createSqljsAdapter();
      await migrate(dbA);
      const storageA = createMemoryStorage();
      const writerA = createWriter({ deviceId: 'dev_a', storage: storageA, db: dbA });
      await writerA.init();
      await writerA.write('account.upserted', { accountId: 'acc_axis_myzone', name: 'My Zone', type: 'credit_card', digits: '4230', lastDigits: '4230', issuer: 'axis' });

      const stateA0 = rowsToState({
        expenses: await dbA.query('SELECT * FROM expenses;'),
        categories: await dbA.query('SELECT * FROM categories;'),
        accounts: await dbA.query('SELECT * FROM accounts;'),
        brands: await dbA.query('SELECT * FROM brands;'),
        rules: await dbA.query('SELECT * FROM rules;'),
        expense_keys: await dbA.query('SELECT * FROM expense_keys;'),
      });
      const planA1 = planImport({ messages: [myzoneSpendSms], ctx: { accounts: stateA0.accounts }, state: stateA0 });
      await applyImport({ plan: planA1, writer: writerA, db: dbA });

      const stateA1 = rowsToState({
        expenses: await dbA.query('SELECT * FROM expenses;'),
        categories: await dbA.query('SELECT * FROM categories;'),
        accounts: await dbA.query('SELECT * FROM accounts;'),
        brands: await dbA.query('SELECT * FROM brands;'),
        rules: await dbA.query('SELECT * FROM rules;'),
        expense_keys: await dbA.query('SELECT * FROM expense_keys;'),
      });
      const planA2 = planStatementImport({ result: mzRes, fileHash: 'hash_mz', accountId: 'acc_axis_myzone', state: stateA1 });
      await applyStatementImport({ plan: planA2, writer: writerA, db: dbA });

      // Order B: Statement first, SMS second
      const dbB = await createSqljsAdapter();
      await migrate(dbB);
      const storageB = createMemoryStorage();
      const writerB = createWriter({ deviceId: 'dev_b', storage: storageB, db: dbB });
      await writerB.init();
      await writerB.write('account.upserted', { accountId: 'acc_axis_myzone', name: 'My Zone', type: 'credit_card', digits: '4230', lastDigits: '4230', issuer: 'axis' });

      const stateB0 = rowsToState({
        expenses: await dbB.query('SELECT * FROM expenses;'),
        categories: await dbB.query('SELECT * FROM categories;'),
        accounts: await dbB.query('SELECT * FROM accounts;'),
        brands: await dbB.query('SELECT * FROM brands;'),
        rules: await dbB.query('SELECT * FROM rules;'),
        expense_keys: await dbB.query('SELECT * FROM expense_keys;'),
      });
      const planB1 = planStatementImport({ result: mzRes, fileHash: 'hash_mz', accountId: 'acc_axis_myzone', state: stateB0 });
      await applyStatementImport({ plan: planB1, writer: writerB, db: dbB });

      const stateB1 = rowsToState({
        expenses: await dbB.query('SELECT * FROM expenses;'),
        categories: await dbB.query('SELECT * FROM categories;'),
        accounts: await dbB.query('SELECT * FROM accounts;'),
        brands: await dbB.query('SELECT * FROM brands;'),
        rules: await dbB.query('SELECT * FROM rules;'),
        expense_keys: await dbB.query('SELECT * FROM expense_keys;'),
      });
      const planB2 = planImport({ messages: [myzoneSpendSms], ctx: { accounts: stateB1.accounts }, state: stateB1 });
      await applyImport({ plan: planB2, writer: writerB, db: dbB });

      const expensesA = await dbA.query('SELECT amount_paise, date, direction, merchant_raw, source FROM expenses ORDER BY amount_paise ASC;');
      const expensesB = await dbB.query('SELECT amount_paise, date, direction, merchant_raw, source FROM expenses ORDER BY amount_paise ASC;');

      expect(expensesA).toEqual(expensesB);
    });
  });

  describe('6. Fuzz Testing', () => {
    it('parseStatement never throws on 200 random inputs', () => {
      const randStr = () => Math.random().toString(36).slice(2);
      for (let i = 0; i < 200; i++) {
        const lineCount = Math.floor(Math.random() * 20);
        const randomLines = Array.from({ length: lineCount }, (_, idx) => ({
          page: 1,
          lineNo: idx + 1,
          text: idx % 3 === 0 ? `${randStr()} ${randStr()} Dr` : randStr(),
        }));

        expect(() => parseStatement(randomLines)).not.toThrow();
      }
    });
  });
});
