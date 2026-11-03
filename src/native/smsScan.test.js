import { describe, it, expect, beforeEach } from 'vitest';
import { scanSms } from './smsScan.js';
import { createSqljsAdapter } from '../core/db/testing/sqljsAdapter.js';
import { createMemoryStorage } from '../core/sync/testing/memoryStorage.js';
import { createWriter } from '../core/sync/writer.js';
import { migrate } from '../core/db/migrations.js';
import { rowsToState } from '../core/db/index.js';
import { seedIfEmpty } from '../core/seed/seed.js';
import { seedBrandsIfEmpty } from '../core/seed/brandSeed.js';

describe('src/native/smsScan.js - scanSms', () => {
  let db;
  let storage;
  let writer;

  beforeEach(async () => {
    db = await createSqljsAdapter();
    await migrate(db);
    storage = createMemoryStorage();
    writer = createWriter({ deviceId: 'dev_phone', storage, db });
    await writer.init();
    await seedIfEmpty({ writer, db });
    await seedBrandsIfEmpty({ writer, db });

    // Set allowlist in settings
    await db.exec('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);', [
      'sms_senders',
      JSON.stringify(['BANK_SMS']),
    ]);
  });

  const getState = async () => {
    const expenses = await db.query('SELECT * FROM expenses;');
    const categories = await db.query('SELECT * FROM categories;');
    const accounts = await db.query('SELECT * FROM accounts;');
    const brands = await db.query('SELECT * FROM brands;');
    const rules = await db.query('SELECT * FROM rules;');
    const review_queue = await db.query('SELECT * FROM review_queue;');
    return rowsToState({ expenses, categories, accounts, brands, rules, review_queue });
  };

  it('Refuses with NO_SENDERS_CONFIGURED when allowlist is empty', async () => {
    await db.exec("DELETE FROM settings WHERE key = 'sms_senders';");
    await expect(
      scanSms({
        readSms: async () => [],
        db,
        writer,
        getState,
        settings: { sms_senders: [] },
      })
    ).rejects.toThrow('No SMS senders configured');
  });

  it('Returns busy when a second scan is called concurrently', async () => {
    let slowResolve;
    const slowPromise = new Promise((resolve) => {
      slowResolve = resolve;
    });
    const slowReadSms = () => slowPromise;

    const promise1 = scanSms({
      readSms: slowReadSms,
      db,
      writer,
      getState,
    });

    const promise2 = scanSms({
      readSms: async () => [],
      db,
      writer,
      getState,
    });

    const result2 = await promise2;
    expect(result2).toEqual({ busy: true });

    slowResolve([]);
    await promise1;
  });

  it('First scan respects sinceDays; second scan reads from watermark minus 1 day', async () => {
    let capturedSince = null;
    const nowMs = 1700000000000;
    const fakeMsg = {
      address: 'BANK_SMS',
      body: 'Your OTP is 123456',
      date: nowMs - 5000,
    };

    // First scan: no watermark
    await scanSms({
      readSms: async ({ sinceEpochMs }) => {
        capturedSince = sinceEpochMs;
        return [fakeMsg];
      },
      db,
      writer,
      getState,
      now: () => nowMs,
      sinceDays: 30,
    });

    // Expect sinceEpochMs to be now - 30 days
    expect(capturedSince).toBe(nowMs - 30 * 24 * 60 * 60 * 1000);

    // Check watermark saved
    const rows = await db.query("SELECT value FROM settings WHERE key = 'sms_last_scan_ms';");
    expect(rows[0]?.value).toBe(String(fakeMsg.date));

    // Second scan: reads from watermark minus 1 day
    let secondCapturedSince = null;
    await scanSms({
      readSms: async ({ sinceEpochMs }) => {
        secondCapturedSince = sinceEpochMs;
        return [];
      },
      db,
      writer,
      getState,
      now: () => nowMs + 10000,
    });

    expect(secondCapturedSince).toBe(fakeMsg.date - 24 * 60 * 60 * 1000);
  });

  it('Batch loop handles exactly 500, 501, and 1200 messages correctly', async () => {
    // Test 500 messages
    const msgs500 = Array.from({ length: 500 }, (_, i) => ({
      address: 'BANK_SMS',
      body: `OTP ${i}`,
      date: 1700000000000 + i * 1000,
    }));

    let callCount = 0;
    const read500 = async ({ limit }) => {
      callCount++;
      if (callCount === 1) return msgs500;
      return []; // Second call returns 0 (< 500), terminates
    };

    const res500 = await scanSms({
      readSms: read500,
      db,
      writer,
      getState,
    });
    expect(res500.scanned).toBe(500);
    expect(callCount).toBe(2);

    // Test 501 messages
    const msgs501 = Array.from({ length: 501 }, (_, i) => ({
      address: 'BANK_SMS',
      body: `OTP 501_${i}`,
      date: 1700001000000 + i * 1000,
    }));

    let callCount501 = 0;
    const read501 = async () => {
      callCount501++;
      if (callCount501 === 1) return msgs501.slice(0, 500);
      if (callCount501 === 2) return msgs501.slice(500); // returns 1 (< 500), terminates
      return [];
    };

    const res501 = await scanSms({
      readSms: read501,
      db,
      writer,
      getState,
    });
    expect(res501.scanned).toBe(501);
    expect(callCount501).toBe(2);

    // Test 1200 messages
    const msgs1200 = Array.from({ length: 1200 }, (_, i) => ({
      address: 'BANK_SMS',
      body: `OTP 1200_${i}`,
      date: 1700002000000 + i * 1000,
    }));

    let callCount1200 = 0;
    const read1200 = async () => {
      callCount1200++;
      if (callCount1200 === 1) return msgs1200.slice(0, 500);
      if (callCount1200 === 2) return msgs1200.slice(500, 1000);
      if (callCount1200 === 3) return msgs1200.slice(1000); // returns 200 (< 500), terminates
      return [];
    };

    const res1200 = await scanSms({
      readSms: read1200,
      db,
      writer,
      getState,
    });
    expect(res1200.scanned).toBe(1200);
    expect(callCount1200).toBe(3);
  });

  it('reports correct stopReason and allowedCount', async () => {
    const nowMs = 1700000000000;

    // Case 1: 0 messages scanned
    const resEmpty = await scanSms({
      readSms: async () => [],
      db,
      writer,
      getState,
      now: () => nowMs,
      sinceDays: 60,
    });
    expect(resEmpty.scanned).toBe(0);
    expect(resEmpty.allowedCount).toBe(0);
    expect(resEmpty.stopReason).toBe('no messages received in the last 60 days');

    // Case 2: messages exist but none from allowed sender ('BANK_SMS')
    const resSkipped = await scanSms({
      readSms: async () => [
        { address: 'SPAM_SENDER', body: 'Spam text', date: nowMs - 1000 },
      ],
      db,
      writer,
      getState,
      now: () => nowMs,
      sinceDays: 60,
    });
    expect(resSkipped.scanned).toBe(1);
    expect(resSkipped.allowedCount).toBe(0);
    expect(resSkipped.stopReason).toBe('no messages in the last 60 days from the allowed senders');

    // Case 3: messages from allowed sender
    const resAllowed = await scanSms({
      readSms: async () => [
        { address: 'BANK_SMS', body: 'OTP 999', date: nowMs - 1000 },
      ],
      db,
      writer,
      getState,
      now: () => nowMs,
      sinceDays: 60,
    });
    expect(resAllowed.scanned).toBe(1);
    expect(resAllowed.allowedCount).toBe(1);
    expect(resAllowed.stopReason).toBe('reached watermark');
  });

  it('resets stale watermark when in future, lastScanReadCount is 0, or ignoreWatermark is true', async () => {
    const nowMs = 1700000000000;
    const defaultSince = nowMs - 60 * 24 * 60 * 60 * 1000;

    // 1. Watermark in future (lastScanMs >= nowMs)
    await db.exec('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);', [
      'sms_last_scan_ms',
      String(nowMs + 5000),
    ]);
    await db.exec('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);', [
      'sms_last_scan_read_count',
      '10',
    ]);

    let capturedSince = null;
    await scanSms({
      readSms: async ({ sinceEpochMs }) => {
        capturedSince = sinceEpochMs;
        return [];
      },
      db,
      writer,
      getState,
      now: () => nowMs,
      sinceDays: 60,
    });
    expect(capturedSince).toBe(defaultSince);

    // 2. lastScanReadCount is 0
    await db.exec('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);', [
      'sms_last_scan_ms',
      String(nowMs - 500000),
    ]);
    await db.exec('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);', [
      'sms_last_scan_read_count',
      '0',
    ]);

    let capturedSince2 = null;
    await scanSms({
      readSms: async ({ sinceEpochMs }) => {
        capturedSince2 = sinceEpochMs;
        return [];
      },
      db,
      writer,
      getState,
      now: () => nowMs,
      sinceDays: 60,
    });
    expect(capturedSince2).toBe(defaultSince);

    // 3. ignoreWatermark is true
    await db.exec('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);', [
      'sms_last_scan_ms',
      String(nowMs - 500000),
    ]);
    await db.exec('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);', [
      'sms_last_scan_read_count',
      '5',
    ]);

    let capturedSince3 = null;
    await scanSms({
      readSms: async ({ sinceEpochMs }) => {
        capturedSince3 = sinceEpochMs;
        return [];
      },
      db,
      writer,
      getState,
      now: () => nowMs,
      sinceDays: 60,
      ignoreWatermark: true,
    });
    expect(capturedSince3).toBe(defaultSince);
  });
});
