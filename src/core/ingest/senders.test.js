import { describe, it, expect } from 'vitest';
import { listSenders, isAllowed, assertSendersConfigured, sanitizeAllowlist } from './senders.js';

describe('src/core/ingest/senders.js', () => {
  it('aggregates messages and sorts by financial descending', () => {
    const messages = [
      { address: 'AX-AXISBK', body: 'INR 500 spent on Axis Card 3765', date: 1000 },
      { address: 'AX-AXISBK', body: 'INR 100 spent on Axis Card 3765', date: 2000 },
      { address: 'PROMO-SND', body: '50% discount today only!', date: 3000 },
      { address: 'VM-HDFCBK', body: 'Rs. 360 spent on HDFC Bank Card', date: 4000 },
      { address: '', body: 'Empty sender msg', date: 5000 },
      { address: null, body: 'Null sender msg', date: 6000 },
    ];

    const result = listSenders(messages);
    expect(result).toHaveLength(3);

    // AX-AXISBK has 2 financial messages
    expect(result[0].address).toBe('AX-AXISBK');
    expect(result[0].total).toBe(2);
    expect(result[0].financial).toBe(2);

    // VM-HDFCBK has 1 financial message
    expect(result[1].address).toBe('VM-HDFCBK');
    expect(result[1].total).toBe(1);
    expect(result[1].financial).toBe(1);

    // PROMO-SND has 0 financial messages
    expect(result[2].address).toBe('PROMO-SND');
    expect(result[2].total).toBe(1);
    expect(result[2].financial).toBe(0);

    // Empty sender count
    expect(result.emptySenderCount).toBe(2);
  });

  it('sanitizes allowlist by stripping invalid items', () => {
    const dirty = [null, undefined, '', '   ', 123, 'AX-AXISBK', '  VM-HDFCBK  ', 'ax-axisbk'];
    const clean = sanitizeAllowlist(dirty);
    expect(clean).toEqual(['AX-AXISBK', 'VM-HDFCBK']);
  });

  it('checks allowlist correctly with isAllowed', () => {
    const allowlist = ['AX-AXISBK', 'VM-HDFCBK'];
    expect(isAllowed('AX-AXISBK', allowlist)).toBe(true);
    expect(isAllowed('VM-HDFCBK', allowlist)).toBe(true);
    expect(isAllowed('PROMO-SND', allowlist)).toBe(false);
    expect(isAllowed('AX-AXISBK', null)).toBe(false);
  });

  it('throws NO_SENDERS_CONFIGURED when allowlist is empty or missing or contains only invalid entries', () => {
    expect(() => assertSendersConfigured(null)).toThrowError();
    try {
      assertSendersConfigured([]);
    } catch (err) {
      expect(err.code).toBe('NO_SENDERS_CONFIGURED');
    }
    try {
      assertSendersConfigured([null, '   ']);
    } catch (err) {
      expect(err.code).toBe('NO_SENDERS_CONFIGURED');
    }
  });
});
