import { describe, it, expect } from 'vitest';
import { parseHouseholdNames } from './household.js';

describe('BUG 4: parseHouseholdNames', () => {
  it('handles null, undefined, empty string', () => {
    expect(parseHouseholdNames(null)).toEqual([]);
    expect(parseHouseholdNames(undefined)).toEqual([]);
    expect(parseHouseholdNames('')).toEqual([]);
    expect(parseHouseholdNames('   ')).toEqual([]);
  });

  it('parses comma-separated names with trimming', () => {
    expect(parseHouseholdNames('John Doe, Jane Doe')).toEqual(['John Doe', 'Jane Doe']);
    expect(parseHouseholdNames('  Alice Smith  ,   Bob Smith  ')).toEqual(['Alice Smith', 'Bob Smith']);
  });

  it('parses newline-separated names', () => {
    expect(parseHouseholdNames('John Doe\nJane Doe')).toEqual(['John Doe', 'Jane Doe']);
    expect(parseHouseholdNames('John Doe\r\nJane Doe\nAlex Doe')).toEqual([
      'John Doe',
      'Jane Doe',
      'Alex Doe',
    ]);
  });

  it('parses mixed commas and newlines', () => {
    const input = 'John Doe, Jane Doe\nAlice Smith, Bob Smith\r\nCharlie';
    expect(parseHouseholdNames(input)).toEqual([
      'John Doe',
      'Jane Doe',
      'Alice Smith',
      'Bob Smith',
      'Charlie',
    ]);
  });

  it('deduplicates names case-insensitively while preserving first casing', () => {
    expect(parseHouseholdNames('Jane Doe, jane doe, JANE DOE, John')).toEqual([
      'Jane Doe',
      'John',
    ]);
  });
});
