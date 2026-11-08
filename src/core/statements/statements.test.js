import { describe, it, expect } from 'vitest';
import {
  reconstructLines,
  maskStatementText,
  summarizeStructure,
  pickProbeSample,
  formatProbeReport,
} from './index.js';

describe('src/core/statements - Pure Statement Text Logic', () => {
  describe('reconstructLines', () => {
    it('groups items with jittered y values within tolerance into the same line', () => {
      const items = [
        { str: 'Date', x: 10, y: 500, width: 30, height: 10, page: 1 },
        { str: 'Description', x: 60, y: 502, width: 80, height: 10, page: 1 }, // y jittered by +2
        { str: 'Amount', x: 160, y: 499, width: 40, height: 10, page: 1 }, // y jittered by -1
        { str: 'Next Line', x: 10, y: 470, width: 60, height: 10, page: 1 }, // different line
      ];

      const lines = reconstructLines(items);
      expect(lines).toHaveLength(2);
      expect(lines[0].text).toContain('Date');
      expect(lines[0].text).toContain('Description');
      expect(lines[0].text).toContain('Amount');
      expect(lines[1].text).toBe('Next Line');
    });

    it('inserts tab markers (" ⇥ ") for wide column gaps', () => {
      // char width = 10 / 4 = 2.5, wide threshold ~ 3.75
      const items = [
        { str: 'Col1', x: 10, y: 500, width: 20, height: 10, page: 1 }, // right = 30
        { str: 'Col2', x: 100, y: 500, width: 20, height: 10, page: 1 }, // gap = 70 (wide!)
      ];

      const lines = reconstructLines(items);
      expect(lines).toHaveLength(1);
      expect(lines[0].text).toBe('Col1 ⇥ Col2');
    });

    it('orders lines by page then top to bottom (larger y higher up)', () => {
      const items = [
        { str: 'Page 2 Top', x: 10, y: 600, width: 50, height: 10, page: 2 },
        { str: 'Page 1 Bottom', x: 10, y: 100, width: 50, height: 10, page: 1 },
        { str: 'Page 1 Top', x: 10, y: 700, width: 50, height: 10, page: 1 },
      ];

      const lines = reconstructLines(items);
      expect(lines).toHaveLength(3);
      expect(lines[0]).toEqual({ page: 1, lineNo: 1, text: 'Page 1 Top' });
      expect(lines[1]).toEqual({ page: 1, lineNo: 2, text: 'Page 1 Bottom' });
      expect(lines[2]).toEqual({ page: 2, lineNo: 1, text: 'Page 2 Top' });
    });

    it('drops empty or whitespace-only lines', () => {
      const items = [
        { str: '   ', x: 10, y: 500, width: 20, height: 10, page: 1 },
        { str: 'Valid Text', x: 10, y: 400, width: 40, height: 10, page: 1 },
      ];

      const lines = reconstructLines(items);
      expect(lines).toHaveLength(1);
      expect(lines[0].text).toBe('Valid Text');
    });
  });

  describe('maskStatementText', () => {
    it('masks owner name in "KSHITIJ BAJPAI", "Bajpai Kshitij" and mixed case', () => {
      const lines = [
        { page: 1, lineNo: 1, text: 'Cardholder: KSHITIJ BAJPAI' },
        { page: 1, lineNo: 2, text: 'Statement for Bajpai Kshitij' },
        { page: 1, lineNo: 3, text: 'Welcome kshitij   bajpai to rewards' },
      ];

      const masked = maskStatementText(lines, { ownerNames: ['Kshitij Bajpai'] });
      expect(masked[0].text).toBe('Cardholder: <NAME>');
      expect(masked[1].text).toBe('Statement for <NAME>');
      expect(masked[2].text).toBe('Welcome <NAME> to rewards');
    });

    it('masks emails, urls, phone numbers, PAN, and PIN codes', () => {
      const lines = [
        { page: 1, lineNo: 1, text: 'Contact us at help@bank.com or visit https://www.bank.com' },
        { page: 1, lineNo: 2, text: 'Registered phone: +91 9876543210 and PIN 110001' },
        { page: 1, lineNo: 3, text: 'Customer PAN: ABCDE1234F' },
      ];

      const masked = maskStatementText(lines);
      expect(masked[0].text).toBe('Contact us at <email> or visit <url>');
      expect(masked[1].text).toBe('Registered phone: <phone> and PIN <pin>');
      expect(masked[2].text).toBe('Customer PAN: <pan>');
    });

    it('masks amount digits with 9 keeping separators in "layout" level, but leaves dates untouched', () => {
      const lines = [
        { page: 1, lineNo: 1, text: '12/10/2026 ⇥ SWIGGY ⇥ 1,00,000.00' },
        { page: 1, lineNo: 2, text: '15-Oct-26 ⇥ PAYMENT ⇥ 12,345.00 Dr' },
        { page: 1, lineNo: 3, text: 'Opening balance: 500.00 Cr on 2026-10-01' },
      ];

      const masked = maskStatementText(lines, { level: 'layout' });
      expect(masked[0].text).toBe('12/10/2026 ⇥ SWIGGY ⇥ 9,99,999.99');
      expect(masked[1].text).toBe('15-Oct-26 ⇥ PAYMENT ⇥ 99,999.99 Dr');
      expect(masked[2].text).toBe('Opening balance: 999.99 Cr on 2026-10-01');
    });

    it('leaves amounts untouched in "amounts_kept" level', () => {
      const lines = [
        { page: 1, lineNo: 1, text: '12/10/2026 ⇥ SWIGGY ⇥ 1,234.56 Dr' },
      ];

      const masked = maskStatementText(lines, { level: 'amounts_kept' });
      expect(masked[0].text).toBe('12/10/2026 ⇥ SWIGGY ⇥ 1,234.56 Dr');
    });

    it('preserves last 4 digits for card-shaped tokens and last 2 digits for other 5+ digit runs', () => {
      const lines = [
        { page: 1, lineNo: 1, text: 'Card: 4000 12XX XXXX 3765' },
        { page: 1, lineNo: 2, text: 'Card: 4111 2222 3333 4444' },
        { page: 1, lineNo: 3, text: 'Ref Number: 1234567' },
      ];

      const masked = maskStatementText(lines);
      expect(masked[0].text).toBe('Card: XXXX XXXX XXXX 3765');
      expect(masked[1].text).toBe('Card: XXXX XXXX XXXX 4444');
      expect(masked[2].text).toBe('Ref Number: XXXXX67');
    });

    it('replaces address lines and postal address lines with <address line>', () => {
      const lines = [
        { page: 1, lineNo: 1, text: 'Billing address: Flat 101, Park Street, Kolkata' },
        { page: 1, lineNo: 2, text: '123 M.G. Road, Sector 4, Bangalore 560001' },
        { page: 1, lineNo: 3, text: 'SWIGGY RESTAURANT ⇥ 250.00' },
      ];

      const masked = maskStatementText(lines);
      expect(masked[0].text).toBe('<address line>');
      expect(masked[1].text).toBe('<address line>');
      expect(masked[2].text).not.toBe('<address line>');
    });

    it('is idempotent (masking twice gives the exact same output)', () => {
      const lines = [
        { page: 1, lineNo: 1, text: '12/10/2026 ⇥ SWIGGY ⇥ 1,234.50 Dr ⇥ Card: 4000 12XX XXXX 3765' },
        { page: 1, lineNo: 2, text: 'Kshitij Bajpai ⇥ contact@example.com ⇥ +91 9876543210' },
      ];

      const pass1 = maskStatementText(lines, { ownerNames: ['Kshitij Bajpai'] });
      const pass2 = maskStatementText(pass1, { ownerNames: ['Kshitij Bajpai'] });

      expect(pass2).toEqual(pass1);
    });

    it('fuzz test: never throws on 200 random / unusual strings', () => {
      const sampleChars = 'abcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:",.<>?/ \n\t⇥';
      const randomStrings = [];
      for (let i = 0; i < 200; i++) {
        let str = '';
        const len = Math.floor(Math.random() * 100);
        for (let j = 0; j < len; j++) {
          str += sampleChars.charAt(Math.floor(Math.random() * sampleChars.length));
        }
        randomStrings.push({ page: 1, lineNo: i + 1, text: str });
      }

      expect(() => {
        maskStatementText(randomStrings, { ownerNames: ['John Doe', 'Jane'] });
      }).not.toThrow();
    });
  });

  describe('summarizeStructure', () => {
    it('summarizes synthetic statements for each issuer keyword', () => {
      const issuers = ['axis', 'icici', 'hdfc', 'idfc'];
      for (const iss of issuers) {
        const lines = [
          { page: 1, lineNo: 1, text: `Welcome to ${iss.toUpperCase()} Bank Credit Card Statement` },
          { page: 1, lineNo: 2, text: 'Card No: XXXX XXXX XXXX 8899' },
          { page: 1, lineNo: 3, text: 'Date ⇥ Description ⇥ Amount' },
          { page: 1, lineNo: 4, text: '12/10/2026 ⇥ STORE ⇥ 500.00 Dr' },
        ];

        const summary = summarizeStructure(lines);
        expect(summary.issuerGuess).toBe(iss);
        expect(summary.cardEndings).toContain('8899');
        expect(summary.hasText).toBe(true);
        expect(summary.txnLikeLineCount).toBe(1);
        expect(summary.headerLines.length).toBeGreaterThanOrEqual(1);
        expect(summary.dateFormatsSeen.some((d) => d.format === 'dd/mm/yyyy')).toBe(true);
      }
    });

    it('correctly handles scanned-PDF case with no text', () => {
      const lines = [
        { page: 1, lineNo: 1, text: '   ' },
        { page: 1, lineNo: 2, text: '123' },
      ];

      const summary = summarizeStructure(lines);
      expect(summary.hasText).toBe(false);
      expect(summary.issuerGuess).toBe('unknown');
    });
  });

  describe('pickProbeSample & formatProbeReport', () => {
    it('picks probe sample respecting size limits and preserves page:line order', () => {
      const lines = [];
      // 30 lines on page 1
      for (let i = 1; i <= 30; i++) {
        lines.push({ page: 1, lineNo: i, text: `Page 1 Header line ${i}` });
      }
      // Table header
      lines.push({ page: 1, lineNo: 31, text: 'Date ⇥ Description ⇥ Amount ⇥ Debit' });
      // 50 txn-like lines spread across pages 1 and 2
      for (let i = 1; i <= 50; i++) {
        lines.push({
          page: i <= 20 ? 1 : 2,
          lineNo: i + 31,
          text: `12/10/2026 ⇥ Transaction ${i} ⇥ 100.00 Dr`,
        });
      }
      // Keyword line
      lines.push({ page: 2, lineNo: 90, text: 'Total payment received: 5000.00' });

      const summary = summarizeStructure(lines);
      const sample = pickProbeSample(lines, summary);

      expect(sample.length).toBeLessThan(lines.length);
      // Contains header of page 1
      expect(sample[0].lineNo).toBe(1);
      // Contains the keyword line
      expect(sample.some((l) => l.text.includes('Total payment'))).toBe(true);
      // Preserves monotonic index order
      for (let i = 1; i < sample.length; i++) {
        const prev = sample[i - 1];
        const curr = sample[i];
        if (curr.page === prev.page) {
          expect(curr.lineNo).toBeGreaterThan(prev.lineNo);
        } else {
          expect(curr.page).toBeGreaterThan(prev.page);
        }
      }
    });

    it('Rule 1: raises the first-page sample from 25 to 70 lines', () => {
      const lines = [];
      for (let i = 1; i <= 85; i++) {
        lines.push({
          page: 1,
          lineNo: i,
          text: `Arbitrary non-keyword plain line ${i}`,
        });
      }

      const sample = pickProbeSample(lines);
      expect(sample).toHaveLength(70);
      expect(sample[0].lineNo).toBe(1);
      expect(sample[69].lineNo).toBe(70);
      expect(sample.some((l) => l.lineNo === 71)).toBe(false);
    });

    it('Rule 2: always includes the 12 lines after any line containing "CREDIT SUMMARY", "Total Amount due" or "Previous Balance"', () => {
      const lines = [];
      // Page 2 lines beyond line 70
      for (let i = 1; i <= 100; i++) {
        let text = `Normal statement line ${i}`;
        if (i === 10) text = '--- CREDIT SUMMARY ---';
        if (i === 35) text = 'Total Amount due: 45,000.00';
        if (i === 60) text = 'Previous Balance: 12,000.00';
        lines.push({ page: 2, lineNo: i, text });
      }

      const sample = pickProbeSample(lines);
      const sampleTexts = new Set(sample.map((l) => l.text));

      // Check CREDIT SUMMARY and 12 lines after it (lines 11-22)
      expect(sampleTexts.has('--- CREDIT SUMMARY ---')).toBe(true);
      for (let i = 11; i <= 22; i++) {
        expect(sampleTexts.has(`Normal statement line ${i}`)).toBe(true);
      }

      // Check Total Amount due and 12 lines after it (lines 36-47)
      expect(sampleTexts.has('Total Amount due: 45,000.00')).toBe(true);
      for (let i = 36; i <= 47; i++) {
        expect(sampleTexts.has(`Normal statement line ${i}`)).toBe(true);
      }

      // Check Previous Balance and 12 lines after it (lines 61-72)
      expect(sampleTexts.has('Previous Balance: 12,000.00')).toBe(true);
      for (let i = 61; i <= 72; i++) {
        expect(sampleTexts.has(`Normal statement line ${i}`)).toBe(true);
      }

      // Check line 25 (not in 12 lines after) is not included
      expect(sampleTexts.has('Normal statement line 25')).toBe(false);
    });

    it('Rule 3: when issuer guess is icici, includes every line with Amortization, EMI, DCC, IGST, Autodebit and 6 lines after EMI / PERSONAL LOAN', () => {
      const lines = [];
      // Put on page 2 so not selected by first 70 lines rule
      for (let i = 1; i <= 80; i++) {
        let text = `Regular line ${i}`;
        if (i === 5) text = 'Amortization details for loan';
        if (i === 15) text = 'Monthly EMI converted';
        if (i === 25) text = 'DCC cross-currency markup';
        if (i === 35) text = 'IGST levied at 18%';
        if (i === 45) text = 'Autodebit scheduled on due date';
        if (i === 60) text = 'EMI / PERSONAL LOAN SCHEDULE';
        lines.push({ page: 2, lineNo: i, text });
      }

      // When issuerGuess is icici
      const iciciSummary = { issuerGuess: 'icici' };
      const iciciSample = pickProbeSample(lines, iciciSummary);
      const iciciTexts = new Set(iciciSample.map((l) => l.text));

      expect(iciciTexts.has('Amortization details for loan')).toBe(true);
      expect(iciciTexts.has('Monthly EMI converted')).toBe(true);
      expect(iciciTexts.has('DCC cross-currency markup')).toBe(true);
      expect(iciciTexts.has('IGST levied at 18%')).toBe(true);
      expect(iciciTexts.has('Autodebit scheduled on due date')).toBe(true);
      expect(iciciTexts.has('EMI / PERSONAL LOAN SCHEDULE')).toBe(true);

      // 6 lines after EMI / PERSONAL LOAN (lines 61 to 66)
      for (let i = 61; i <= 66; i++) {
        expect(iciciTexts.has(`Regular line ${i}`)).toBe(true);
      }
      // Line 67 is after the 6 lines and should not be selected
      expect(iciciTexts.has('Regular line 67')).toBe(false);

      // When issuerGuess is axis, ICICI-specific keywords and follow lines are not included
      const axisSummary = { issuerGuess: 'axis' };
      const axisSample = pickProbeSample(lines, axisSummary);
      const axisTexts = new Set(axisSample.map((l) => l.text));

      expect(axisTexts.has('Amortization details for loan')).toBe(false);
      expect(axisTexts.has('DCC cross-currency markup')).toBe(false);
      expect(axisTexts.has('IGST levied at 18%')).toBe(false);
      expect(axisTexts.has('Autodebit scheduled on due date')).toBe(false);
      expect(axisTexts.has('Regular line 61')).toBe(false);
    });

    it('Rule 4: raises report limit to 16,000 characters and truncates with 16,000 notice when exceeded', () => {
      // 1. Report between 12,000 and 16,000 characters is NOT truncated
      const midLines = [];
      for (let i = 1; i <= 140; i++) {
        midLines.push({
          page: 1,
          lineNo: i,
          text: `12/10/2026 ⇥ Regular Transaction Description With Several Details ${i} ⇥ 9,999.99 Dr`,
        });
      }
      const midSummary = summarizeStructure(midLines);
      const midReport = formatProbeReport(midSummary, midLines);
      expect(midReport.length).toBeGreaterThan(12000);
      expect(midReport.length).toBeLessThanOrEqual(16000);
      expect(midReport).not.toContain('Sample truncated');

      // 2. Report exceeding 16,000 characters is truncated to stay under 16,000
      const longLines = [];
      for (let i = 1; i <= 400; i++) {
        longLines.push({
          page: 1,
          lineNo: i,
          text: `12/10/2026 ⇥ Long Transaction Description Here With Lots Of Words And Details ${i} ⇥ 9,999.99 Dr`,
        });
      }

      const summary = summarizeStructure(longLines);
      const report = formatProbeReport(summary, longLines);

      expect(report.length).toBeLessThanOrEqual(16000);
      expect(report).toContain('=== Statement Structure Summary ===');
      expect(report).toContain('=== Sample Lines ===');
      expect(report).toContain('Sample truncated to stay under 16,000 characters');
    });

    it('Masking rules: amounts remain masked at level layout in probe sampling and report workflow', () => {
      const rawLines = [
        { page: 1, lineNo: 1, text: 'ICICI Bank Credit Card Statement' },
        { page: 1, lineNo: 2, text: 'Cardholder: Kshitij Bajpai' },
        { page: 1, lineNo: 3, text: 'Total Amount due: 45,678.50' },
        { page: 1, lineNo: 4, text: '12/10/2026 ⇥ SWIGGY BANGALORE ⇥ 1,234.56 Dr' },
        { page: 1, lineNo: 5, text: '15/10/2026 ⇥ REFUND OF ITEM ⇥ 500.00 Cr' },
      ];

      const maskedLines = maskStatementText(rawLines, {
        ownerNames: ['Kshitij Bajpai'],
        level: 'layout',
      });

      const summary = summarizeStructure(maskedLines);
      const sample = pickProbeSample(maskedLines, summary);
      const report = formatProbeReport(summary, sample);

      expect(report).toContain('Cardholder: <NAME>');
      expect(report).toContain('Total Amount due: 99,999.99');
      expect(report).toContain('SWIGGY BANGALORE ⇥ 9,999.99 Dr');
      expect(report).toContain('REFUND OF ITEM ⇥ 999.99 Cr');
      // Original amounts should NOT appear
      expect(report).not.toContain('45,678.50');
      expect(report).not.toContain('1,234.56');
      expect(report).not.toContain('500.00');
    });
  });
});

