import { describe, it, expect } from 'vitest';
import {
  groupReviewItems,
  describeUnknownAccount,
  describeDuplicate,
  describeUnparsed,
  scanSummaryLines,
  reviewBadgeCount,
  runReviewItemsSelfTest,
} from './viewModels.js';

describe('viewModels pure logic', () => {
  it('handles empty states cleanly', () => {
    const grouped = groupReviewItems([]);
    expect(grouped.unknownAccounts).toEqual([]);
    expect(grouped.possibleDuplicates).toEqual([]);
    expect(grouped.unparsed).toEqual([]);
    expect(grouped.counts).toEqual({
      unknownAccounts: 0,
      possibleDuplicates: 0,
      unparsed: 0,
      total: 0,
    });
    expect(reviewBadgeCount([])).toBe(0);
    expect(reviewBadgeCount(null)).toBe(0);
    expect(scanSummaryLines({})).toEqual(['Created 0 new expenses']);
  });

  it('groups and orders review items newest first', () => {
    const items = [
      { id: '1', type: 'unparsed', payload: { date: '2026-02-01T10:00:00Z' } },
      { id: '2', type: 'unparsed', payload: { date: '2026-02-05T10:00:00Z' } },
      { id: '3', type: 'unknown_account', payload: { date: '2026-02-02T10:00:00Z' } },
      { id: '4', type: 'possible_duplicate', payload: { date: '2026-02-03T10:00:00Z' } },
    ];

    const grouped = groupReviewItems(items);
    expect(grouped.unparsed).toHaveLength(2);
    expect(grouped.unparsed[0].id).toBe('2'); // Feb 5 before Feb 1
    expect(grouped.unparsed[1].id).toBe('1');
    expect(grouped.unknownAccounts).toHaveLength(1);
    expect(grouped.possibleDuplicates).toHaveLength(1);
    expect(grouped.counts.total).toBe(4);
    expect(reviewBadgeCount(grouped)).toBe(4);
  });

  it('describes unknown accounts with same-issuer accounts first and excludes archived', () => {
    const accounts = [
      { id: 'acc_axis_1', name: 'Axis MyZone', issuer: 'Axis', lastDigits: '4230', archived: 0 },
      { id: 'acc_hdfc_1', name: 'HDFC Millennia', issuer: 'HDFC', lastDigits: '7068', archived: 0 },
      { id: 'acc_icici_archived', name: 'Old ICICI', issuer: 'ICICI', lastDigits: '1111', archived: 1 },
      { id: 'acc_icici_active', name: 'ICICI Coral', issuer: 'ICICI', lastDigits: '3001', archived: 0 },
    ];

    const itemDigits = {
      payload: { issuer: 'ICICI', digits: '7922' },
    };
    const descDigits = describeUnknownAccount(itemDigits, 3, accounts);
    expect(descDigits.title).toBe('ICICI ending 7922');
    expect(descDigits.subtitle).toBe('3 messages waiting');
    expect(descDigits.suggestions).toHaveLength(3);
    expect(descDigits.suggestions[0].id).toBe('acc_icici_active'); // ICICI first
    expect(descDigits.suggestions.some((a) => a.id === 'acc_icici_archived')).toBe(false);

    const itemProduct = {
      payload: { issuer: 'HDFC', product: 'Regalia Gold' },
    };
    const descProduct = describeUnknownAccount(itemProduct, 1, accounts);
    expect(descProduct.title).toBe('HDFC product Regalia Gold');
    expect(descProduct.subtitle).toBe('1 message waiting');
    expect(descProduct.suggestions[0].id).toBe('acc_hdfc_1');
  });

  it('describes duplicates and computes differences; detects stale items', () => {
    const expenses = {
      e_imported: {
        id: 'e_imported',
        amountPaise: 150000,
        date: '2026-02-01',
        merchantRaw: 'Swiggy',
        categoryId: 'cat_food',
        note: 'lunch',
      },
      e_manual: {
        id: 'e_manual',
        amountPaise: 150000,
        date: '2026-02-02', // different date
        merchantRaw: 'SWIGGY RESTAURANT', // different merchant
        categoryId: 'cat_food',
        note: 'lunch with team', // different note
      },
    };

    const item = {
      payload: {
        importedId: 'e_imported',
        candidateIds: ['e_manual'],
      },
    };

    const desc = describeDuplicate(item, expenses);
    expect(desc.stale).toBe(false);
    expect(desc.imported.id).toBe('e_imported');
    expect(desc.manual[0].id).toBe('e_manual');
    expect(desc.differences).toContain('date');
    expect(desc.differences).toContain('merchant');
    expect(desc.differences).toContain('note');
    expect(desc.differences).not.toContain('amount');
    expect(desc.differences).not.toContain('category');

    // Stale: imported missing or deleted
    expect(describeDuplicate({ payload: { importedId: 'missing', candidateIds: ['e_manual'] } }, expenses).stale).toBe(true);
    expect(describeDuplicate({ payload: { importedId: 'e_imported', candidateIds: ['missing'] } }, expenses).stale).toBe(true);
    expect(describeDuplicate({ payload: { importedId: 'e_imported', candidateIds: [] } }, expenses).stale).toBe(true);
  });

  it('describes unparsed item with masked preview limited to 60 characters', () => {
    const body = 'Your OTP for transaction of Rs 50000 at MERCHANT on card ending 4230 is 123456. Do not share.';
    const item = {
      payload: {
        rawHash: 'hash123',
        address: 'VM-HDFCBK',
        date: '2026-02-01T10:00:00Z',
        body,
      },
    };

    const desc = describeUnparsed(item);
    expect(desc.address).toBe('VM-HDFCBK');
    expect(desc.receivedAt).toBe('2026-02-01T10:00:00Z');
    expect(desc.preview.length).toBeLessThanOrEqual(60);
    // Masking check: OTP / large numbers masked
    expect(desc.preview).not.toContain('123456');
    expect(desc.preview).not.toContain('\n');
  });

  it('formats scan summary lines hiding zeros except created = 0', () => {
    const zeroSummary = { created: 0, held: 0, unparsed: 0, ignored: 0 };
    expect(scanSummaryLines(zeroSummary)).toEqual(['Created 0 new expenses']);

    const fullSummary = {
      created: 20,
      held: 2,
      possibleDuplicates: 1,
      unparsed: 3,
      ignored: 10,
      duplicateTransaction: 4,
      refundLinked: 1,
      duplicateMessage: 5,
    };
    const lines = scanSummaryLines(fullSummary);
    expect(lines).toContain('Created 20 expenses');
    expect(lines).toContain('2 messages are waiting for an account');
    expect(lines).toContain('1 possible duplicate');
    expect(lines).toContain('3 unparsed messages');
    expect(lines).toContain('10 ignored messages');
    expect(lines).toContain('4 duplicate transactions');
    expect(lines).toContain('1 refund linked');
    expect(lines).toContain('5 duplicate messages');
  });

  it('BUG A reproduction: view-model functions with broken payloads (null, missing fields, deleted expense) never throw', () => {
    // 1. describeDuplicate with null or broken payloads
    expect(() => describeDuplicate(null, null)).not.toThrow();
    expect(describeDuplicate(null, null)).toEqual({ stale: true });

    expect(() => describeDuplicate({ payload: null }, null)).not.toThrow();
    expect(describeDuplicate({ payload: null }, null)).toEqual({ stale: true });

    expect(() => describeDuplicate({ payload: { importedId: 'exp1' } }, null)).not.toThrow();
    expect(describeDuplicate({ payload: { importedId: 'exp1' } }, null)).toEqual({ stale: true });

    // Statement / pipeline payload format with incomingExpenseId and candidateExpenseIds
    const statementItem = {
      id: 'rv_stmt_1',
      payload: {
        incomingExpenseId: 'e_stmt_1',
        candidateExpenseIds: ['e_manual_1'],
      },
    };
    const expensesWithStmt = {
      e_stmt_1: { id: 'e_stmt_1', amountPaise: 25000, date: '2026-11-01', merchantRaw: 'Merchant' },
      e_manual_1: { id: 'e_manual_1', amountPaise: 25000, date: '2026-11-01', merchantRaw: 'Merchant' },
    };
    const descStmt = describeDuplicate(statementItem, expensesWithStmt);
    expect(descStmt.stale).toBe(false);
    expect(descStmt.imported?.id).toBe('e_stmt_1');
    expect(descStmt.manual?.[0]?.id).toBe('e_manual_1');

    // 2. describeUnknownAccount with null, broken payload, or null accounts
    expect(() => describeUnknownAccount(null, null, null)).not.toThrow();
    const descNullAcc = describeUnknownAccount(null, null, null);
    expect(descNullAcc.title).toBeDefined();
    expect(descNullAcc.subtitle).toBeDefined();
    expect(descNullAcc.suggestions).toEqual([]);

    expect(() => describeUnknownAccount({ payload: null }, 0, { a: null })).not.toThrow();
    expect(describeUnknownAccount({ payload: null }, 0, { a: null }).suggestions).toEqual([]);

    // 3. describeUnparsed with null or broken payloads
    expect(() => describeUnparsed(null)).not.toThrow();
    expect(describeUnparsed(null)).toEqual({ preview: '', receivedAt: '', address: '' });
    expect(() => describeUnparsed({ payload: null })).not.toThrow();
    expect(describeUnparsed({ payload: null })).toEqual({ preview: '', receivedAt: '', address: '' });
  });

  it('BUG 1 reproduction: groupReviewItems handles numeric epoch timestamps and missing fields without throwing', () => {
    const items = [
      { id: 'item_1', type: 'unknown_account', payload: { issuer: 'ICICI', digits: '1234', date: 1731000000000 } },
      { id: 'item_2', type: 'unknown_account', payload: { issuer: 'HDFC', digits: '5678', date: 1731005000000 } },
      { id: 'item_3', type: 'unparsed', payload: { body: 'test message', date: 1731002000000 } },
      { id: 'item_4', type: 'possible_duplicate', payload: { date: null } },
      null,
      {},
    ];
    const grouped = groupReviewItems(items);
    expect(grouped.unknownAccounts).toHaveLength(2);
    expect(grouped.unknownAccounts[0].id).toBe('item_2'); // Newer timestamp first
    expect(grouped.unknownAccounts[1].id).toBe('item_1');
    expect(grouped.unparsed).toHaveLength(1);
    expect(grouped.possibleDuplicates).toHaveLength(1);
  });

  it('runs runReviewItemsSelfTest over review items catching errors without throwing', () => {
    const items = [
      { id: '1', type: 'unknown_account', payload: { issuer: 'ICICI', digits: '1234' } },
      { id: '2', type: 'unparsed', payload: { body: 'SMS from bank 9876543210' } },
      { id: '3', type: 'possible_duplicate', payload: { importedId: 'exp_1', candidateIds: [] } },
      null,
      {},
    ];

    const result = runReviewItemsSelfTest(items, { accounts: [], expenses: {} });
    expect(result.failCount).toBe(0);
    expect(result.okCount).toBe(items.length);
    expect(result.failingTypes).toEqual([]);
    expect(result.errorMessages).toEqual([]);
  });
});

