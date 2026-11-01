import { describe, it, expect } from 'vitest';
import { maskForSharing } from './mask.js';

describe('maskForSharing', () => {
  describe('Digit masking rules', () => {
    it('preserves runs of 4 or fewer digits (card endings, amounts, dates)', () => {
      expect(maskForSharing('card ending in 4230')).toBe('card ending in 4230');
      expect(maskForSharing('Rs 360 on 27/10/26 at 23:38')).toBe('Rs 360 on 27/10/26 at 23:38');
      expect(maskForSharing('1 digit: 5, 2 digits: 42, 3 digits: 894, 4 digits: 7068')).toBe(
        '1 digit: 5, 2 digits: 42, 3 digits: 894, 4 digits: 7068'
      );
    });

    it('masks runs of 5 or more digits keeping only the last two digits', () => {
      expect(maskForSharing('OTP 12345')).toBe('OTP XXX45');
      expect(maskForSharing('OTP 500012')).toBe('OTP XXXX12');
      expect(maskForSharing('Ref 131000000001')).toBe('Ref XXXXXXXXXX01');
      expect(maskForSharing('Account 1234567890123456')).toBe('Account XXXXXXXXXXXXXX56');
    });
  });

  describe('URL replacement', () => {
    it('replaces http, https, and bare domains with paths by <url>', () => {
      expect(
        maskForSharing('Block your Card: https://1.hdfc.bank.in/HDFCBK/s/xxxx or call')
      ).toBe('Block your Card: <url> or call');

      expect(maskForSharing('Visit http://example.com/login for details.')).toBe(
        'Visit <url> for details.'
      );

      expect(maskForSharing('Click bit.ly/3xyz for promo')).toBe('Click <url> for promo');
    });

    it('preserves sentence punctuation immediately following a URL', () => {
      expect(maskForSharing('Check https://example.com/alert.')).toBe('Check <url>.');
      expect(maskForSharing('Link: https://example.com/test; thanks')).toBe('Link: <url>; thanks');
    });
  });

  describe('Phone-like runs replacement', () => {
    it('replaces Indian 10-digit mobile numbers with <phone>', () => {
      expect(maskForSharing('Call 9876543210 for support')).toBe('Call <phone> for support');
      expect(maskForSharing('Call 8433123456 for info')).toBe('Call <phone> for info');
    });

    it('replaces phone numbers with +91 and various spacing/hyphens', () => {
      expect(maskForSharing('Helpline: +919876543210')).toBe('Helpline: <phone>');
      expect(maskForSharing('Helpline: +91 9876543210')).toBe('Helpline: <phone>');
      expect(maskForSharing('Helpline: +91-9876543210')).toBe('Helpline: <phone>');
    });

    it('replaces toll-free numbers (1800/1860)', () => {
      expect(maskForSharing('Call 1800123456 for assistance')).toBe('Call <phone> for assistance');
      expect(maskForSharing('Call 1800 202 6161')).toBe('Call <phone>');
      expect(maskForSharing('Call 1800-202-6161')).toBe('Call <phone>');
    });

    it('replaces partially masked phone numbers from fixtures', () => {
      expect(maskForSharing('SMS BLOCKPCC 8538 to 8433XXXXXX')).toBe('SMS BLOCKPCC 8538 to <phone>');
      expect(maskForSharing('Not you? Call 1800XXXXXX.')).toBe('Not you? Call <phone>.');
    });
  });

  describe('Whitespace and line breaks preservation', () => {
    it('collapses horizontal spaces and tabs on a line but preserves line breaks', () => {
      const input = 'Line 1   with    multiple   spaces\r\n\r\nLine 2\t\twith\ttabs\r\nLine 3';
      const expected = 'Line 1 with multiple spaces\n\nLine 2 with tabs\nLine 3';
      expect(maskForSharing(input)).toBe(expected);
    });
  });

  describe('Idempotence', () => {
    it('produces identical output when masked once vs masked twice', () => {
      const samples = [
        'A transaction of Rs. 360.00 was made using your HDFC Bank Pixel Play Credit Card at blinkit.payu@hdfcbank via UPI 131000000001 on 27/10/26 at 23:38. Not you? Block your Card: https://1.hdfc.bank.in/HDFCBK/s/xxxx or SMS BLOCKPCC 8538 to 8433XXXXXX',
        'Rs.250.00 debited from HDFC Bank A/c **1234 on 01-11-26 to VPA test@upi (UPI Ref No. 131000000005). Not you? Call 1800XXXXXX.',
        'Spent INR 443.34 Axis Bank Card no. XX4230 on 03-10-26 21:01:49 IST at SWIGGY. Avl Limit: INR 232152.95',
        'Helpline +91 9876543210 or visit https://mybank.com/contact for questions.',
        'Short text 1234',
        '',
      ];

      for (const text of samples) {
        const pass1 = maskForSharing(text);
        const pass2 = maskForSharing(pass1);
        expect(pass2).toBe(pass1);
      }
    });
  });

  describe('Robustness and Fuzzing', () => {
    it('handles non-string, null, and undefined inputs safely without throwing', () => {
      expect(maskForSharing(null)).toBe('');
      expect(maskForSharing(undefined)).toBe('');
      expect(maskForSharing(12345)).toBe('');
      expect(maskForSharing({})).toBe('');
      expect(maskForSharing('')).toBe('');
    });

    it('never throws on 200 random strings of varying length', () => {
      for (let i = 0; i < 200; i++) {
        const len = Math.floor(Math.random() * 200);
        let str = '';
        for (let j = 0; j < len; j++) {
          str += String.fromCharCode(Math.floor(Math.random() * 128));
        }
        expect(() => {
          const res = maskForSharing(str);
          expect(typeof res).toBe('string');
        }).not.toThrow();
      }
    });
  });
});

