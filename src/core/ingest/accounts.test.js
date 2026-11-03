import { describe, it, expect } from 'vitest';
import { matchAccount } from './accounts.js';

describe('src/core/ingest/accounts.js', () => {
  const accounts = [
    {
      id: 'acc_icici_amazonpay',
      issuer: 'ICICI',
      lastDigits: '6017',
      aliases: [{ issuer: 'ICICI', digits: '7922' }],
    },
    {
      id: 'acc_hdfc_pixel',
      issuer: 'HDFC',
      lastDigits: '3726',
    },
  ];

  it('matches primary account by issuer and last 3 digits', () => {
    expect(matchAccount('icici', '6017', accounts)).toBe('acc_icici_amazonpay');
    expect(matchAccount('ICICI', '017', accounts)).toBe('acc_icici_amazonpay');
  });

  it('matches by alias', () => {
    expect(matchAccount('icici', '7922', accounts)).toBe('acc_icici_amazonpay');
    expect(matchAccount('ICICI', '922', accounts)).toBe('acc_icici_amazonpay');
  });

  it('returns null if no account or alias matches', () => {
    expect(matchAccount('icici', '9999', accounts)).toBeNull();
    expect(matchAccount('axis', '6017', accounts)).toBeNull();
  });

  it('returns null if ambiguous across multiple distinct accounts', () => {
    const ambiguousAccounts = [
      ...accounts,
      {
        id: 'acc_icici_other',
        issuer: 'ICICI',
        lastDigits: '922',
      },
    ];
    expect(matchAccount('icici', '7922', ambiguousAccounts)).toBeNull();
  });

  it('handles multiple aliases matching the same account without ambiguity', () => {
    const singleAccountMultiAlias = [
      {
        id: 'acc_test',
        issuer: 'ICICI',
        lastDigits: '922',
        aliases: [{ issuer: 'ICICI', digits: '7922' }],
      },
    ];
    expect(matchAccount('icici', '7922', singleAccountMultiAlias)).toBe('acc_test');
  });
});

