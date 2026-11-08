import { describe, it, expect, beforeEach } from 'vitest';
import {
  isLikelyBankMessage,
  findLikelyBankSenderAddresses,
  removeReviewItemsFromDisallowedSenders,
} from './sendersCleanup.js';
import { createSqljsAdapter } from '../db/testing/sqljsAdapter.js';
import { migrate } from '../db/migrations.js';

describe('BUG 3: Senders Cleanup & Likely Bank Detection', () => {
  describe('isLikelyBankMessage & findLikelyBankSenderAddresses', () => {
    it('identifies parsed bank messages as likely banks', () => {
      const axisMsg = {
        address: 'AD-AXISBK',
        body: 'Spent INR 500.00\nAxis Bank Card no. XX3765\n01-02-26 14:30:00 IST\nSWIGGY\nAvl Limit: INR 50,000',
        date: 1738368000000,
      };
      expect(isLikelyBankMessage(axisMsg)).toBe(true);
    });

    it('identifies ignored bank messages as likely banks', () => {
      const hdfcOtp = {
        address: 'VM-HDFCBK',
        body: 'Your OTP for HDFC Bank NetBanking transaction is 123456. Do not share.',
        date: 1738368000000,
      };
      expect(isLikelyBankMessage(hdfcOtp)).toBe(true);

      const iciciIgnored = {
        address: 'BP-ICICIB',
        body: 'Your secret OTP for ICICI Bank login is 987654. Valid for 5 mins.',
        date: 1738368000000,
      };
      expect(isLikelyBankMessage(iciciIgnored)).toBe(true);

      const idfcIgnored = {
        address: 'IDFCFB',
        body: 'Your one time password (OTP) for IDFC Bank card payment is 556677.',
        date: 1738368000000,
      };
      expect(isLikelyBankMessage(idfcIgnored)).toBe(true);
    });

    it('does NOT identify non-bank promo or spam messages as likely banks', () => {
      const swiggyPromo = {
        address: 'SWIGGY',
        body: 'Hungry? Get 50% off on your next food order with code YUM50!',
        date: 1738368000000,
      };
      expect(isLikelyBankMessage(swiggyPromo)).toBe(false);

      const randomSpam = {
        address: 'VK-CASINO',
        body: 'Claim your bonus INR 1000 today at our gaming portal.',
        date: 1738368000000,
      };
      expect(isLikelyBankMessage(randomSpam)).toBe(false);
    });

    it('findLikelyBankSenderAddresses extracts only banks from messages', () => {
      const messages = [
        {
          address: 'AD-AXISBK',
          body: 'Spent INR 100.00\nAxis Bank Card no. XX3765\n01-02-26 14:30:00 IST\nAMAZON',
          date: 1738368000000,
        },
        { address: 'SWIGGY', body: 'Order confirmed', date: 1738368000000 },
        { address: 'VM-HDFCBK', body: 'Your HDFC Bank OTP is 4455', date: 1738368000000 },
        { address: 'VK-PROMO', body: 'Personal loan approved', date: 1738368000000 },
      ];

      const bankSenders = findLikelyBankSenderAddresses(messages);
      expect(bankSenders.has('AD-AXISBK')).toBe(true);
      expect(bankSenders.has('VM-HDFCBK')).toBe(true);
      expect(bankSenders.has('SWIGGY')).toBe(false);
      expect(bankSenders.has('VK-PROMO')).toBe(false);
      expect(bankSenders.size).toBe(2);
    });
  });

  describe('removeReviewItemsFromDisallowedSenders', () => {
    let db;
    let writtenEvents;
    let mockWriter;

    beforeEach(async () => {
      db = await createSqljsAdapter();
      await migrate(db);

      writtenEvents = [];
      mockWriter = {
        write: async (type, data) => {
          writtenEvents.push({ type, data });
        },
      };

      // Seed some open review items in review_queue
      await db.exec(
        `INSERT INTO review_queue (id, type, payload, status) VALUES
          ('rv_allowed_unparsed', 'unparsed', '{"address":"AD-HDFCBK","body":"test"}', 'open'),
          ('rv_disallowed_unparsed', 'unparsed', '{"address":"VK-CASINOPROMO","body":"casino"}', 'open'),
          ('rv_held_disallowed', 'unknown_account', '{"issuer":"idfc","digits":"9999","address":"UNKNOWN-SENDER"}', 'open');`
      );
    });

    it('resolves unparsed and held items whose stored address is not allowed and writes review.resolved', async () => {
      const allowlist = ['AD-HDFCBK'];

      const res = await removeReviewItemsFromDisallowedSenders({
        db,
        writer: mockWriter,
        allowlist,
      });

      expect(res.count).toBe(2);
      expect(res.resolvedIds).toContain('rv_disallowed_unparsed');
      expect(res.resolvedIds).toContain('rv_held_disallowed');
      expect(res.resolvedIds).not.toContain('rv_allowed_unparsed');

      // Verify review.resolved events written
      expect(writtenEvents).toHaveLength(2);
      expect(writtenEvents.every((e) => e.type === 'review.resolved')).toBe(true);
      expect(writtenEvents.every((e) => e.data.decision === 'dismissed')).toBe(true);

      // Verify SQLite status updated
      const rows = await db.query('SELECT id, status FROM review_queue ORDER BY id ASC;');
      const allowed = rows.find((r) => r.id === 'rv_allowed_unparsed');
      const disallowed = rows.find((r) => r.id === 'rv_disallowed_unparsed');
      const held = rows.find((r) => r.id === 'rv_held_disallowed');

      expect(allowed?.status).toBe('open');
      expect(disallowed?.status).toBe('resolved');
      expect(held?.status).toBe('resolved');
    });
  });
});
