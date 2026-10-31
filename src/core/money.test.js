import { describe, it, expect } from 'vitest';
import {
  validatePaise,
  formatPaise,
  rupeesToPaise,
  paiseToRupees,
  addPaise,
  subtractPaise,
} from './money.js';

describe('money - integer paise calculations', () => {
  describe('validatePaise', () => {
    it('accepts positive and zero safe integers', () => {
      expect(validatePaise(0)).toBe(0);
      expect(validatePaise(100)).toBe(100);
      expect(validatePaise(999999999)).toBe(999999999);
    });

    it('accepts negative safe integers', () => {
      expect(validatePaise(-150)).toBe(-150);
    });

    it('rejects floating point numbers', () => {
      expect(() => validatePaise(12.5)).toThrow(TypeError);
    });

    it('rejects non-numeric values and NaN', () => {
      expect(() => validatePaise(NaN)).toThrow(TypeError);
      expect(() => validatePaise('100')).toThrow(TypeError);
      expect(() => validatePaise(null)).toThrow(TypeError);
      expect(() => validatePaise(undefined)).toThrow(TypeError);
    });
  });

  describe('formatPaise', () => {
    it('formats zero paise correctly', () => {
      expect(formatPaise(0)).toBe('₹0.00');
    });

    it('formats single-digit paise with leading zero', () => {
      expect(formatPaise(5)).toBe('₹0.05');
    });

    it('formats double-digit paise correctly', () => {
      expect(formatPaise(50)).toBe('₹0.50');
    });

    it('formats multi-rupee paise amounts', () => {
      expect(formatPaise(1250)).toBe('₹12.50');
      expect(formatPaise(100000)).toBe('₹1000.00');
    });

    it('formats negative paise amounts correctly', () => {
      expect(formatPaise(-250)).toBe('-₹2.50');
      expect(formatPaise(-5)).toBe('-₹0.05');
    });
  });

  describe('rupeesToPaise', () => {
    it('converts integers and floats to paise', () => {
      expect(rupeesToPaise(10)).toBe(1000);
      expect(rupeesToPaise(12.5)).toBe(1250);
      expect(rupeesToPaise(0.05)).toBe(5);
    });

    it('handles numeric string inputs', () => {
      expect(rupeesToPaise('49.99')).toBe(4999);
      expect(rupeesToPaise('100')).toBe(10000);
    });

    it('avoids floating point arithmetic issues', () => {
      // 0.1 + 0.2 in JS float is 0.30000000000000004
      expect(rupeesToPaise(0.1 + 0.2)).toBe(30);
    });

    it('throws error for invalid values', () => {
      expect(() => rupeesToPaise('abc')).toThrow(TypeError);
    });
  });

  describe('paiseToRupees', () => {
    it('converts integer paise to rupee strings with 2 decimals', () => {
      expect(paiseToRupees(0)).toBe('0.00');
      expect(paiseToRupees(5)).toBe('0.05');
      expect(paiseToRupees(50)).toBe('0.50');
      expect(paiseToRupees(1250)).toBe('12.50');
      expect(paiseToRupees(-500)).toBe('-5.00');
    });
  });

  describe('addPaise & subtractPaise', () => {
    it('adds two integer amounts correctly', () => {
      expect(addPaise(1050, 450)).toBe(1500);
    });

    it('subtracts two integer amounts correctly', () => {
      expect(subtractPaise(1500, 450)).toBe(1050);
    });

    it('rejects non-integer values when adding or subtracting', () => {
      expect(() => addPaise(10.5, 50)).toThrow(TypeError);
      expect(() => subtractPaise(100, 4.2)).toThrow(TypeError);
    });
  });
});

