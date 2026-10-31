import { describe, it, expect } from 'vitest';
import { parseRupees, formatPaise } from './money.js';
import {
  getTodayIst,
  getThisMonthRange,
  getLastMonthRange,
  getDateRangePreset,
  formatDateDisplay,
} from './dates.js';

describe('PHASE P5 - Format Helpers', () => {
  describe('Money Parsing (parseRupees)', () => {
    it('accepts standard formatted amounts and returns exact integer paise without floating-point math', () => {
      expect(parseRupees('1,250')).toEqual({ ok: true, paise: 125000 });
      expect(parseRupees('1250.5')).toEqual({ ok: true, paise: 125050 });
      expect(parseRupees('1250.50')).toEqual({ ok: true, paise: 125050 });
      expect(parseRupees('100')).toEqual({ ok: true, paise: 10000 });
      expect(parseRupees('0.5')).toEqual({ ok: true, paise: 50 });
      expect(parseRupees('0.05')).toEqual({ ok: true, paise: 5 });
      expect(parseRupees('1,00,000.00')).toEqual({ ok: true, paise: 10000000 });
      expect(parseRupees(' 42.99 ')).toEqual({ ok: true, paise: 4299 });
    });

    it('avoids floating point rounding traps like 0.1 + 0.2', () => {
      const p1 = parseRupees('0.1');
      const p2 = parseRupees('0.2');
      expect(p1.ok).toBe(true);
      expect(p2.ok).toBe(true);
      expect(p1.paise).toBe(10);
      expect(p2.paise).toBe(20);
      expect(p1.paise + p2.paise).toBe(30); // Exactly 30 paise
    });

    it('rejects empty or whitespace inputs', () => {
      expect(parseRupees('')).toEqual({ ok: false, error: 'Amount cannot be empty' });
      expect(parseRupees('   ')).toEqual({ ok: false, error: 'Amount cannot be empty' });
      expect(parseRupees(null)).toEqual({ ok: false, error: 'Amount is required' });
      expect(parseRupees(undefined)).toEqual({ ok: false, error: 'Amount is required' });
    });

    it('rejects zero amounts', () => {
      expect(parseRupees('0').ok).toBe(false);
      expect(parseRupees('0.0').ok).toBe(false);
      expect(parseRupees('0.00').ok).toBe(false);
    });

    it('rejects negative amounts', () => {
      expect(parseRupees('-10').ok).toBe(false);
      expect(parseRupees('-0.50').ok).toBe(false);
      expect(parseRupees('-1250.50').error).toBe('Amount cannot be negative');
    });

    it('rejects non-numeric characters and letters', () => {
      expect(parseRupees('12a').ok).toBe(false);
      expect(parseRupees('abc').ok).toBe(false);
      expect(parseRupees('₹100').ok).toBe(false);
      expect(parseRupees('12.3.4').ok).toBe(false);
    });

    it('rejects more than 2 decimal places', () => {
      expect(parseRupees('12.345')).toEqual({
        ok: false,
        error: 'Amount cannot have more than 2 decimal places',
      });
      expect(parseRupees('0.001').ok).toBe(false);
    });
  });

  describe('Money Formatting (formatPaise)', () => {
    it('formats amounts in Indian grouping (thousands, lakhs, crores)', () => {
      expect(formatPaise(10000000)).toBe('₹1,00,000.00'); // 1 Lakh
      expect(formatPaise(1000000000)).toBe('₹1,00,00,000.00'); // 1 Crore
      expect(formatPaise(125050)).toBe('₹1,250.50');
      expect(formatPaise(1250)).toBe('₹12.50');
      expect(formatPaise(100)).toBe('₹1.00');
      expect(formatPaise(50)).toBe('₹0.50');
      expect(formatPaise(5)).toBe('₹0.05');
      expect(formatPaise(0)).toBe('₹0.00');
    });

    it('handles negative paise with minus sign', () => {
      expect(formatPaise(-1250)).toBe('-₹12.50');
      expect(formatPaise(-10000000)).toBe('-₹1,00,000.00');
    });
  });

  describe('Dates in Indian Standard Time (IST)', () => {
    it('correctly resolves today in IST across midnight and timezone edge', () => {
      // 2026-10-31 19:00:00 UTC = 2026-11-01 00:30:00 IST (UTC + 5:30)
      const clockEdge = () => Date.parse('2026-10-31T19:00:00.000Z');
      expect(getTodayIst(clockEdge)).toBe('2026-11-01');

      // 2026-10-31 18:00:00 UTC = 2026-10-31 23:30:00 IST
      const clockBefore = () => Date.parse('2026-10-31T18:00:00.000Z');
      expect(getTodayIst(clockBefore)).toBe('2026-10-31');
    });

    it('calculates this month range in IST', () => {
      const clock = () => Date.parse('2026-10-15T12:00:00.000Z');
      expect(getThisMonthRange(clock)).toEqual({
        from: '2026-10-01',
        to: '2026-10-31',
      });
    });

    it('calculates leap year February month range', () => {
      // Feb 2028 is a leap year (29 days)
      const clockLeap = () => Date.parse('2028-02-10T12:00:00.000Z');
      expect(getThisMonthRange(clockLeap)).toEqual({
        from: '2028-02-01',
        to: '2028-02-29',
      });
    });

    it('calculates last month range in IST including year boundary', () => {
      // January 2027 -> previous month is Dec 2026
      const clockJan = () => Date.parse('2027-01-15T10:00:00.000Z');
      expect(getLastMonthRange(clockJan)).toEqual({
        from: '2026-12-01',
        to: '2026-12-31',
      });

      // November 2026 -> previous month is Oct 2026
      const clockNov = () => Date.parse('2026-11-05T10:00:00.000Z');
      expect(getLastMonthRange(clockNov)).toEqual({
        from: '2026-10-01',
        to: '2026-10-31',
      });
    });

    it('resolves date range presets', () => {
      const clock = () => Date.parse('2026-10-15T12:00:00.000Z');
      expect(getDateRangePreset('this_month', clock)).toEqual({
        from: '2026-10-01',
        to: '2026-10-31',
      });
      expect(getDateRangePreset('all_time', clock)).toEqual({
        from: null,
        to: null,
      });
    });

    it('formats date strings for display', () => {
      expect(formatDateDisplay('2026-10-30')).toBe('30 Oct 2026');
      expect(formatDateDisplay('2026-05-04')).toBe('4 May 2026');
      expect(formatDateDisplay('2026-01-01T15:30:00+05:30')).toBe('1 Jan 2026');
    });
  });
});

