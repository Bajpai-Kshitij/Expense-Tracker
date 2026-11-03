import { describe, it, expect, beforeEach } from 'vitest';
import { createSqljsAdapter } from './testing/sqljsAdapter.js';
import { migrate } from './migrations.js';
import { applyEventsToDb } from './sync.js';
import { totals } from './queries.js';
import {
  categoryTotals,
  dayTotals,
  monthTotals,
  topBrands,
  accountTotals,
  ownerTotals,
  addedByTotals,
} from './reportQueries.js';
import { createEvent } from '../events/event.js';

describe('reportQueries - SQLite aggregation queries', () => {
  let db;

  beforeEach(async () => {
    db = await createSqljsAdapter();
    await migrate(db);

    const now = '2026-10-25T12:00:00.000Z';
    const events = [
      // 1. Accounts with owners
      createEvent({
        type: 'account.upserted',
        dev: 'dev-1',
        seq: 1,
        ts: now,
        data: {
          accountId: 'acc-hdfc',
          name: 'HDFC Bank',
          type: 'bank',
          status: 'active',
          owner: 'Me',
        },
      }),
      createEvent({
        type: 'account.upserted',
        dev: 'dev-1',
        seq: 2,
        ts: now,
        data: {
          accountId: 'acc-icici',
          name: 'ICICI Bank',
          type: 'bank',
          status: 'active',
          owner: 'Wife',
        },
      }),
      createEvent({
        type: 'account.upserted',
        dev: 'dev-1',
        seq: 3,
        ts: now,
        data: {
          accountId: 'acc-sbi',
          name: 'SBI Joint',
          type: 'bank',
          status: 'active',
          owner: 'Joint',
        },
      }),
      createEvent({
        type: 'account.upserted',
        dev: 'dev-1',
        seq: 4,
        ts: now,
        data: {
          accountId: 'acc-cash',
          name: 'Cash Wallet',
          type: 'cash',
          status: 'active',
          owner: 'OtherOwner', // Not in ('Me', 'Wife', 'Joint') -> Unassigned
        },
      }),

      // 2. Categories
      createEvent({
        type: 'category.upserted',
        dev: 'dev-1',
        seq: 5,
        ts: now,
        data: { categoryId: 'cat-food', name: 'Food & Dining', color: '#ff0000', icon: 'food' },
      }),
      createEvent({
        type: 'category.upserted',
        dev: 'dev-1',
        seq: 6,
        ts: now,
        data: { categoryId: 'cat-bills', name: 'Bills', color: '#00ff00', icon: 'bills' },
      }),

      // 3. Expenses in Oct 2026
      // Food: Swiggy 100.00 debit
      createEvent({
        type: 'expense.created',
        dev: 'dev-1',
        seq: 7,
        ts: now,
        data: {
          expenseId: 'exp-1',
          date: '2026-10-05',
          amount_paise: 10000,
          direction: 'debit',
          kind: 'spend',
          category_id: 'cat-food',
          account_id: 'acc-hdfc',
          brand: 'Swiggy',
          merchant_raw: 'SWIGGY BANGALORE',
        },
      }),
      // Food: Zomato 50.00 debit
      createEvent({
        type: 'expense.created',
        dev: 'dev-1',
        seq: 8,
        ts: now,
        data: {
          expenseId: 'exp-2',
          date: '2026-10-10',
          amount_paise: 5000,
          direction: 'debit',
          kind: 'spend',
          category_id: 'cat-food',
          account_id: 'acc-icici',
          brand: null,
          merchant_raw: 'ZOMATO *DELHI',
        },
      }),
      // Food refund: Swiggy 20.00 credit (refund)
      createEvent({
        type: 'expense.created',
        dev: 'dev-2',
        seq: 9,
        ts: now,
        data: {
          expenseId: 'exp-3',
          date: '2026-10-12',
          amount_paise: 2000,
          direction: 'credit',
          kind: 'spend',
          category_id: 'cat-food',
          account_id: 'acc-hdfc',
          brand: 'Swiggy',
          merchant_raw: 'SWIGGY REFUND',
        },
      }),
      // Bills: Fixed 200.00 debit (kind = 'fixed')
      createEvent({
        type: 'expense.created',
        dev: 'dev-1',
        seq: 10,
        ts: now,
        data: {
          expenseId: 'exp-4',
          date: '2026-10-15',
          amount_paise: 20000,
          direction: 'debit',
          kind: 'fixed',
          category_id: 'cat-bills',
          account_id: 'acc-sbi',
          brand: 'Bescom',
          merchant_raw: 'BESCOM ELEC',
        },
      }),
      // Uncategorized: Amazon 70.00 debit
      createEvent({
        type: 'expense.created',
        dev: 'dev-2',
        seq: 11,
        ts: now,
        data: {
          expenseId: 'exp-5',
          date: '2026-10-20',
          amount_paise: 7000,
          direction: 'debit',
          kind: 'spend',
          category_id: null,
          account_id: 'acc-cash',
          brand: null,
          merchant_raw: 'AMAZON PAY INDIA',
        },
      }),
      // Income: 1000.00 credit (kind = 'income')
      createEvent({
        type: 'expense.created',
        dev: 'dev-1',
        seq: 12,
        ts: now,
        data: {
          expenseId: 'exp-6',
          date: '2026-10-01',
          amount_paise: 100000,
          direction: 'credit',
          kind: 'income',
          category_id: null,
          account_id: 'acc-hdfc',
          brand: 'Employer',
          merchant_raw: 'SALARY CREDIT',
        },
      }),
      // Deleted expense: 500.00 debit (status = 'deleted')
      createEvent({
        type: 'expense.created',
        dev: 'dev-1',
        seq: 13,
        ts: now,
        data: {
          expenseId: 'exp-7',
          date: '2026-10-18',
          amount_paise: 50000,
          direction: 'debit',
          kind: 'spend',
          category_id: 'cat-food',
          account_id: 'acc-hdfc',
          brand: 'Cancelled Order',
          merchant_raw: 'CANCELLED',
        },
      }),
      createEvent({
        type: 'expense.deleted',
        dev: 'dev-1',
        seq: 14,
        ts: now,
        data: { expenseId: 'exp-7' },
      }),
      // Previous month expense in Sep 2026: 150.00 debit
      createEvent({
        type: 'expense.created',
        dev: 'dev-1',
        seq: 15,
        ts: now,
        data: {
          expenseId: 'exp-8',
          date: '2026-09-15',
          amount_paise: 15000,
          direction: 'debit',
          kind: 'spend',
          category_id: 'cat-food',
          account_id: 'acc-hdfc',
          brand: 'Swiggy',
          merchant_raw: 'SWIGGY BANGALORE',
        },
      }),
    ];

    await applyEventsToDb(db, events);
  });

  it('categoryTotals aggregates net spend correctly and handles includeFixed', async () => {
    // Without fixed: cat-food (10000 + 5000 - 2000 = 13000), uncategorized (7000)
    const octSpend = await categoryTotals(db, { from: '2026-10-01', to: '2026-10-31', includeFixed: false });
    expect(octSpend).toEqual([
      { categoryId: 'cat-food', netPaise: 13000, count: 3 },
      { categoryId: null, netPaise: 7000, count: 1 },
    ]);

    // With fixed: cat-bills (20000), cat-food (13000), uncategorized (7000)
    const octAll = await categoryTotals(db, { from: '2026-10-01', to: '2026-10-31', includeFixed: true });
    expect(octAll).toEqual([
      { categoryId: 'cat-bills', netPaise: 20000, count: 1 },
      { categoryId: 'cat-food', netPaise: 13000, count: 3 },
      { categoryId: null, netPaise: 7000, count: 1 },
    ]);
  });

  it('dayTotals aggregates correctly by date ascending', async () => {
    const days = await dayTotals(db, { from: '2026-10-01', to: '2026-10-31', includeFixed: false });
    expect(days).toEqual([
      { date: '2026-10-05', netPaise: 10000, count: 1 },
      { date: '2026-10-10', netPaise: 5000, count: 1 },
      { date: '2026-10-12', netPaise: -2000, count: 1 },
      { date: '2026-10-20', netPaise: 7000, count: 1 },
    ]);
  });

  it('monthTotals returns netPaise, fixedPaise, and incomePaise in single query', async () => {
    const months = await monthTotals(db, { fromMonth: '2026-09', toMonth: '2026-10', includeFixed: false });
    expect(months.length).toBe(2);

    // Sep: 15000 spend, 0 fixed, 0 income
    expect(months[0]).toEqual({
      month: '2026-09',
      netPaise: 15000,
      fixedPaise: 0,
      incomePaise: 0,
      count: 1,
    });

    // Oct: 20000 spend (13000 food + 7000 uncat), 20000 fixed, 100000 income, count: 4
    expect(months[1]).toEqual({
      month: '2026-10',
      netPaise: 20000,
      fixedPaise: 20000,
      incomePaise: 100000,
      count: 4,
    });
  });

  it('topBrands groups by brand when set, else first alphanumeric token of merchant_raw', async () => {
    const brands = await topBrands(db, { from: '2026-10-01', to: '2026-10-31', includeFixed: false });
    // Swiggy: 10000 - 2000 = 8000 (brand 'Swiggy')
    // AMAZON: 7000 (token from 'AMAZON PAY INDIA')
    // ZOMATO: 5000 (token from 'ZOMATO *DELHI')
    expect(brands).toEqual([
      { key: 'Swiggy', label: 'Swiggy', netPaise: 8000, count: 2 },
      { key: 'AMAZON', label: 'AMAZON', netPaise: 7000, count: 1 },
      { key: 'ZOMATO', label: 'ZOMATO', netPaise: 5000, count: 1 },
    ]);
  });

  it('ownerTotals groups into Me, Wife, Joint, Unassigned', async () => {
    const owners = await ownerTotals(db, { from: '2026-10-01', to: '2026-10-31', includeFixed: true });
    // Joint (SBI): 20000
    // Me (HDFC): 10000 - 2000 = 8000
    // Unassigned (Cash): 7000
    // Wife (ICICI): 5000
    expect(owners).toEqual([
      { owner: 'Joint', netPaise: 20000, count: 1 },
      { owner: 'Me', netPaise: 8000, count: 2 },
      { owner: 'Unassigned', netPaise: 7000, count: 1 },
      { owner: 'Wife', netPaise: 5000, count: 1 },
    ]);
  });

  it('addedByTotals groups by created_by_dev', async () => {
    const devs = await addedByTotals(db, { from: '2026-10-01', to: '2026-10-31', includeFixed: false });
    // dev-1: exp-1 (10000) + exp-2 (5000) = 15000, count: 2
    // dev-2: exp-3 (-2000) + exp-5 (7000) = 5000, count: 2
    expect(devs).toEqual([
      { deviceId: 'dev-1', netPaise: 15000, count: 2 },
      { deviceId: 'dev-2', netPaise: 5000, count: 2 },
    ]);
  });

  it('CONSISTENCY TEST: sum(categoryTotals) == sum(dayTotals) == monthTotals == totals().netPaise', async () => {
    // Test 1: includeFixed: false
    const f1 = { from: '2026-10-01', to: '2026-10-31', includeFixed: false };
    const cats1 = await categoryTotals(db, f1);
    const days1 = await dayTotals(db, f1);
    const m1 = await monthTotals(db, { fromMonth: '2026-10', toMonth: '2026-10', includeFixed: false });
    const tot1 = await totals(db, f1);

    const sumCats1 = cats1.reduce((acc, c) => acc + c.netPaise, 0);
    const sumDays1 = days1.reduce((acc, d) => acc + d.netPaise, 0);
    const monthNet1 = m1[0] ? m1[0].netPaise : 0;

    expect(sumCats1).toBe(20000);
    expect(sumDays1).toBe(20000);
    expect(monthNet1).toBe(20000);
    expect(tot1.netPaise).toBe(20000);
    expect(sumCats1).toBe(sumDays1);
    expect(sumDays1).toBe(monthNet1);
    expect(monthNet1).toBe(tot1.netPaise);

    // Test 2: includeFixed: true
    const f2 = { from: '2026-10-01', to: '2026-10-31', includeFixed: true };
    const cats2 = await categoryTotals(db, f2);
    const days2 = await dayTotals(db, f2);
    const m2 = await monthTotals(db, { fromMonth: '2026-10', toMonth: '2026-10', includeFixed: true });
    const tot2 = await totals(db, f2);

    const sumCats2 = cats2.reduce((acc, c) => acc + c.netPaise, 0);
    const sumDays2 = days2.reduce((acc, d) => acc + d.netPaise, 0);
    const monthNet2 = m2[0] ? m2[0].netPaise : 0;

    expect(sumCats2).toBe(40000);
    expect(sumDays2).toBe(40000);
    expect(monthNet2).toBe(40000);
    expect(tot2.netPaise).toBe(40000);
    expect(sumCats2).toBe(sumDays2);
    expect(sumDays2).toBe(monthNet2);
    expect(monthNet2).toBe(tot2.netPaise);
  });
});
