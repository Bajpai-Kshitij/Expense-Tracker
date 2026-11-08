import { describe, it, expect } from 'vitest';
import { buildEmiPlans } from './plans.js';

describe('src/core/emi/plans.js - buildEmiPlans', () => {
  const referenceNow = new Date('2026-11-05T00:00:00.000Z');

  it('aggregates two active plans correctly', () => {
    const expenses = [
      {
        id: 'e1',
        kind: 'fixed',
        emiPlanKey: 'emi:acc1|planA',
        merchantRaw: 'Interest Amount Amortization - <6/9>Flipkart',
        emiNo: 6,
        emiTotal: 9,
        emiMonthlyPaise: 764272,
        emiFinishDate: '2027-01-11',
        emiOutstandingPaise: 2292819,
        date: '2026-10-11',
      },
      {
        id: 'e2',
        kind: 'fixed',
        emiPlanKey: 'emi:acc1|planB',
        merchantRaw: '<1/3>AMAZON PAY INDIA PVT LT',
        emiNo: 1,
        emiTotal: 3,
        emiMonthlyPaise: 329600,
        emiFinishDate: '2026-12-13',
        emiOutstandingPaise: 659200,
        date: '2026-10-13',
      },
    ];

    const result = buildEmiPlans(expenses, referenceNow);
    expect(result).toHaveLength(2);
    expect(result.monthlyCommitmentPaise).toBe(764272 + 329600);

    const flipkart = result.find((p) => p.planKey === 'emi:acc1|planA');
    expect(flipkart).toBeDefined();
    expect(flipkart.merchant).toBe('Flipkart');
    expect(flipkart.emiNo).toBe(6);
    expect(flipkart.emiTotal).toBe(9);
    expect(flipkart.remaining).toBe(3);
    expect(flipkart.monthlyPaise).toBe(764272);
    expect(flipkart.finishDate).toBe('2027-01-11');
    expect(flipkart.outstandingPaise).toBe(2292819);

    const amazon = result.find((p) => p.planKey === 'emi:acc1|planB');
    expect(amazon).toBeDefined();
    expect(amazon.merchant).toBe('AMAZON PAY INDIA PVT LT');
    expect(amazon.emiNo).toBe(1);
    expect(amazon.remaining).toBe(2);
  });

  it('hides a finished plan where remaining is 0', () => {
    const expenses = [
      {
        id: 'e_done',
        kind: 'fixed',
        emiPlanKey: 'emi:acc1|plan_done',
        merchantRaw: '<9/9>Flipkart',
        emiNo: 9,
        emiTotal: 9,
        emiMonthlyPaise: 500000,
        emiFinishDate: '2026-11-01',
        emiOutstandingPaise: 0,
        date: '2026-11-01',
      },
      {
        id: 'e_active',
        kind: 'fixed',
        emiPlanKey: 'emi:acc1|plan_active',
        merchantRaw: '<3/6>Phone',
        emiNo: 3,
        emiTotal: 6,
        emiMonthlyPaise: 250000,
        emiFinishDate: '2027-02-01',
        emiOutstandingPaise: 750000,
        date: '2026-11-01',
      },
    ];

    const result = buildEmiPlans(expenses, referenceNow);
    expect(result).toHaveLength(1);
    expect(result[0].planKey).toBe('emi:acc1|plan_active');
    expect(result.monthlyCommitmentPaise).toBe(250000);
  });

  it('hides a stale plan whose last installment is older than 45 days', () => {
    const expenses = [
      {
        id: 'e_stale',
        kind: 'fixed',
        emiPlanKey: 'emi:acc1|plan_stale',
        merchantRaw: '<2/6>Old Loan',
        emiNo: 2,
        emiTotal: 6,
        emiMonthlyPaise: 100000,
        emiFinishDate: '2026-12-01',
        date: '2026-08-01', // >45 days before 2026-11-05
      },
      {
        id: 'e_recent',
        kind: 'fixed',
        emiPlanKey: 'emi:acc1|plan_recent',
        merchantRaw: '<2/6>New Loan',
        emiNo: 2,
        emiTotal: 6,
        emiMonthlyPaise: 150000,
        emiFinishDate: '2027-03-01',
        date: '2026-10-15', // ~21 days before 2026-11-05
      },
    ];

    const result = buildEmiPlans(expenses, referenceNow);
    expect(result).toHaveLength(1);
    expect(result[0].planKey).toBe('emi:acc1|plan_recent');
    expect(result.monthlyCommitmentPaise).toBe(150000);
  });

  it('keeps only the latest installment when two installments of the same plan exist', () => {
    const expenses = [
      {
        id: 'inst_5',
        kind: 'fixed',
        emiPlanKey: 'emi:acc1|planX',
        merchantRaw: '<5/9>Gadget',
        emiNo: 5,
        emiTotal: 9,
        emiMonthlyPaise: 400000,
        emiFinishDate: '2027-02-01',
        emiOutstandingPaise: 1600000,
        date: '2026-09-20',
      },
      {
        id: 'inst_6',
        kind: 'fixed',
        emiPlanKey: 'emi:acc1|planX',
        merchantRaw: '<6/9>Gadget',
        emiNo: 6,
        emiTotal: 9,
        emiMonthlyPaise: 400000,
        emiFinishDate: '2027-02-01',
        emiOutstandingPaise: 1200000,
        date: '2026-10-20',
      },
    ];

    const result = buildEmiPlans(expenses, referenceNow);
    expect(result).toHaveLength(1);
    expect(result[0].emiNo).toBe(6);
    expect(result[0].remaining).toBe(3);
    expect(result[0].outstandingPaise).toBe(1200000);
    expect(result[0].lastDate).toBe('2026-10-20');
  });

  it('handles expenses with missing or null fields gracefully without throwing', () => {
    const expenses = [
      null,
      undefined,
      { id: 'bad1' },
      { id: 'bad2', kind: 'spend' },
      { id: 'bad3', kind: 'fixed', emiPlanKey: null },
      {
        id: 'sparse',
        kind: 'fixed',
        emiPlanKey: 'emi:acc1|sparse',
        emiNo: 1,
        emiTotal: 3,
        date: '2026-10-30',
      },
    ];

    expect(() => {
      const res = buildEmiPlans(expenses, referenceNow);
      expect(res).toHaveLength(1);
      expect(res[0].planKey).toBe('emi:acc1|sparse');
      expect(res[0].remaining).toBe(2);
      expect(res[0].monthlyPaise).toBe(0);
      expect(res[0].outstandingPaise).toBe(0);
    }).not.toThrow();
  });
});
