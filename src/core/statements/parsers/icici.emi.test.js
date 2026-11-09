import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from './icici.js';
import { planStatementImport, planUndoImport } from '../import/plan.js';
import { createEmptyState, applyEvents } from '../../events/reducer.js';

const toLines = (text) => text.split('\n').map((t, i) => ({ page: 1, lineNo: i + 1, text: t }));
const fixture = toLines(readFileSync(resolve(__dirname, 'fixtures', 'icici_amazon.txt'), 'utf8'));
const HEAD = ['CREDIT CARD STATEMENT', 'SPENDS OVERVIEW', 'XXXXXXXXXXXX7922'];
const planFor = (result, state = createEmptyState()) =>
  planStatementImport({ result, fileHash: 'h1', accountId: 'acc_icici_amazonpay', state });
const created = (plan) => plan.events.filter((e) => e.type === 'expense.created').map((e) => e.data);
const net = (list) => list.filter((e) => e.kind === 'spend').reduce((a, e) => a + (e.direction === 'debit' ? e.amountPaise : -e.amountPaise), 0);

describe('ICICI EMI and fee handling', () => {
  const parsed = parse(fixture);
  const lines = parsed.lines;
  const data = created(planFor(parsed));
  const byAmount = (paise, direction = 'debit') => data.find((d) => d.amountPaise === paise && d.direction === direction);

  it('marks the EMI processing fee and its IGST as Fixed EMI lines of the plan', () => {
    expect(lines.find((l) => l.amountPaise === 28794).type).toBe('emi_fee');
    expect(lines.find((l) => l.amountPaise === 5183).type).toBe('emi_tax');
    for (const paise of [28794, 5183]) {
      expect(byAmount(paise)).toMatchObject({ kind: 'fixed', categoryId: 'cat_emi', emiPlanKey: 'emi:acc_icici_amazonpay|2026-10-13|3|963022' });
    }
    expect(byAmount(28794).emiPart).toBe('fee');
  });

  it('marks the EMI conversion purchase and reversal as two transfers without a refund link', () => {
    for (const d of ['debit', 'credit']) {
      expect(byAmount(963022, d)).toMatchObject({ kind: 'transfer', categoryId: null });
      expect(byAmount(963022, d).refundOf).toBeUndefined();
    }
  });

  it('leaves a credit equal to a loan as a refund when its purchase is not in the statement', () => {
    const r = parse(toLines([...HEAD,
      '13/10/2026   12345678901   AMAZON PAY INDIA   0   9,630.22 CR',
      'EMI / PERSONAL LOAN ON CREDIT CARDS',
      'Merchant EMI   13/10/2026   13/01/2027   3   9,630.22   3   9,630.22   3,296.00'].join('\n')));
    expect(r.lines[0].type).toBe('refund');
  });

  it('puts bank fees and their GST under Fees and Taxes as spend', () => {
    for (const paise of [1292, 233]) expect(byAmount(paise)).toMatchObject({ kind: 'spend', categoryId: 'cat_fees' });
  });

  it('matches the rules: Fixed includes fee lines, spend excludes fee and conversion', () => {
    const fixed = data.filter((d) => d.kind === 'fixed').reduce((a, d) => a + d.amountPaise, 0);
    expect(fixed).toBe(1406228);
    expect(net(data)).toBe(853825); // handover 873525 minus the two Google Play lines this fixture lacks (19900 - 200)
  });

  it('reads a transaction whose date has side text glued before it', () => {
    const r = parse(toLines([...HEAD,
      'Earn more rewards on every spend 02/10/2026   12345678901   GOOGLE PLAY APP MUMBAI   0   199.00',
      'Safe banking tips here 03/10/2026   12345678902   GOOGLE PLAY APP MUMBAI   0   2.00 CR'].join('\n')));
    expect(r.unparsedLines).toEqual([]);
    expect(r.lines.map((l) => [l.date, l.amountPaise, l.direction])).toEqual([
      ['2026-10-02', 19900, 'debit'], ['2026-10-03', 200, 'credit'],
    ]);
    expect(r.warnings).toEqual([]);
  });

  it('keeps two EMIs on the same date apart', () => {
    const r = parse(toLines([...HEAD,
      '11/10/2026   12345678901   Interest Amount Amortization - <6/9>Flipkart   0   394.14',
      '11/10/2026   12345678902   IGST-CI@18%   0   70.95',
      '11/10/2026   12345678903   Principal Amount Amortization -   0   7,248.58',
      '11/10/2026   12345678904   Interest Amount Amortization - <1/3>AMAZON PAY   0   128.32',
      '11/10/2026   12345678905   IGST-CI@18%   0   23.10',
      '11/10/2026   12345678906   Principal Amount Amortization - <1/3>AMAZON PAY   0   3,167.68',
      'EMI / PERSONAL LOAN ON CREDIT CARDS',
      'Merchant EMI   11/05/2026   11/01/2027   9   64,417.00   3   22,928.19   7,642.72',
      'Merchant EMI   13/10/2026   13/01/2027   3   9,630.22   3   9,630.22   3,296.00'].join('\n')));
    expect(r.lines.map((l) => `${l.emiNo}/${l.emiTotal}:${l.emiMonthlyPaise}`)).toEqual([
      '6/9:764272', '6/9:764272', '6/9:764272', '1/3:329600', '1/3:329600', '1/3:329600',
    ]);
  });
});

