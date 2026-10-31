import { describe, it, expect } from 'vitest';
import {
  validateExpenseForm,
  buildCreateData,
  buildPatch,
} from './expenseForm.js';
import { normalizeFilters } from './filters.js';

describe('PHASE P5 - Form and Filter Helpers', () => {
  describe('Expense Form Validation (validateExpenseForm)', () => {
    it('validates a complete valid form and converts amount to integer paise', () => {
      const res = validateExpenseForm({
        amount: '1,250.50',
        date: '2026-10-31',
        direction: 'debit',
        kind: 'spend',
        categoryId: 'cat_groceries',
        accountId: 'acc_icici_savings',
        mode: 'upi',
        merchant: 'Swiggy Instamart',
        note: 'Vegetables and dairy',
      });

      expect(res.ok).toBe(true);
      expect(res.value.amount_paise).toBe(125050);
      expect(res.value.date).toBe('2026-10-31');
      expect(res.value.direction).toBe('debit');
      expect(res.value.kind).toBe('spend');
      expect(res.value.category_id).toBe('cat_groceries');
      expect(res.value.account_id).toBe('acc_icici_savings');
      expect(res.value.mode).toBe('upi');
      expect(res.value.merchant_raw).toBe('Swiggy Instamart');
      expect(res.value.note).toBe('Vegetables and dairy');
    });

    it('rejects invalid amounts and dates with inline errors', () => {
      const res = validateExpenseForm({
        amount: 'invalid',
        date: '31-10-2026', // invalid format (expected YYYY-MM-DD)
      });

      expect(res.ok).toBe(false);
      expect(res.errors.amount).toBeDefined();
      expect(res.errors.date).toBeDefined();
    });

    it('normalizes Uncategorized category to null', () => {
      const res1 = validateExpenseForm({ amount: '500', date: '2026-10-31', categoryId: '__uncategorized__' });
      expect(res1.value.category_id).toBeNull();

      const res2 = validateExpenseForm({ amount: '500', date: '2026-10-31', categoryId: '' });
      expect(res2.value.category_id).toBeNull();
    });
  });

  describe('Event Payload Builders', () => {
    it('buildCreateData creates valid payload for expense.created with manual expenseId', () => {
      const value = {
        amount_paise: 25000,
        date: '2026-10-31',
        direction: 'debit',
        kind: 'spend',
        merchant_raw: 'Shell Petrol',
        category_id: 'cat_fuel',
        account_id: 'acc_axis_indianoil',
        mode: 'card',
        note: 'Fuel for car',
      };

      const data = buildCreateData(value, { deviceId: 'dev-phone1' });
      expect(data.expenseId).toMatch(/^e_[0-9a-f]{16}$/);
      expect(data.source).toBe('manual');
      expect(data.ref_no).toBeNull();
      expect(data.dedupe_key).toBeNull();
      expect(data.brand).toBeNull();
      expect(data.amount_paise).toBe(25000);
      expect(data.merchant_raw).toBe('Shell Petrol');
      expect(data.category_id).toBe('cat_fuel');
      expect(data.category_locked).toBe(1);
    });

    it('buildPatch detects changed fields and handles category lock rules', () => {
      const original = {
        id: 'e_1',
        amount_paise: 10000,
        date: '2026-10-30',
        direction: 'debit',
        kind: 'spend',
        merchant_raw: 'Old Store',
        category_id: 'cat_food',
        category_locked: 1,
        account_id: 'acc_icici',
        mode: 'card',
        note: 'Old note',
      };

      // 1. Single field change
      const patch1 = buildPatch(original, { note: 'New note' });
      expect(patch1).toEqual({ note: 'New note' });

      // 2. Multiple fields change
      const patch2 = buildPatch(original, { amount_paise: 15000, mode: 'upi' });
      expect(patch2).toEqual({ amount_paise: 15000, mode: 'upi' });

      // 3. No change returns null
      const patchNone = buildPatch(original, {
        amount_paise: 10000,
        date: '2026-10-30',
        direction: 'debit',
        kind: 'spend',
        merchant_raw: 'Old Store',
        category_id: 'cat_food',
        account_id: 'acc_icici',
        mode: 'card',
        note: 'Old note',
      });
      expect(patchNone).toBeNull();

      // 4. Category lock rule: changing category sets category_locked = 1
      const patchCat = buildPatch(original, { category_id: 'cat_dining' });
      expect(patchCat).toEqual({
        category_id: 'cat_dining',
        category_locked: 1,
      });

      // 5. Category lock rule: setting Uncategorized sets category_locked = 0
      const patchUncat = buildPatch(original, { category_id: null });
      expect(patchUncat).toEqual({
        category_id: null,
        category_locked: 0,
      });
    });
  });

  describe('Filter Normalization (normalizeFilters)', () => {
    const clock = () => Date.parse('2026-10-15T12:00:00.000Z');

    it('normalizes This month preset by default', () => {
      const f = normalizeFilters({ preset: 'This month' }, clock);
      expect(f.from).toBe('2026-10-01');
      expect(f.to).toBe('2026-10-31');
      expect(f.includeFixed).toBe(false);
    });

    it('normalizes Last month preset', () => {
      const f = normalizeFilters({ preset: 'Last month' }, clock);
      expect(f.from).toBe('2026-09-01');
      expect(f.to).toBe('2026-09-30');
    });

    it('normalizes All time preset (no date bounds)', () => {
      const f = normalizeFilters({ preset: 'All time' }, clock);
      expect(f.from).toBeUndefined();
      expect(f.to).toBeUndefined();
    });

    it('normalizes Custom range preset', () => {
      const f = normalizeFilters({
        preset: 'Custom range',
        from: '2026-10-05',
        to: '2026-10-20',
      }, clock);
      expect(f.from).toBe('2026-10-05');
      expect(f.to).toBe('2026-10-20');
    });

    it('handles category and uncategorizedOnly filters', () => {
      const f1 = normalizeFilters({ categoryId: 'cat_food' }, clock);
      expect(f1.categoryId).toBe('cat_food');
      expect(f1.uncategorizedOnly).toBeUndefined();

      const f2 = normalizeFilters({ categoryId: '__uncategorized__' }, clock);
      expect(f2.uncategorizedOnly).toBe(true);
      expect(f2.categoryId).toBeUndefined();
    });

    it('handles search text and includeFixed', () => {
      const f = normalizeFilters({
        text: '  amazon  ',
        includeFixed: true,
        accountId: 'acc_axis',
        mode: 'UPI',
        createdByDev: 'dev-123456',
      }, clock);

      expect(f.text).toBe('amazon');
      expect(f.includeFixed).toBe(true);
      expect(f.accountId).toBe('acc_axis');
      expect(f.mode).toBe('upi');
      expect(f.createdByDev).toBe('dev-123456');
    });
  });
});
