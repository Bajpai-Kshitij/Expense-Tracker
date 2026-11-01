import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseSms, registerParser, getParsers } from './index.js';
import { axisParser } from './issuers/axis.js';
import { iciciParser } from './issuers/icici.js';
import { hdfcParser } from './issuers/hdfc.js';
import { parseAmountToPaise, parseDateToken, parseTimeToken, toTxnTs, prepareBody } from './normalize.js';
import { matchAccount } from './accounts.js';
import { formatAccountKey, formatCompactDateTime } from './keys.js';
import { SEED_ACCOUNTS } from '../seed/seed.js';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');
const expectedResults = JSON.parse(
  fs.readFileSync(path.join(FIXTURES_DIR, 'expected.json'), 'utf-8')
);

describe('PHASE P7a/P7b - SMS Ingest Framework & Parsers', () => {
  const context = { accounts: SEED_ACCOUNTS, ownerNames: ['Test Owner'] };

  describe('Fixtures Parameterized Tests', () => {
    const fixtureNames = Object.keys(expectedResults);

    it.each(fixtureNames)('parses fixture %s correctly', (fileName) => {
      const filePath = path.join(FIXTURES_DIR, fileName);
      const body = fs.readFileSync(filePath, 'utf-8');
      const message = {
        address: 'AX-AXISBK',
        date: 1793400000000,
        body,
      };

      const result = parseSms(message, context);
      const exp = expectedResults[fileName];

      expect(result.status).toBe(exp.status);
      if (exp.reason) {
        expect(result.reason).toBe(exp.reason);
      }

      if (exp.status === 'parsed') {
        expect(result.txn).toBeDefined();
        const txn = result.txn;
        expect(txn.kind).toBe(exp.kind);
        expect(txn.direction).toBe(exp.direction);
        expect(txn.amountPaise).toBe(exp.amountPaise);
        expect(txn.accountId).toBe(exp.accountId);
        expect(txn.accountHint).toEqual(exp.accountHint);
        expect(txn.date).toBe(exp.date);
        expect(txn.time).toBe(exp.time);
        expect(txn.merchantRaw).toBe(exp.merchantRaw);
        expect(txn.refNo).toBe(exp.refNo);
        expect(txn.dedupeKey).toBe(exp.dedupeKey);
        expect(txn.linkHint).toEqual(exp.linkHint);
      }
    });
  });

  describe('parseAmountToPaise', () => {
    it('handles all valid amount formats to integer paise', () => {
      expect(parseAmountToPaise('INR 5000.00')).toBe(500000);
      expect(parseAmountToPaise('Rs.14028')).toBe(1402800);
      expect(parseAmountToPaise('1,00,000.00')).toBe(10000000);
      expect(parseAmountToPaise('41,614.08')).toBe(4161408);
      expect(parseAmountToPaise('210')).toBe(21000);
      expect(parseAmountToPaise('312.0')).toBe(31200);
      expect(parseAmountToPaise('Rs 2.00')).toBe(200);
      expect(parseAmountToPaise('210.')).toBe(21000);
      expect(parseAmountToPaise('500.00.')).toBe(50000);
    });

    it('rejects invalid, zero, or ambiguous amounts with null', () => {
      expect(parseAmountToPaise('0')).toBeNull();
      expect(parseAmountToPaise('0.00')).toBeNull();
      expect(parseAmountToPaise('abc')).toBeNull();
      expect(parseAmountToPaise('')).toBeNull();
      expect(parseAmountToPaise('   ')).toBeNull();
      expect(parseAmountToPaise('1.234')).toBeNull(); // More than 2 decimals
      expect(parseAmountToPaise('-100')).toBeNull();
      expect(parseAmountToPaise(null)).toBeNull();
      expect(parseAmountToPaise(undefined)).toBeNull();
    });
  });

  describe('Calendar & Time Validation', () => {
    it('validates leap years and non-leap years accurately', () => {
      expect(parseDateToken('29-02-28')).toBe('2028-02-29'); // Leap year 2028
      expect(parseDateToken('29-02-26')).toBeNull(); // Non-leap year 2026
      expect(parseDateToken('31-02-26')).toBeNull(); // Invalid calendar day
      expect(parseDateToken('31-04-26')).toBeNull(); // April has 30 days
      expect(parseDateToken('30-04-26')).toBe('2026-04-30');
    });

    it('handles month names in lower and upper case', () => {
      expect(parseDateToken('03-oct-26')).toBe('2026-10-03');
      expect(parseDateToken('03-OCT-26')).toBe('2026-10-03');
      expect(parseDateToken('15-Jan-2025')).toBe('2025-01-15');
      expect(parseDateToken('22/07/25')).toBe('2025-07-22');
      expect(parseDateToken('invalid-date')).toBeNull();
    });

    it('validates time tokens', () => {
      expect(parseTimeToken('21:01:49')).toBe('21:01:49');
      expect(parseTimeToken('21:01:49 IST')).toBe('21:01:49');
      expect(parseTimeToken('08:54')).toBe('08:54:00');
      expect(parseTimeToken('25:00:00')).toBeNull();
      expect(parseTimeToken('12:60:00')).toBeNull();
      expect(parseTimeToken('invalid')).toBeNull();
    });

    it('constructs txnTs with +05:30 offset', () => {
      expect(toTxnTs('2026-10-03', '21:01:49')).toBe('2026-10-03T21:01:49+05:30');
      expect(toTxnTs(null, '21:01:49')).toBeNull();
      expect(toTxnTs('2026-10-03', null)).toBeNull();
    });
  });

  describe('Whitespace and Layout Variations', () => {
    it('parses CRLF line endings and extra spaces identically', () => {
      const crlfBody =
        'Spent INR 443.34\r\nAxis Bank Card no. XX4230\r\n03-10-26 21:01:49 IST\r\nDISTRICT MO\r\nAvl Limit: INR 232152.95\r\nNot you? SMS BLOCK 4230';
      const res = parseSms({ address: 'AXIS', date: 1000, body: crlfBody }, context);
      expect(res.status).toBe('parsed');
      expect(res.txn.amountPaise).toBe(44334);
      expect(res.txn.merchantRaw).toBe('DISTRICT MO');
    });

    it('parses multi-line layout flattened onto a single line', () => {
      const flatBody =
        'Spent INR 443.34 Axis Bank Card no. XX4230 03-10-26 21:01:49 IST DISTRICT MO Avl Limit: INR 232152.95 Not you? SMS BLOCK 4230';
      const res = parseSms({ address: 'AXIS', date: 1000, body: flatBody }, context);
      expect(res.status).toBe('parsed');
      expect(res.txn.amountPaise).toBe(44334);
      expect(res.txn.merchantRaw).toBe('DISTRICT MO');
      expect(res.txn.availLimitPaise).toBe(23215295);
    });

    it('returns unparsed when date is invalid in an otherwise valid message', () => {
      const invalidDateBody =
        'Spent INR 443.34 Axis Bank Card no. XX4230 31-02-26 21:01:49 IST DISTRICT MO Avl Limit: INR 232152.95';
      const res = parseSms({ address: 'AXIS', date: 1000, body: invalidDateBody }, context);
      expect(res.status).toBe('unparsed');
      expect(res.reason).toBe('format_mismatch');
    });
  });

  describe('OTP and Ignore Guarding', () => {
    it('marks OTP messages as ignored and never parses them as spend', () => {
      const otpMsg = {
        address: 'AXISBK',
        date: 1000,
        body: '500012 is SECRET OTP for txn of INR 210.00 on Axis Bank card XX3765 at SWIGGY PVT on 29-10-26 12:08:59. OTP valid for 5 mins.',
      };
      const res = parseSms(otpMsg, context);
      expect(res.status).toBe('ignored');
      expect(res.reason).toBe('otp');
      expect(res.txn).toBeUndefined();
    });
  });

  describe('Account Matching and Unknown Digits', () => {
    it('matches 3-digit vs 4-digit suffixes properly', () => {
      // acc_axis_savings has 7693
      expect(matchAccount('Axis', '7693', SEED_ACCOUNTS)).toBe('acc_axis_savings');
      expect(matchAccount('axis', '693', SEED_ACCOUNTS)).toBe('acc_axis_savings');

      // acc_icici_savings has 476
      expect(matchAccount('ICICI', '476', SEED_ACCOUNTS)).toBe('acc_icici_savings');
      expect(matchAccount('ICICI', '0476', SEED_ACCOUNTS)).toBe('acc_icici_savings');
    });

    it('does not clash between different issuers with same digits', () => {
      const customAccounts = [
        { id: 'acc_axis_111', issuer: 'Axis', lastDigits: '111' },
        { id: 'acc_hdfc_111', issuer: 'HDFC', lastDigits: '111' },
      ];
      expect(matchAccount('Axis', '111', customAccounts)).toBe('acc_axis_111');
      expect(matchAccount('HDFC', '111', customAccounts)).toBe('acc_hdfc_111');
      expect(matchAccount('ICICI', '111', customAccounts)).toBeNull();
    });

    it('returns null if ambiguous match found within same issuer', () => {
      const ambiguousAccounts = [
        { id: 'acc1', issuer: 'Axis', lastDigits: '1234' },
        { id: 'acc2', issuer: 'Axis', lastDigits: '0234' },
      ];
      expect(matchAccount('Axis', '234', ambiguousAccounts)).toBeNull();
    });

    it('handles unknown digits with status parsed and unk- dedupeKey', () => {
      const unknownDigitsMsg = {
        address: 'AXISBK',
        date: 1000,
        body: 'Payment of INR 500.00 has been received towards your Axis Bank Credit Card XX9999 on 30-10-26 - Axis Bank',
      };
      const res = parseSms(unknownDigitsMsg, context);
      expect(res.status).toBe('parsed');
      expect(res.txn.accountId).toBeNull();
      expect(res.txn.accountHint).toEqual({ issuer: 'axis', digits: '9999' });
      expect(res.txn.dedupeKey).toBe('fp:unk-axis-9999|50000|20261030|payrecv');
    });
  });

  describe('Determinism, RawHash and Fuzzing', () => {
    it('produces identical rawHash and result when run twice', () => {
      const msg = {
        address: 'AXISBK',
        date: 1720000000000,
        body: 'Payment of INR 1684.68 has been received towards your Axis Bank Credit Card XX7068 on 30-10-26 - Axis Bank',
      };
      const run1 = parseSms(msg, context);
      const run2 = parseSms(msg, context);

      expect(run1.rawHash).toBe(run2.rawHash);
      expect(run1).toEqual(run2);
      expect(run1.rawHash).toHaveLength(64);
    });

    it('returns unparsed with no_parser when an unregistered bank message arrives', () => {
      const fooMsg = {
        address: 'FOOBK',
        date: 1000,
        body: 'Rs 99.00 debited from FOOBANK A/c XX1234 on 01-11-26',
      };
      const res = parseSms(fooMsg, context);
      expect(res.status).toBe('unparsed');
      expect(res.reason).toBe('no_parser');
    });

    it('catches parser exceptions and yields unparsed format_mismatch', () => {
      const throwingParser = {
        issuer: 'buggy',
        detect: (flat) => flat.includes('BUGGY'),
        parse: () => {
          throw new Error('Explosion');
        },
      };
      registerParser(throwingParser);

      const msg = {
        address: 'BUGGY',
        date: 1000,
        body: 'BUGGY bank debited Rs 100 on 01-01-26',
      };
      const res = parseSms(msg, context);
      expect(res.status).toBe('unparsed');
      expect(res.reason).toBe('format_mismatch');
    });

    it('never throws on any input, including empty, giant, and 200 random strings', () => {
      expect(() => parseSms(null, context)).not.toThrow();
      expect(() => parseSms({}, context)).not.toThrow();
      expect(() => parseSms({ body: '' }, context)).not.toThrow();

      const giantText = 'Spent INR 100 on ' + 'A'.repeat(10000);
      expect(() => parseSms({ address: 'TEST', date: 1, body: giantText }, context)).not.toThrow();

      // Fuzz with 200 random strings
      for (let i = 0; i < 200; i++) {
        const randLen = Math.floor(Math.random() * 200);
        const chars = [];
        for (let j = 0; j < randLen; j++) {
          chars.push(String.fromCharCode(Math.floor(Math.random() * 128)));
        }
        const randStr = chars.join('');
        const res = parseSms({ address: 'FUZZ', date: Date.now(), body: randStr }, context);
        expect(['parsed', 'ignored', 'unparsed', 'unknown']).toContain(res.status);
      }
    });
  });

  describe('PHASE P7b - ICICI Parser Specifics', () => {
    it('classifies mandate debit as transfer when payee matches ownerNames', () => {
      const msg = {
        address: 'ICICIB',
        date: 1000,
        body: 'Rs 500.00 debited from ICICI Bank Savings Account XX476 on 27-Oct-26 towards TEST OWNER for UPI Mandate AutoPay Retrieval Ref No.666000000002',
      };
      const res = parseSms(msg, { accounts: SEED_ACCOUNTS, ownerNames: ['test owner'] });
      expect(res.status).toBe('parsed');
      expect(res.txn.kind).toBe('transfer');
      expect(res.txn.dedupeKey).toBe('ref:666000000002');
    });

    it('classifies mandate debit as fixed when payee does not match ownerNames or ownerNames is empty', () => {
      const msg = {
        address: 'ICICIB',
        date: 1000,
        body: 'Rs 500.00 debited from ICICI Bank Savings Account XX476 on 27-Oct-26 towards TEST OWNER for UPI Mandate AutoPay Retrieval Ref No.666000000002',
      };
      const resDifferent = parseSms(msg, { accounts: SEED_ACCOUNTS, ownerNames: ['Someone Else'] });
      expect(resDifferent.status).toBe('parsed');
      expect(resDifferent.txn.kind).toBe('fixed');

      const resEmpty = parseSms(msg, { accounts: SEED_ACCOUNTS, ownerNames: [] });
      expect(resEmpty.status).toBe('parsed');
      expect(resEmpty.txn.kind).toBe('fixed');

      const resNone = parseSms(msg, { accounts: SEED_ACCOUNTS });
      expect(resNone.status).toBe('parsed');
      expect(resNone.txn.kind).toBe('fixed');
    });

    it('ignores standing instruction notifications', () => {
      const siMsg = {
        address: 'ICICIB',
        date: 1000,
        body: fs.readFileSync(path.join(FIXTURES_DIR, 'ign_icici_si.txt'), 'utf-8'),
      };
      const res = parseSms(siMsg, context);
      expect(res.status).toBe('ignored');
      expect(res.reason).toBe('due_or_standing_instruction');
    });

    it('parses card refund without being ignored by minimum due', () => {
      const refundMsg = {
        address: 'ICICIB',
        date: 1000,
        body: fs.readFileSync(path.join(FIXTURES_DIR, 'icici_refund_pb.txt'), 'utf-8'),
      };
      const res = parseSms(refundMsg, context);
      expect(res.status).toBe('parsed');
      expect(res.txn.kind).toBe('spend');
      expect(res.txn.direction).toBe('credit');
      expect(res.txn.amountPaise).toBe(200);
      expect(res.txn.accountId).toBe('acc_icici_coral');
      expect(res.txn.accountHint).toEqual({ issuer: 'icici', digits: '3001' });
      expect(res.txn.dedupeKey).toContain('|credit|policybazaar');
    });

    it('matches 3-digit vs 4-digit savings accounts and isolates card accounts', () => {
      const upi3 = {
        address: 'ICICIB',
        date: 1000,
        body: 'ICICI Bank Acct XX476 debited for Rs 100.00 on 30-Oct-26; STORE credited. UPI:123456789012',
      };
      const res3 = parseSms(upi3, context);
      expect(res3.status).toBe('parsed');
      expect(res3.txn.accountId).toBe('acc_icici_savings');

      const upi4 = {
        address: 'ICICIB',
        date: 1000,
        body: 'ICICI Bank Acct XX4476 debited for Rs 100.00 on 30-Oct-26; STORE credited. UPI:123456789012',
      };
      const res4 = parseSms(upi4, context);
      expect(res4.status).toBe('parsed');
      expect(res4.txn.accountId).toBe('acc_icici_savings');

      // Card XX6017 does not match savings
      const cardMsg = {
        address: 'ICICIB',
        date: 1000,
        body: 'INR 100.00 spent using ICICI Bank Card XX6017 on 28-Oct-26 on MERCHANT. Avl Limit: INR 1000.00.',
      };
      const resCard = parseSms(cardMsg, context);
      expect(resCard.status).toBe('parsed');
      expect(resCard.txn.accountId).toBe('acc_icici_amazonpay');
      expect(resCard.txn.accountId).not.toBe('acc_icici_savings');

      // Unknown card XX7922
      const unknownMsg = {
        address: 'ICICIB',
        date: 1000,
        body: 'Dear Customer, thank you for your payment of INR 5000.00 towards ICICI Bank Credit Card Account XX7922 through Auto Debit from Account XX4476 on 03-Oct-26',
      };
      const resUnk = parseSms(unknownMsg, context);
      expect(resUnk.status).toBe('parsed');
      expect(resUnk.txn.accountId).toBeNull();
      expect(resUnk.txn.dedupeKey).toBe('fp:unk-icici-7922|500000|20261003|payrecv');
    });

    it('handles whitespace variations including CRLF, tabs, and double spaces', () => {
      const crlfTab =
        'INR\t454.00  spent\r\nusing   ICICI Bank Card   XX6017\r\non 28-Oct-26\ton  AMAZON PAY IN E.\r\nAvl Limit: INR 41,614.08.';
      const res = parseSms({ address: 'ICICIB', date: 1000, body: crlfTab }, context);
      expect(res.status).toBe('parsed');
      expect(res.txn.amountPaise).toBe(45400);
      expect(res.txn.merchantRaw).toBe('AMAZON PAY IN E');
      expect(res.txn.availLimitPaise).toBe(4161408);
    });

    it('handles amount variants in ICICI messages', () => {
      const amounts = [
        { text: 'Rs 1,829.07', paise: 182907 },
        { text: 'Rs. 829.07', paise: 82907 },
        { text: 'INR 5,000.00', paise: 500000 },
        { text: 'Rs 99', paise: 9900 },
      ];

      for (const { text, paise } of amounts) {
        const body = `ICICI Bank Acct XX476 debited for ${text} on 30-Oct-26; Test Merchant credited. UPI:999888777666`;
        const res = parseSms({ address: 'ICICIB', date: 1000, body }, context);
        expect(res.status).toBe('parsed');
        expect(res.txn.amountPaise).toBe(paise);
      }
    });

    it('validates calendar dates strictly and accepts case-insensitive month names', () => {
      const invalidDate =
        'INR 454.00 spent using ICICI Bank Card XX6017 on 31-Feb-26 on STORE. Avl Limit: INR 1000.00.';
      const resInvalid = parseSms({ address: 'ICICIB', date: 1000, body: invalidDate }, context);
      expect(resInvalid.status).toBe('unparsed');
      expect(resInvalid.reason).toBe('format_mismatch');

      for (const mToken of ['28-OCT-26', '28-oct-26', '28-Oct-26']) {
        const validMsg = `INR 454.00 spent using ICICI Bank Card XX6017 on ${mToken} on STORE. Avl Limit: INR 1000.00.`;
        const resValid = parseSms({ address: 'ICICIB', date: 1000, body: validMsg }, context);
        expect(resValid.status).toBe('parsed');
        expect(resValid.txn.date).toBe('2026-10-28');
      }
    });

    it('enforces cross-issuer isolation between Axis and ICICI', () => {
      const axisFiles = [
        'axis_spend_multi.txt',
        'axis_spend_single_1.txt',
        'axis_debit_cardpay_1.txt',
        'axis_credit_neft_1.txt',
        'axis_payrecv_1.txt',
      ];
      for (const f of axisFiles) {
        const text = fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf-8');
        const prep = prepareBody(text);
        expect(axisParser.detect(prep.flat)).toBe(true);
        expect(iciciParser.detect(prep.flat)).toBe(false);
      }

      const iciciFiles = [
        'icici_spend_1.txt',
        'icici_spend_2.txt',
        'icici_upi_wallet.txt',
        'icici_upi_person.txt',
        'icici_mandate_self.txt',
        'icici_refund_pb.txt',
        'icici_payrecv.txt',
      ];
      for (const f of iciciFiles) {
        const text = fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf-8');
        const prep = prepareBody(text);
        expect(iciciParser.detect(prep.flat)).toBe(true);
        expect(axisParser.detect(prep.flat)).toBe(false);
      }
    });
  });

  describe('PHASE P7c - HDFC Parser Specifics', () => {
    it('produces identical result for hdfc_flattened.txt and hdfc_upi_1.txt', () => {
      const upi1Text = fs.readFileSync(path.join(FIXTURES_DIR, 'hdfc_upi_1.txt'), 'utf-8');
      const flatText = fs.readFileSync(path.join(FIXTURES_DIR, 'hdfc_flattened.txt'), 'utf-8');

      const res1 = parseSms({ address: 'HDFCBK', date: 1000, body: upi1Text }, context);
      const resFlat = parseSms({ address: 'HDFCBK', date: 1000, body: flatText }, context);

      expect(res1.status).toBe('parsed');
      expect(resFlat.status).toBe('parsed');
      expect(resFlat.txn).toEqual(res1.txn);
    });

    it('never uses BLOCKPCC 8538 as card digits and matches only by product name', () => {
      const msg = {
        address: 'HDFCBK',
        date: 1000,
        body: 'A transaction of Rs. 360.00 was made using your HDFC Bank Pixel Play Credit Card at blinkit.payu@hdfcbank via UPI 131000000001 on 27/10/26 at 23:38. Not you? Block your Card: https://1.hdfc.bank.in/HDFCBK/s/xxxx or SMS BLOCKPCC 8538 to 8433XXXXXX',
      };

      // Custom account with digits 8538 but different product name
      const customAccounts = [
        { id: 'acc_other_8538', name: 'HDFC Regalia 8538', issuer: 'HDFC', lastDigits: '8538' },
        { id: 'acc_hdfc_pixel', name: 'HDFC Pixel Play 3726', issuer: 'HDFC', lastDigits: '3726' },
      ];

      const res = parseSms(msg, { accounts: customAccounts });
      expect(res.status).toBe('parsed');
      // Matches Pixel Play, NEVER matches 8538
      expect(res.txn.accountId).toBe('acc_hdfc_pixel');
      expect(res.txn.accountHint.digits).toBeNull();
      expect(res.txn.accountHint.product).toBe('Pixel Play');
    });

    it('returns unparsed for invalid date 31/02/26 or invalid time 25:99', () => {
      const invalidDateMsg = {
        address: 'HDFCBK',
        date: 1000,
        body: 'A transaction of Rs. 360.00 was made using your HDFC Bank Pixel Play Credit Card at blinkit.payu@hdfcbank via UPI 131000000001 on 31/02/26 at 23:38. Not you?',
      };
      const resDate = parseSms(invalidDateMsg, context);
      expect(resDate.status).toBe('unparsed');
      expect(resDate.reason).toBe('format_mismatch');

      const invalidTimeMsg = {
        address: 'HDFCBK',
        date: 1000,
        body: 'A transaction of Rs. 360.00 was made using your HDFC Bank Pixel Play Credit Card at blinkit.payu@hdfcbank via UPI 131000000001 on 27/10/26 at 25:99. Not you?',
      };
      const resTime = parseSms(invalidTimeMsg, context);
      expect(resTime.status).toBe('unparsed');
      expect(resTime.reason).toBe('format_mismatch');
    });

    it('parses amount variants correctly (Rs. 1,894.50, Rs 894, Rs.894.00)', () => {
      const amounts = [
        { text: 'Rs. 1,894.50', paise: 189450 },
        { text: 'Rs 894', paise: 89400 },
        { text: 'Rs.894.00', paise: 89400 },
      ];

      for (const { text, paise } of amounts) {
        const body = `A transaction of ${text} was made using your HDFC Bank Pixel Play Credit Card at store@upi via UPI 131000000001 on 27/10/26 at 23:38.`;
        const res = parseSms({ address: 'HDFCBK', date: 1000, body }, context);
        expect(res.status).toBe('parsed');
        expect(res.txn.amountPaise).toBe(paise);
      }
    });

    it('handles ambiguous accounts (two HDFC accounts with same product text) safely without crashing', () => {
      const ambiguousAccounts = [
        { id: 'acc_pixel_1', name: 'HDFC Pixel Play Primary', issuer: 'HDFC' },
        { id: 'acc_pixel_2', name: 'HDFC Pixel Play Secondary', issuer: 'HDFC' },
      ];

      const msg = {
        address: 'HDFCBK',
        date: 1000,
        body: 'A transaction of Rs. 360.00 was made using your HDFC Bank Pixel Play Credit Card at blinkit.payu@hdfcbank via UPI 131000000001 on 27/10/26 at 23:38.',
      };

      const res = parseSms(msg, { accounts: ambiguousAccounts });
      expect(res.status).toBe('parsed');
      expect(res.txn.accountId).toBeNull();
      expect(res.txn.accountHint).toEqual({
        issuer: 'hdfc',
        digits: null,
        product: 'Pixel Play',
      });
      expect(res.txn.dedupeKey).toBe('ref:131000000001');
    });

    it('enforces whole-registry regression and cross-issuer isolation for HDFC, Axis, and ICICI', () => {
      const hdfcFiles = [
        'hdfc_upi_1.txt',
        'hdfc_upi_2.txt',
        'hdfc_upi_3.txt',
        'hdfc_unknown_product.txt',
        'hdfc_unknown_layout.txt',
        'hdfc_flattened.txt',
      ];
      for (const f of hdfcFiles) {
        const text = fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf-8');
        const prep = prepareBody(text);
        expect(hdfcParser.detect(prep.flat)).toBe(true);
        expect(axisParser.detect(prep.flat)).toBe(false);
        expect(iciciParser.detect(prep.flat)).toBe(false);
      }

      const axisFiles = [
        'axis_spend_multi.txt',
        'axis_spend_single_1.txt',
        'axis_spend_single_2.txt',
        'axis_spend_single_3.txt',
        'axis_debit_cardpay_1.txt',
        'axis_debit_cardpay_2.txt',
        'axis_debit_ach.txt',
        'axis_debit_unknown_narration.txt',
        'axis_credit_neft_1.txt',
        'axis_credit_neft_2.txt',
        'axis_payrecv_1.txt',
        'axis_payrecv_2.txt',
      ];
      for (const f of axisFiles) {
        const text = fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf-8');
        const prep = prepareBody(text);
        expect(axisParser.detect(prep.flat)).toBe(true);
        expect(hdfcParser.detect(prep.flat)).toBe(false);
      }

      const iciciFiles = [
        'icici_spend_1.txt',
        'icici_spend_2.txt',
        'icici_upi_wallet.txt',
        'icici_upi_person.txt',
        'icici_mandate_self.txt',
        'icici_refund_pb.txt',
        'icici_payrecv.txt',
        'ign_icici_si.txt',
        'icici_unknown_layout.txt',
      ];
      for (const f of iciciFiles) {
        const text = fs.readFileSync(path.join(FIXTURES_DIR, f), 'utf-8');
        const prep = prepareBody(text);
        expect(iciciParser.detect(prep.flat)).toBe(true);
        expect(hdfcParser.detect(prep.flat)).toBe(false);
      }
    });
  });

  describe('Architectural Boundaries', () => {
    it('ensures src/core/ingest contains no imports of React or Capacitor', () => {
      const files = [
        'normalize.js',
        'ignoreRules.js',
        'accounts.js',
        'keys.js',
        'registry.js',
        'mask.js',
        'index.js',
        'issuers/axis.js',
        'issuers/icici.js',
        'issuers/hdfc.js',
      ];

      for (const rel of files) {
        const fullPath = path.resolve(__dirname, rel);
        const content = fs.readFileSync(fullPath, 'utf-8');
        expect(content).not.toMatch(/from\s+['"]react['"]/);
        expect(content).not.toMatch(/from\s+['"]react-dom/);
        expect(content).not.toMatch(/from\s+['"]@capacitor/);
      }
    });
  });
});
