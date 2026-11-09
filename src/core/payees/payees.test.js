import { describe, it, expect } from 'vitest';
import { extractUpiId, buildPayeeBrand, planPayeeRename, expenseTitle } from './payees.js';
import { categorize } from '../categorize/index.js';

describe('payee book', () => {
  it('finds a UPI id', () => {
    expect(extractUpiId('blinkit.payu@hdfcbank')).toBe('blinkit.payu@hdfcbank');
    expect(extractUpiId('RAMESH KUMAR')).toBeNull();
  });

  it('a named payee is applied to future imports ahead of starter brands', () => {
    const brand = buildPayeeBrand({ merchant: 'blinkit.payu@hdfcbank', name: 'Corner Shop' });
    const starter = { id: 's', name: 'Blinkit', pattern: 'BLINKIT', mode: 'words', priority: 10, active: true };
    expect(categorize({ merchantRaw: 'BLINKIT.PAYU@HDFCBANK' }, { brands: [starter, brand] }).brand).toBe('Corner Shop');
    expect(categorize({ merchantRaw: 'blinkit.payu@hdfcbank extra' }, { brands: [brand] }).brand).toBeNull();
  });

  it('keeps a stable id for the same payee', () => {
    expect(buildPayeeBrand({ merchant: 'A  b', name: 'x' }).id).toBe(buildPayeeBrand({ merchant: 'a B', name: 'y' }).id);
  });

  it('updates past expenses of that payee only', () => {
    const rows = [
      { id: '1', merchant_raw: 'RAMESH  KUMAR', status: 'active', brand: null },
      { id: '2', merchant_raw: 'ramesh kumar', status: 'active', brand: 'Done' },
      { id: '3', merchant_raw: 'SOMEONE', status: 'active', brand: null },
      { id: '4', merchant_raw: 'RAMESH KUMAR', status: 'deleted', brand: null },
    ];
    expect(planPayeeRename(rows, 'Ramesh Kumar', 'Done').map((e) => e.data.expenseId)).toEqual(['1']);
  });

  it('shows the saved name first', () => {
    expect(expenseTitle({ brand: 'Corner Shop', merchant_raw: 'x@y' })).toBe('Corner Shop');
    expect(expenseTitle({ merchant_raw: 'x@y' })).toBe('x@y');
    expect(expenseTitle({ note: 'n' })).toBe('n');
    expect(expenseTitle({})).toBe('Expense');
  });
});
