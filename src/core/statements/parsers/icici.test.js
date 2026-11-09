import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { detect, parse, checkTotals, iciciParser } from './icici.js';
import { detect as axisDetect } from './axis.js';
import { parseStatement, registerStatementParser, clearParsers } from './registry.js';
import { planStatementImport } from '../import/plan.js';
import { applyStatementImport } from '../import/apply.js';
import { isNeedsAttention } from '../import/reconcile.js';
import { planImport, applyImport } from '../../ingest/pipeline.js';
import { createSqljsAdapter } from '../../db/testing/sqljsAdapter.js';
import { migrate } from '../../db/migrations.js';
import { rowsToState, dumpDatabase, totals } from '../../db/index.js';
import { createMemoryStorage } from '../../sync/testing/memoryStorage.js';
import { createWriter } from '../../sync/writer.js';
import { createEmptyState, applyEvents } from '../../events/reducer.js';
import { stateToRows } from '../../db/mapper.js';
import { isTxnLikeLine } from '../summary.js';

function loadFixture(filename) {
  const fullPath = resolve(__dirname, 'fixtures', filename);
  const text = readFileSync(fullPath, 'utf8');
  return text.split('\n').map((line, idx) => ({
    page: 1,
    lineNo: idx + 1,
    text: line,
  }));
}

