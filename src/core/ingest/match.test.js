import { describe, it, expect } from 'vitest';
import { findRefundOriginal, findManualCandidates, firstAlphaNumericToken } from './match.js';

describe('src/core/ingest/match.js', () => {
  describe('firstAlphaNumericToken', () => {
    it('extracts lowercased first alphanumeric token', () => {
      expect(firstAlphaNumericToken('POLICYBAZAAR*123')).toBe('policybazaar');
      expect(firstAlphaNumericToken('   SWIGGY 456')).toBe('swiggy');
      expect(firstAlphaNumericToken('***')).toBe('');
      expect(firstAlphaNumericToken(null)).toBe('');
    });
  });

  describe('findRefundOriginal', () => {
    const origExpense = {
      id: 'exp_orig_1',
      accountId: 'acc_icici_coral',
      amountPaise: 99055,
      direction: 'debit',
      kind: 'spend',
      date: '2026-06-01',
      brand: 'brand_policybazaar',
      categoryId: 'cat_insurance',
      merchantRaw: 'POLICYBAZAAR',
      status: 'active',
    };

    it('matches exactly one candidate within 90 days', () => {
      const refundTxn = {
        direction: 'credit',
        kind: 'spend',
        accountId: 'acc_icici_coral',
        amountPaise: 200,
        date: '2026-07-07',
        brand: 'brand_policybazaar',
        merchantRaw: 'POLICYBAZAAR',
      };

      const match = findRefundOriginal({ txn: refundTxn, expenses: [origExpense] });
      expect(match).toEqual({
        id: 'exp_orig_1',
        categoryId: 'cat_insurance',
        brand: 'brand_policybazaar',
      });
    });

    it('returns null if there are two possible candidates', () => {
      const orig2 = { ...origExpense, id: 'exp_orig_2' };
      const refundTxn = {
        direction: 'credit',
        kind: 'spend',
        accountId: 'acc_icici_coral',
        amountPaise: 200,
        date: '2026-07-07',
        brand: 'brand_policybazaar',
        merchantRaw: 'POLICYBAZAAR',
      };

      const match = findRefundOriginal({ txn: refundTxn, expenses: [origExpense, orig2] });
      expect(match).toBeNull();
    });

    it('returns null if original is older than 90 days', () => {
      const refundTxn = {
        direction: 'credit',
        kind: 'spend',
        accountId: 'acc_icici_coral',
        amountPaise: 200,
        date: '2026-10-01', // > 90 days after 2026-06-01
        brand: 'brand_policybazaar',
        merchantRaw: 'POLICYBAZAAR',
      };

      const match = findRefundOriginal({ txn: refundTxn, expenses: [origExpense] });
      expect(match).toBeNull();
    });

    it('returns null if amount of candidate is less than refund', () => {
      const smallOrig = { ...origExpense, amountPaise: 100 };
      const refundTxn = {
        direction: 'credit',
        kind: 'spend',
        accountId: 'acc_icici_coral',
        amountPaise: 200,
        date: '2026-07-07',
        brand: 'brand_policybazaar',
        merchantRaw: 'POLICYBAZAAR',
      };

      const match = findRefundOriginal({ txn: refundTxn, expenses: [smallOrig] });
      expect(match).toBeNull();
    });
  });

  describe('findManualCandidates', () => {
    const manualExp = {
      id: 'exp_manual_1',
      source: 'manual',
      accountId: 'acc_hdfc_pixel',
      amountPaise: 36000,
      direction: 'debit',
      date: '2026-10-27',
      status: 'active',
    };

    it('finds manual expense on same account, amount, direction within 1 day', () => {
      const txn = {
        accountId: 'acc_hdfc_pixel',
        amountPaise: 36000,
        direction: 'debit',
        date: '2026-10-27',
      };
      const res = findManualCandidates({ txn, expenses: [manualExp] });
      expect(res).toEqual(['exp_manual_1']);
    });

    it('matches when date is 1 day apart', () => {
      const txn = {
        accountId: 'acc_hdfc_pixel',
        amountPaise: 36000,
        direction: 'debit',
        date: '2026-10-28',
      };
      const res = findManualCandidates({ txn, expenses: [manualExp] });
      expect(res).toEqual(['exp_manual_1']);
    });

    it('ignores if more than 1 day apart', () => {
      const txn = {
        accountId: 'acc_hdfc_pixel',
        amountPaise: 36000,
        direction: 'debit',
        date: '2026-10-30',
      };
      const res = findManualCandidates({ txn, expenses: [manualExp] });
      expect(res).toEqual([]);
    });

    it('ignores non-manual expenses', () => {
      const smsExp = { ...manualExp, source: 'sms' };
      const txn = {
        accountId: 'acc_hdfc_pixel',
        amountPaise: 36000,
        direction: 'debit',
        date: '2026-10-27',
      };
      const res = findManualCandidates({ txn, expenses: [smsExp] });
      expect(res).toEqual([]);
    });
  });
});