describe('repairing and undoing an imported statement', () => {
  const stateFrom = (events) => applyEvents(createEmptyState(), events.map((e, i) => ({
    v: 1, id: `ev${i}`, dev: 'dev-a', seq: i + 1, ts: `2026-11-01T10:00:${String(i).padStart(2, '0')}.000+05:30`, ...e,
  })));
  const old = (data) => ({
    type: 'expense.created',
    data: { source: 'statement', direction: 'debit', kind: 'spend', categoryId: null, accountId: 'acc_icici_amazonpay', statementFileHash: 'h1', ...data },
  });
  const key = (paise, date, token, dir = 'debit') => `st:acc_icici_amazonpay|${paise}|${date}|${dir}|${token}|1`;
  const r = parse(toLines([...HEAD,
    '06/10/2026   12345678901   DCC Fee   0   12.92',
    '06/10/2026   12345678902   IGST-CI@18%   0   2.33'].join('\n')));

  it('corrects an unedited imported line and counts it as repaired', () => {
    const k = key(1292, '2026-10-06', 'DCC');
    const state = stateFrom([old({ expenseId: 'x1', amountPaise: 1292, date: '2026-10-06', merchantRaw: 'DCC Fee', dedupeKey: k, statementKey: k })]);
    const plan = planFor(r, state);
    expect(plan.summary.repaired).toBe(1);
    expect(plan.events[0]).toMatchObject({ type: 'expense.updated', data: { expenseId: 'x1', patch: { categoryId: 'cat_fees' } } });
  });

  it('never overrides a category or kind the user set', () => {
    const k = key(1292, '2026-10-06', 'DCC');
    const state = stateFrom([
      old({ expenseId: 'x1', amountPaise: 1292, date: '2026-10-06', merchantRaw: 'DCC Fee', dedupeKey: k, statementKey: k }),
      { type: 'expense.updated', data: { expenseId: 'x1', patch: { categoryId: 'cat_travel', categoryLocked: true, kind: 'transfer' } } },
    ]);
    const plan = planFor(r, state);
    expect(plan.events.filter((e) => e.data.expenseId === 'x1')).toEqual([]);
  });

  it('repairing twice writes nothing the second time', () => {
    const k = key(1292, '2026-10-06', 'DCC');
    const first = [old({ expenseId: 'x1', amountPaise: 1292, date: '2026-10-06', merchantRaw: 'DCC Fee', dedupeKey: k, statementKey: k })];
    const repaired = planFor(r, stateFrom(first)).events.filter((e) => e.data.expenseId === 'x1');
    const again = planFor(r, stateFrom([...first, ...repaired]));
    expect(again.events.filter((e) => e.data.expenseId === 'x1')).toEqual([]);
  });

  it('undo deletes only expenses the file created, not SMS expenses it linked', () => {
    const state = stateFrom([
      old({ expenseId: 'made', amountPaise: 100, date: '2026-10-06', dedupeKey: 'st:a', statementKey: 'st:a' }),
      old({ expenseId: 'sms', amountPaise: 200, date: '2026-10-06', dedupeKey: 'ref:123', statementKey: 'st:b' }),
      old({ expenseId: 'other', amountPaise: 300, date: '2026-10-06', dedupeKey: 'st:c', statementKey: 'st:c', statementFileHash: 'h2' }),
    ]);
    expect(planUndoImport(state, 'h1').map((e) => e.data.expenseId)).toEqual(['made']);
  });
});
