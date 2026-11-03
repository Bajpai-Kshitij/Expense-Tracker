import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { readSms, setExpenseNativePlugin } from './expenseNative.js';
import { listSenders } from '../core/ingest/senders.js';

describe('STEP 1 - Native readSms to listSenders chain', () => {
  let mockPlugin;

  beforeEach(() => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'getPlatform').mockReturnValue('android');

    mockPlugin = {
      readSms: vi.fn(),
    };
    setExpenseNativePlugin(mockPlugin);
  });

  it('fails before fix when listSenders lacks sender/totalCount/financialCount matching Java output', async () => {
    // Java ExpenseNativePlugin.java returns: JSObject ret with "sms" JSArray containing "id", "address", "body", "date"
    const javaNativeOutput = {
      sms: [
        {
          id: '101',
          address: 'VM-HDFCBK',
          body: 'Spent INR 500 on HDFC Card XX7068 at STORE on 12-10-26',
          date: 1768896000000,
        },
      ],
    };

    mockPlugin.readSms.mockResolvedValue(javaNativeOutput);

    // 1. Call wrapper
    const messages = await readSms({ sinceEpochMs: 0, limit: 10 });
    expect(messages).toHaveLength(1);
    expect(messages[0].address).toBe('VM-HDFCBK');

    // 2. Pass to listSenders
    const senders = listSenders(messages);
    expect(senders).toHaveLength(1);

    // 3. Assert fields required by consumer components
    expect(senders[0].address).toBe('VM-HDFCBK');
    expect(senders[0].total).toBe(1);
    expect(senders[0].financial).toBe(1);

    // These fields are expected by UI: sender, totalCount, financialCount
    expect(senders[0].sender).toBe('VM-HDFCBK');
    expect(senders[0].totalCount).toBe(1);
    expect(senders[0].financialCount).toBe(1);
  });
});