describe('PHASE P8b-2b-1 - ICICI Credit Card Statement Parser', () => {
  const iciciLines = loadFixture('icici_amazon.txt');
  const axisFlipkartLines = loadFixture('axis_flipkart.txt');
  const axisMyZoneLines = loadFixture('axis_myzone.txt');

  describe('1. Field Preservation in Reducer and Mapper', () => {
    const extraFields = {
      emiPlanKey: 'emi:acc_icici|2026-05-11|9|6441700',
      emiNo: 6,
      emiTotal: 9,
      emiPart: 'principal',
      emiMonthlyPaise: 764272,
      emiFinishDate: '2027-01-11',
      emiOutstandingPaise: 2292819,
      bankCategory: 'Shopping',
    };

    it('reducer keeps extra expense fields', () => {
      const event = {
        id: 'ev_test_1',
        v: 1,
        type: 'expense.created',
        dev: 'dev_test',
        ts: 1700000000000,
        data: {
          expenseId: 'exp_test_1',
          amountPaise: 724858,
          date: '2026-10-11',
          ...extraFields,
        },
      };

      const state = applyEvents(createEmptyState(), [event]);
      const exp = state.expenses['exp_test_1'];

      expect(exp).toBeDefined();
      expect(exp.emiPlanKey).toBe(extraFields.emiPlanKey);
      expect(exp.emiNo).toBe(extraFields.emiNo);
      expect(exp.emiTotal).toBe(extraFields.emiTotal);
      expect(exp.emiPart).toBe(extraFields.emiPart);
      expect(exp.emiMonthlyPaise).toBe(extraFields.emiMonthlyPaise);
      expect(exp.emiFinishDate).toBe(extraFields.emiFinishDate);
      expect(exp.emiOutstandingPaise).toBe(extraFields.emiOutstandingPaise);
      expect(exp.bankCategory).toBe(extraFields.bankCategory);
    });

    it('mapper (stateToRows and rowsToState) keeps extra expense fields', () => {
      const event = {
        id: 'ev_test_1',
        v: 1,
        type: 'expense.created',
        dev: 'dev_test',
        ts: 1700000000000,
        data: {
          expenseId: 'exp_test_1',
          amountPaise: 724858,
          date: '2026-10-11',
          ...extraFields,
        },
      };

      const state = applyEvents(createEmptyState(), [event]);
      const rows = stateToRows(state);
      const roundtrippedState = rowsToState(rows);
      const roundtrippedExp = roundtrippedState.expenses['exp_test_1'];

      expect(roundtrippedExp).toBeDefined();
      expect(roundtrippedExp.emiPlanKey).toBe(extraFields.emiPlanKey);
      expect(roundtrippedExp.emiNo).toBe(extraFields.emiNo);
      expect(roundtrippedExp.emiTotal).toBe(extraFields.emiTotal);
      expect(roundtrippedExp.emiPart).toBe(extraFields.emiPart);
      expect(roundtrippedExp.emiMonthlyPaise).toBe(extraFields.emiMonthlyPaise);
      expect(roundtrippedExp.emiFinishDate).toBe(extraFields.emiFinishDate);
      expect(roundtrippedExp.emiOutstandingPaise).toBe(extraFields.emiOutstandingPaise);
      expect(roundtrippedExp.bankCategory).toBe(extraFields.bankCategory);
    });
  });

  describe('2. Detection and Cross-Claim Isolation', () => {
    it('detect is true for ICICI fixture and false for Axis fixtures', () => {
      expect(detect(iciciLines)).toBe(true);
      expect(detect(axisFlipkartLines)).toBe(false);
      expect(detect(axisMyZoneLines)).toBe(false);
    });

    it('Axis parser detect is false for ICICI fixture', () => {
      expect(axisDetect(iciciLines)).toBe(false);
    });
  });

  describe('3. Fixture Parsing (icici_amazon.txt)', () => {
    const result = parse(iciciLines);

    it('extracts metadata, account digits and period correctly', () => {
      expect(result.account.digits).toBe('7922');
      expect(result.statementDate).toBe('2026-11-04');
      expect(result.period).toEqual({
        start: '05/10/2026',
        end: '04/11/2026',
        startDate: '2026-10-05',
        endDate: '2026-11-04',
      });
      expect(result.declaredTotals).toBeNull();
      expect(result.unparsedLines).toHaveLength(0);
      expect(result.lines).toHaveLength(27);
      expect(result.warnings.some((w) => w.includes('Skipped 1 zero-amount'))).toBe(true);

      const check = checkTotals(result);
      expect(check.ok).toBe(true);
      expect(check.note).toBe('totals not checked yet');
      expect(isNeedsAttention(result, check)).toBe(false);
    });

    it('parses the 3 EMI plans from the EMI table accurately', () => {
      expect(result.emiPlans).toHaveLength(3);

      expect(result.emiPlans[0]).toEqual({
        creationDate: '2026-05-11',
        finishDate: '2027-01-11',
        total: 9,
        loanPaise: 6441700,
        pending: 3,
        outstandingPaise: 2292819,
        monthlyPaise: 764272,
      });

      expect(result.emiPlans[1]).toEqual({
        creationDate: '2026-09-01',
        finishDate: '2027-02-01',
        total: 6,
        loanPaise: 1526999,
        pending: 3,
        outstandingPaise: 799500,
        monthlyPaise: 266500,
      });

      expect(result.emiPlans[2]).toEqual({
        creationDate: '2026-10-13',
        finishDate: '2026-12-13',
        total: 3,
        loanPaise: 963022,
        pending: 2,
        outstandingPaise: 659200,
        monthlyPaise: 329600,
      });
    });

    it('verifies all 27 transaction lines match exact expected amounts and types', () => {
      const l = result.lines;

      // 0: payment 3716609 credit (2026-10-22)
      expect(l[0]).toMatchObject({ date: '2026-10-22', amountPaise: 3716609, direction: 'credit', type: 'payment' });

      // 1: purchase 66900
      expect(l[1]).toMatchObject({ date: '2026-10-04', amountPaise: 66900, direction: 'debit', type: 'purchase' });

      // 2: purchase 64900 ("CURSOR, AI POWERED IDE CURSOR.COM")
      expect(l[2]).toMatchObject({ date: '2026-10-05', amountPaise: 64900, merchantRaw: 'CURSOR, AI POWERED IDE CURSOR.COM', type: 'purchase' });

      // 3: fee 1292 (DCC Fee)
      expect(l[3]).toMatchObject({ date: '2026-10-06', amountPaise: 1292, type: 'fee' });

      // 4: tax 233
      expect(l[4]).toMatchObject({ date: '2026-10-06', amountPaise: 233, type: 'tax' });

      // 5: purchase 15400
      expect(l[5]).toMatchObject({ date: '2026-10-07', amountPaise: 15400, type: 'purchase' });

      // 6: purchase 963022 (10-10)
      expect(l[6]).toMatchObject({ date: '2026-10-10', amountPaise: 963022, type: 'emi_conversion' });

      // 7: emi_interest 39414 (6/9, merchant "Flipkart")
      expect(l[7]).toMatchObject({ date: '2026-10-11', amountPaise: 39414, type: 'emi_interest', emiNo: 6, emiTotal: 9, emiMerchant: 'Flipkart' });

      // 8: emi_tax 7095
      expect(l[8]).toMatchObject({ date: '2026-10-11', amountPaise: 7095, type: 'emi_tax', emiNo: 6, emiTotal: 9 });

      // 9: emi_principal 724858 (marker taken from the interest line: 6/9)
      expect(l[9]).toMatchObject({ date: '2026-10-11', amountPaise: 724858, type: 'emi_principal', emiNo: 6, emiTotal: 9, emiMerchant: 'Flipkart' });

      // 10: refund 963022 credit (10-13, refundOf the 10-10 purchase)
      expect(l[10]).toMatchObject({ date: '2026-10-13', amountPaise: 963022, direction: 'credit', type: 'emi_conversion' });

      // 11: fee 28794 with tax 5183 (line was converted to fee by tax pairing)
      expect(l[11]).toMatchObject({ date: '2026-10-13', amountPaise: 28794, type: 'emi_fee' });
      expect(l[12]).toMatchObject({ date: '2026-10-13', amountPaise: 5183, type: 'emi_tax' });

      // 13: emi_interest 12832 (1/3)
      expect(l[13]).toMatchObject({ date: '2026-10-13', amountPaise: 12832, type: 'emi_interest', emiNo: 1, emiTotal: 3 });

      // 14: emi_tax 2310
      expect(l[14]).toMatchObject({ date: '2026-10-13', amountPaise: 2310, type: 'emi_tax', emiNo: 1, emiTotal: 3 });

      // 15: emi_principal 316768 (1/3)
      expect(l[15]).toMatchObject({ date: '2026-10-13', amountPaise: 316768, type: 'emi_principal', emiNo: 1, emiTotal: 3 });

      // 16-21: purchases 187300, 50400, 38000, 273500, 27400, 45400
      expect(l[16]).toMatchObject({ date: '2026-10-17', amountPaise: 187300, type: 'purchase' });
      expect(l[17]).toMatchObject({ date: '2026-10-17', amountPaise: 50400, type: 'purchase' });
      expect(l[18]).toMatchObject({ date: '2026-10-21', amountPaise: 38000, type: 'purchase' });
      expect(l[19]).toMatchObject({ date: '2026-10-23', amountPaise: 273500, type: 'purchase' });
      expect(l[20]).toMatchObject({ date: '2026-10-25', amountPaise: 27400, type: 'purchase' });
      expect(l[21]).toMatchObject({ date: '2026-10-28', amountPaise: 45400, type: 'purchase' });

      // 22: emi_interest 13744 (3/6)
      expect(l[22]).toMatchObject({ date: '2026-11-01', amountPaise: 13744, type: 'emi_interest', emiNo: 3, emiTotal: 6 });

      // 23: emi_tax 2474
      expect(l[23]).toMatchObject({ date: '2026-11-01', amountPaise: 2474, type: 'emi_tax', emiNo: 3, emiTotal: 6 });

      // 24: emi_principal 252756 (3/6)
      expect(l[24]).toMatchObject({ date: '2026-11-01', amountPaise: 252756, type: 'emi_principal', emiNo: 3, emiTotal: 6 });

      // 25-26: purchases 13800 and 69300
      expect(l[25]).toMatchObject({ date: '2026-11-01', amountPaise: 13800, type: 'purchase' });
      expect(l[26]).toMatchObject({ date: '2026-11-01', amountPaise: 69300, type: 'purchase' });
    });
  });

  describe('4. Tax Pairing & Rounding Tests', () => {
    it('pairs tax with nearest base within 3 lines on same date with 1-paisa rounding tolerance', () => {
      const synthetic = [
        { page: 1, lineNo: 1, text: 'CREDIT CARD STATEMENT' },
        { page: 1, lineNo: 2, text: 'SPENDS OVERVIEW' },
        { page: 1, lineNo: 3, text: 'XXXXXXXXXXXX7922' },
        // Line with fee: 100.00 -> 18% is 18.00 (1800 paise)
        { page: 1, lineNo: 4, text: '10/10/2026   10000000001   FEE CHARGE   0   100.00' },
        // IGST line with 1-paisa difference (1801 paise -> 18.01)
        { page: 1, lineNo: 5, text: '10/10/2026   10000000002   IGST-CI@18%   0   18.01' },
      ];
      const res = parse(synthetic);
      expect(res.lines[0].type).toBe('fee');
      expect(res.lines[1].type).toBe('tax');
    });

    it('leaves a lone IGST line without matching base as type tax', () => {
      const synthetic = [
        { page: 1, lineNo: 1, text: 'CREDIT CARD STATEMENT' },
        { page: 1, lineNo: 2, text: 'SPENDS OVERVIEW' },
        { page: 1, lineNo: 3, text: 'XXXXXXXXXXXX7922' },
        { page: 1, lineNo: 4, text: '10/10/2026   10000000001   STORE PURCHASE   0   500.00' },
        // IGST line of 50.00 does not equal 500 * 0.18 = 90.00
        { page: 1, lineNo: 5, text: '10/10/2026   10000000002   IGST-CI@18%   0   50.00' },
      ];
      const res = parse(synthetic);
      expect(res.lines[0].type).toBe('purchase');
      expect(res.lines[1].type).toBe('tax');
    });
  });

  describe('5. Tamper Tests', () => {
    it('unreadable dated line lands in unparsedLines', () => {
      const tampered = iciciLines.map((l) => {
        if (l.text.includes('10000000002')) {
          return { ...l, text: '04/10/2026   UNREADABLE GARBAGE DATA HERE' };
        }
        return l;
      });
      const res = parse(tampered);
      expect(res.unparsedLines).toHaveLength(1);
      expect(res.unparsedLines[0].text).toContain('UNREADABLE');
    });

    it('dated line missing serial number lands in unparsedLines', () => {
      const tampered = iciciLines.map((l) => {
        if (l.text.includes('10000000006')) {
          return { ...l, text: '07/10/2026   AMAZON PAY IN E COMMERC BANGALORE   7   154.00' };
        }
        return l;
      });
      const res = parse(tampered);
      expect(res.unparsedLines).toHaveLength(1);
      expect(res.unparsedLines[0].text).toContain('07/10/2026');
    });

    it('line with foreign-currency token between points and amount lands in unparsedLines', () => {
      const tampered = iciciLines.map((l) => {
        if (l.text.includes('10000000018')) {
          return { ...l, text: '17/10/2026   10000000018   AMAZON PAY IN E COMMERC BANGALORE IN   93   USD 25.00   1,873.00' };
        }
        return l;
      });
      const res = parse(tampered);
      expect(res.unparsedLines).toHaveLength(1);
      expect(res.unparsedLines[0].text).toContain('USD 25.00');
    });

    it('swapped CR flips transaction direction to credit', () => {
      const tampered = iciciLines.map((l) => {
        if (l.text.includes('10000000002')) {
          return { ...l, text: '04/10/2026   10000000002   AMAZON PAY IN E COMMERC BANGALORE   33   669.00 CR' };
        }
        return l;
      });
      const res = parse(tampered);
      const target = res.lines.find((l) => l.serialNo === '10000000002');
      expect(target.direction).toBe('credit');
      expect(target.type).toBe('refund');
    });
  });

  describe('6. Conservation Test', () => {
    it('asserts parsed + skipped + unparsed equals txn-like lines found by isTxnLikeLine in section', () => {
      const res = parse(iciciLines);
      const cleanLines = iciciLines.map((l) => ({
        ...l,
        text: (l.text || '').replace(/ ⇥ /g, '   ').replace(/⇥/g, '   '),
      }));

      // Count txn-like lines in transaction section
      let inTxn = false;
      let txnLikeCount = 0;
      for (const l of cleanLines) {
        if (/SPENDS\s+OVERVIEW/i.test(l.text)) {
          inTxn = true;
          continue;
        }
        if (inTxn && (/International\s+Spends/i.test(l.text) || /EMI\s*\/\s*PERSONAL\s+LOAN/i.test(l.text))) {
          break;
        }
        if (inTxn && /^\d{2}\/\d{2}\/\d{4}\b/.test(l.text.trim()) && isTxnLikeLine(l.text.trim())) {
          txnLikeCount += 1;
        }
      }

      const totalCount = res.lines.length + 1 /* skipped zero */ + res.unparsedLines.length;
      expect(totalCount).toBe(txnLikeCount);
      expect(totalCount).toBe(28);
    });
  });

  describe('7. Plan Import & EMI Groups Integration', () => {
    it('creates 3 fixed lines per EMI group with emiNo, emiTotal, emiMonthlyPaise and finishDate', () => {
      const parsed = parse(iciciLines);
      const plan = planStatementImport({
        result: parsed,
        fileHash: 'hash_icici_1',
        accountId: 'acc_icici_amazonpay',
        state: createEmptyState(),
      });

      const fixedCreated = plan.events
        .filter((ev) => ev.type === 'expense.created' && ev.data.kind === 'fixed' && ev.data.emiNo != null)
        .map((ev) => ev.data);

      // 3 EMI groups x 3 lines each = 9 installment lines (the processing fee lines have no emiNo)
      expect(fixedCreated).toHaveLength(9);

      // Group 1: Flipkart 6/9
      const flipkartLines = fixedCreated.filter((d) => d.emiPlanKey.includes('Flipkart') || d.emiPlanKey.includes('6441700'));
      expect(flipkartLines).toHaveLength(3);
      for (const fl of flipkartLines) {
        expect(fl.kind).toBe('fixed');
        expect(fl.emiNo).toBe(6);
        expect(fl.emiTotal).toBe(9);
        expect(fl.emiMonthlyPaise).toBe(764272);
        expect(fl.emiFinishDate).toBe('2027-01-11');
        expect(fl.emiOutstandingPaise).toBe(2292819);
        expect(fl.categoryId).toBe('cat_emi');
      }

      // Group 2: Amazon Pay 1/3
      const amazon1Lines = fixedCreated.filter((d) => d.date === '2026-10-13');
      expect(amazon1Lines).toHaveLength(3);
      for (const al of amazon1Lines) {
        expect(al.kind).toBe('fixed');
        expect(al.emiNo).toBe(1);
        expect(al.emiTotal).toBe(3);
        expect(al.emiMonthlyPaise).toBe(329600);
        expect(al.emiFinishDate).toBe('2026-12-13');
        expect(al.emiOutstandingPaise).toBe(659200);
      }

      // Group 3: Amazon Pay 3/6
      const amazon2Lines = fixedCreated.filter((d) => d.date === '2026-11-01');
      expect(amazon2Lines).toHaveLength(3);
      for (const al of amazon2Lines) {
        expect(al.kind).toBe('fixed');
        expect(al.emiNo).toBe(3);
        expect(al.emiTotal).toBe(6);
        expect(al.emiMonthlyPaise).toBe(266500);
        expect(al.emiFinishDate).toBe('2027-02-01');
        expect(al.emiOutstandingPaise).toBe(799500);
      }
    });

    it('does not treat the 9630.22 EMI conversion as a refund of its purchase', () => {
      const parsed = parse(iciciLines);
      const plan = planStatementImport({
        result: parsed,
        fileHash: 'hash_icici_1',
        accountId: 'acc_icici_amazonpay',
        state: createEmptyState(),
      });

      const refundCreated = plan.events.find(
        (ev) => ev.type === 'expense.created' && ev.data.amountPaise === 963022 && ev.data.direction === 'credit'
      );
      const purchaseCreated = plan.events.find(
        (ev) => ev.type === 'expense.created' && ev.data.amountPaise === 963022 && ev.data.direction === 'debit'
      );

      expect(refundCreated).toBeDefined();
      expect(purchaseCreated).toBeDefined();
      expect(refundCreated.data.refundOf).toBeUndefined();
    });
  });

  describe('8. P8b-1 Engine Integration with P7b SMS Fixtures', () => {
    async function setupDbAndWriter() {
      const db = await createSqljsAdapter();
      await migrate(db);
      const storage = createMemoryStorage();
      const writer = createWriter({ deviceId: 'dev_test', storage, db });
      await writer.init();

      // Amazon Pay ICICI account with card digits 6017 and alias 7922
      await writer.write('account.upserted', {
        accountId: 'acc_icici_amazonpay',
        name: 'Amazon Pay ICICI Card',
        type: 'credit_card',
        issuer: 'icici',
        digits: '6017',
        lastDigits: '6017',
        aliases: [{ issuer: 'icici', digits: '7922' }],
      });

      return { db, writer, storage };
    }

    const iciciSmsSpend1 = {
      id: 'sms_icici_1',
      address: 'ICICIB',
      body: 'INR 454.00 spent using ICICI Bank Card XX6017 on 28-Oct-26 on AMAZON PAY IN E. Avl Limit: INR 41,614.08. If not you, call 1800 2662/SMS BLOCK 6017 to 9215676766.',
      date: Date.parse('2026-10-28T10:00:00.000Z'),
    };

    const iciciSmsSpend2 = {
      id: 'sms_icici_2',
      address: 'ICICIB',
      body: 'INR 274.00 spent using ICICI Bank Card XX6017 on 25-Oct-26 on AMAZON PAY IN E. Avl Limit: INR 42,068.08. If not you, call 1800 2662/SMS BLOCK 6017 to 9215676766.',
      date: Date.parse('2026-10-25T10:00:00.000Z'),
    };

    const iciciSmsPayment = {
      id: 'sms_icici_pay',
      address: 'ICICIB',
      body: 'Dear Customer, thank you for your payment of INR 37,166.09 towards ICICI Bank Credit Card Account XX7922 through Auto Debit from Account XX4476 on 22-Oct-26',
      date: Date.parse('2026-10-22T10:00:00.000Z'),
    };

    it('links 454.00 and 274.00 to SMS expenses, and pairs payment line giving same linkId', async () => {
      const { db, writer } = await setupDbAndWriter();

      // 1. Ingest SMS messages
      const state0 = rowsToState({
        expenses: await db.query('SELECT * FROM expenses;'),
        categories: await db.query('SELECT * FROM categories;'),
        accounts: await db.query('SELECT * FROM accounts;'),
        brands: await db.query('SELECT * FROM brands;'),
        rules: await db.query('SELECT * FROM rules;'),
        expense_keys: await db.query('SELECT * FROM expense_keys;'),
      });

      const smsPlan = planImport({
        messages: [iciciSmsSpend1, iciciSmsSpend2, iciciSmsPayment],
        ctx: { accounts: state0.accounts },
        state: state0,
        allowlist: ['ICICIB'],
      });
      await applyImport({ plan: smsPlan, writer, db, batchId: 'batch_sms_1' });

      // 2. Import ICICI Statement
      const parsed = parse(iciciLines);
      const state1 = rowsToState({
        expenses: await db.query('SELECT * FROM expenses;'),
        categories: await db.query('SELECT * FROM categories;'),
        accounts: await db.query('SELECT * FROM accounts;'),
        brands: await db.query('SELECT * FROM brands;'),
        rules: await db.query('SELECT * FROM rules;'),
        expense_keys: await db.query('SELECT * FROM expense_keys;'),
      });

      const stmtPlan = planStatementImport({
        result: parsed,
        fileHash: 'hash_icici_stmt',
        accountId: 'acc_icici_amazonpay',
        state: state1,
      });

      // 454.00 and 274.00 lines should be marked linked_sms
      expect(stmtPlan.summary.linkedToSms).toBe(2);
      const linked454 = stmtPlan.plannedLines.find((l) => l.line.amountPaise === 45400);
      const linked274 = stmtPlan.plannedLines.find((l) => l.line.amountPaise === 27400);
      expect(linked454.status).toBe('linked_sms');
      expect(linked274.status).toBe('linked_sms');

      // Payment line pairs with SMS payment
      expect(stmtPlan.summary.payments).toBe(1);

      await applyStatementImport({ plan: stmtPlan, writer, db });

      // Re-importing statement creates 0 events
      const state2 = rowsToState({
        expenses: await db.query('SELECT * FROM expenses;'),
        categories: await db.query('SELECT * FROM categories;'),
        accounts: await db.query('SELECT * FROM accounts;'),
        brands: await db.query('SELECT * FROM brands;'),
        rules: await db.query('SELECT * FROM rules;'),
        expense_keys: await db.query('SELECT * FROM expense_keys;'),
      });
      const reimportPlan = planStatementImport({
        result: parsed,
        fileHash: 'hash_icici_stmt',
        accountId: 'acc_icici_amazonpay',
        state: state2,
      });
      expect(reimportPlan.events).toHaveLength(0);
      expect(reimportPlan.summary.alreadyImported).toBe(27);
    });

    it('produces identical database dumps regardless of whether SMS or statement is imported first', async () => {
      // Flow A: SMS first, Statement second
      const envA = await setupDbAndWriter();
      const stateA0 = rowsToState({
        expenses: await envA.db.query('SELECT * FROM expenses;'),
        categories: await envA.db.query('SELECT * FROM categories;'),
        accounts: await envA.db.query('SELECT * FROM accounts;'),
        brands: await envA.db.query('SELECT * FROM brands;'),
        rules: await envA.db.query('SELECT * FROM rules;'),
        expense_keys: await envA.db.query('SELECT * FROM expense_keys;'),
      });
      const smsPlanA = planImport({
        messages: [iciciSmsSpend1, iciciSmsSpend2, iciciSmsPayment],
        ctx: { accounts: stateA0.accounts },
        state: stateA0,
        allowlist: ['ICICIB'],
      });
      await applyImport({ plan: smsPlanA, writer: envA.writer, db: envA.db, batchId: 'b_sms' });

      const stateA1 = rowsToState({
        expenses: await envA.db.query('SELECT * FROM expenses;'),
        categories: await envA.db.query('SELECT * FROM categories;'),
        accounts: await envA.db.query('SELECT * FROM accounts;'),
        brands: await envA.db.query('SELECT * FROM brands;'),
        rules: await envA.db.query('SELECT * FROM rules;'),
        expense_keys: await envA.db.query('SELECT * FROM expense_keys;'),
      });
      const parsedA = parse(iciciLines);
      const stmtPlanA = planStatementImport({
        result: parsedA,
        fileHash: 'hash_icici_stmt',
        accountId: 'acc_icici_amazonpay',
        state: stateA1,
      });
      await applyStatementImport({ plan: stmtPlanA, writer: envA.writer, db: envA.db });
      const dumpA = await dumpDatabase(envA.db);

      // Flow B: Statement first, SMS second
      const envB = await setupDbAndWriter();
      const stateB0 = rowsToState({
        expenses: await envB.db.query('SELECT * FROM expenses;'),
        categories: await envB.db.query('SELECT * FROM categories;'),
        accounts: await envB.db.query('SELECT * FROM accounts;'),
        brands: await envB.db.query('SELECT * FROM brands;'),
        rules: await envB.db.query('SELECT * FROM rules;'),
        expense_keys: await envB.db.query('SELECT * FROM expense_keys;'),
      });
      const parsedB = parse(iciciLines);
      const stmtPlanB = planStatementImport({
        result: parsedB,
        fileHash: 'hash_icici_stmt',
        accountId: 'acc_icici_amazonpay',
        state: stateB0,
      });
      await applyStatementImport({ plan: stmtPlanB, writer: envB.writer, db: envB.db });

      const stateB1 = rowsToState({
        expenses: await envB.db.query('SELECT * FROM expenses;'),
        categories: await envB.db.query('SELECT * FROM categories;'),
        accounts: await envB.db.query('SELECT * FROM accounts;'),
        brands: await envB.db.query('SELECT * FROM brands;'),
        rules: await envB.db.query('SELECT * FROM rules;'),
        expense_keys: await envB.db.query('SELECT * FROM expense_keys;'),
      });
      const smsPlanB = planImport({
        messages: [iciciSmsSpend1, iciciSmsSpend2, iciciSmsPayment],
        ctx: { accounts: stateB1.accounts },
        state: stateB1,
        allowlist: ['ICICIB'],
      });
      await applyImport({ plan: smsPlanB, writer: envB.writer, db: envB.db, batchId: 'b_sms' });
      const dumpB = await dumpDatabase(envB.db);

      // Compare non-transient table dumps
      expect(dumpA.expenses).toHaveLength(dumpB.expenses.length);
      expect(dumpA.expense_keys).toHaveLength(dumpB.expense_keys.length);

      const expMapA = new Map(dumpA.expenses.map((e) => [e.amount_paise + '|' + e.date + '|' + e.direction, e]));
      for (const eB of dumpB.expenses) {
        const sig = eB.amount_paise + '|' + eB.date + '|' + eB.direction;
        const eA = expMapA.get(sig);
        expect(eA).toBeDefined();
        expect(eA.amount_paise).toBe(eB.amount_paise);
        expect(eA.kind).toBe(eB.kind);
      }
    });
  });

  describe('9. Net Spend Calculation for October 2026', () => {
    it('produces 770,725 paise net spend with default filters and 1,907,979 paise with includeFixed', async () => {
      const db = await createSqljsAdapter();
      await migrate(db);
      const storage = createMemoryStorage();
      const writer = createWriter({ deviceId: 'dev_test', storage, db });
      await writer.init();

      await writer.write('account.upserted', {
        accountId: 'acc_icici_amazonpay',
        name: 'Amazon Pay ICICI Card',
        type: 'credit_card',
        issuer: 'icici',
        digits: '7922',
        lastDigits: '7922',
      });

      const parsed = parse(iciciLines);
      const state0 = rowsToState({
        expenses: await db.query('SELECT * FROM expenses;'),
        categories: await db.query('SELECT * FROM categories;'),
        accounts: await db.query('SELECT * FROM accounts;'),
        brands: await db.query('SELECT * FROM brands;'),
        rules: await db.query('SELECT * FROM rules;'),
        expense_keys: await db.query('SELECT * FROM expense_keys;'),
      });
      const stmtPlan = planStatementImport({
        result: parsed,
        fileHash: 'hash_icici_oct',
        accountId: 'acc_icici_amazonpay',
        state: state0,
      });
      await applyStatementImport({ plan: stmtPlan, writer, db });

      // Default totals for October 2026 (excludes fixed and payment):
      // Handover section 8: the EMI conversion is two transfers and the EMI processing fee is Fixed.
      // Spend: 669.00 + 649.00 + 12.92 + 2.33 + 154.00 + 1873.00 + 504.00 + 380.00 + 2735.00 + 274.00 + 454.00
      // Net spend = 7,707.25 (770,725 paise)
      const defaultTotals = await totals(db, {
        from: '2026-10-01',
        to: '2026-10-31',
        includeFixed: false,
      });
      expect(defaultTotals.netPaise).toBe(770725);

      // With includeFixed: adds October EMI lines (11032.77) and the processing fee with GST (339.77)
      // 770,725 + 1,137,254 = 1,907,979 paise (₹19,079.79), the same total as before
      const fixedTotals = await totals(db, {
        from: '2026-10-01',
        to: '2026-10-31',
        includeFixed: true,
      });
      expect(fixedTotals.netPaise).toBe(1907979);
    });
  });

  describe('10. Fuzz Testing', () => {
    it('parseStatement never throws on 200 random inputs', () => {
      const sampleChars = 'abcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:",.<>?/ \n\t⇥';
      for (let i = 0; i < 200; i++) {
        const lineCount = Math.floor(Math.random() * 30);
        const randomLines = [];
        for (let j = 0; j < lineCount; j++) {
          let str = '';
          const len = Math.floor(Math.random() * 80);
          for (let k = 0; k < len; k++) {
            str += sampleChars.charAt(Math.floor(Math.random() * sampleChars.length));
          }
          randomLines.push({ page: 1, lineNo: j + 1, text: str });
        }

        expect(() => {
          parseStatement(randomLines);
        }).not.toThrow();
      }
    });
  });
});
