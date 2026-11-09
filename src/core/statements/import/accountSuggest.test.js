import { describe, it, expect } from 'vitest';
import { suggestStatementAccount, addAccountAlias } from './accountSuggest.js';

const accounts = [
  { id: 'acc_axis_flipkart', name: 'Axis Flipkart 3765', issuer: 'Axis', lastDigits: '3765', type: 'card' },
  { id: 'acc_icici_amazonpay', name: 'ICICI Amazon Pay 6017', issuer: 'ICICI', lastDigits: '6017', type: 'card' },
];

describe('suggestStatementAccount', () => {
  it('never falls back to the first account when nothing matches', () => {
    const res = suggestStatementAccount({ issuer: 'icici', digits: '7922' }, accounts);
    expect(res.accountId).toBeNull();
    expect(res.candidates.map((c) => c.id)).toEqual(['acc_icici_amazonpay']);
  });

  it('matches issuer and lastDigits, the field seeded accounts actually use', () => {
    expect(suggestStatementAccount({ issuer: 'icici', digits: '6017' }, accounts).accountId).toBe('acc_icici_amazonpay');
  });

  it('matches a saved alias', () => {
    const list = [{ ...accounts[1], aliases: [{ issuer: 'icici', digits: '7922' }] }, accounts[0]];
    expect(suggestStatementAccount({ issuer: 'icici', digits: '7922' }, list).accountId).toBe('acc_icici_amazonpay');
  });

  it('does not match the right digits at another bank', () => {
    expect(suggestStatementAccount({ issuer: 'hdfc', digits: '3765' }, accounts).accountId).toBeNull();
  });

  it('reports an issuer mismatch for a chosen account', () => {
    const res = suggestStatementAccount({ issuer: 'icici', digits: '7922' }, accounts, 'acc_axis_flipkart');
    expect(res.issuerMismatch).toBe(true);
    expect(suggestStatementAccount({ issuer: 'icici', digits: '7922' }, accounts, 'acc_icici_amazonpay').issuerMismatch).toBe(false);
  });

  it('adds an alias once', () => {
    const once = addAccountAlias(accounts[1], { issuer: 'icici', digits: '7922' });
    expect(once.aliases).toEqual([{ issuer: 'icici', digits: '7922' }]);
    expect(addAccountAlias(once, { issuer: 'icici', digits: '7922' })).toBeNull();
  });
});
