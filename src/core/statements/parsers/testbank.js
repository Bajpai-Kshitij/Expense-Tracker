import { parseRupees } from '../../format/money.js';

/**
 * Synthetic parser for test statements.
 * Expected line format:
 * "dd/mm/yyyy | MERCHANT | 1,234.56 | Dr" (or Cr) [optional "| refNo"]
 * Header: "TESTBANK Card ending 1234"
 * Totals: "TOTAL PURCHASES 9,999.00"
 */

const TXN_REGEX = /^\s*(\d{2})[/.-](\d{2})[/.-](\d{4})\s*[|⇥]\s*(.+?)\s*[|⇥]\s*([\d,.]+)\s*[|⇥]\s*(Dr|Cr|debit|credit)\b(?:\s*[|⇥]\s*(.+?))?\s*$/i;
const LOOKS_LIKE_TXN_REGEX = /^\s*\d{2}[/.-]\d{2}[/.-]\d{4}.+[\d,.]+(?:\s*(?:Dr|Cr|debit|credit))?\s*$/i;

export const testBankParser = {
  issuer: 'TESTBANK',

  detect(lines = []) {
    return lines.some((l) => /TESTBANK/i.test(l.text || ''));
  },

  parse(lines = [], ctx = {}) {
    let digits = '1234';
    let product = 'Credit Card';
    let declaredTotals = null;
    const parsedLines = [];
    const unparsedLines = [];
    const warnings = [];

    for (const item of lines) {
      const text = (item.text || '').trim();
      if (!text) continue;

      // Header matching for account info
      const cardMatch = text.match(/TESTBANK.*?(?:ending|#|card)\s*(\d{4})/i) || text.match(/Card ending (\d{4})/i);
      if (cardMatch) {
        digits = cardMatch[1];
        continue;
      }

      // Declared totals matching
      const totalPurchasesMatch = text.match(/TOTAL\s+PURCHASES\s+([\d,.]+)/i);
      if (totalPurchasesMatch) {
        const parsed = parseRupees(totalPurchasesMatch[1]);
        if (parsed.ok) {
          declaredTotals = declaredTotals || {};
          declaredTotals.purchasesPaise = parsed.paise;
        }
        continue;
      }

      const totalCreditsMatch = text.match(/TOTAL\s+CREDITS\s+([\d,.]+)/i);
      if (totalCreditsMatch) {
        const parsed = parseRupees(totalCreditsMatch[1]);
        if (parsed.ok) {
          declaredTotals = declaredTotals || {};
          declaredTotals.creditsPaise = parsed.paise;
        }
        continue;
      }

      const totalPaymentsMatch = text.match(/TOTAL\s+PAYMENTS\s+([\d,.]+)/i);
      if (totalPaymentsMatch) {
        const parsed = parseRupees(totalPaymentsMatch[1]);
        if (parsed.ok) {
          declaredTotals = declaredTotals || {};
          declaredTotals.paymentsPaise = parsed.paise;
        }
        continue;
      }

      const totalFeesMatch = text.match(/TOTAL\s+FEES\s+([\d,.]+)/i);
      if (totalFeesMatch) {
        const parsed = parseRupees(totalFeesMatch[1]);
        if (parsed.ok) {
          declaredTotals = declaredTotals || {};
          declaredTotals.feesPaise = parsed.paise;
        }
        continue;
      }

      // Check if it matches valid transaction line
      const match = text.match(TXN_REGEX);
      if (match) {
        const [, dd, mm, yyyy, rawMerchant, amountStr, dirStr, rawRef] = match;
        const amountParsed = parseRupees(amountStr);
        if (!amountParsed.ok || amountParsed.paise <= 0) {
          unparsedLines.push({ page: item.page, lineNo: item.lineNo });
          continue;
        }

        const date = `${yyyy}-${mm}-${dd}`;
        const direction = dirStr.toLowerCase().startsWith('cr') ? 'credit' : 'debit';
        const merchantRaw = rawMerchant.trim();
        const refNo = rawRef ? rawRef.trim() : null;

        let type = 'purchase';
        const upperMerchant = merchantRaw.toUpperCase();
        if (direction === 'credit') {
          if (upperMerchant.includes('PAYMENT')) {
            type = 'payment';
          } else if (upperMerchant.includes('REFUND')) {
            type = 'refund';
          } else {
            type = 'refund';
          }
        } else {
          if (upperMerchant.includes('FEE') || upperMerchant.includes('CHARGE')) {
            type = 'fee';
          } else if (upperMerchant.includes('INTEREST')) {
            type = 'interest';
          } else if (upperMerchant.includes('EMI')) {
            type = 'emi';
          } else {
            type = 'purchase';
          }
        }

        parsedLines.push({
          date,
          amountPaise: amountParsed.paise,
          direction,
          type,
          merchantRaw,
          refNo,
          page: item.page,
          lineNo: item.lineNo,
        });
      } else if (LOOKS_LIKE_TXN_REGEX.test(text)) {
        // Line looks like a transaction (starts with date and ends with amount/direction) but could not be parsed
        unparsedLines.push({ page: item.page, lineNo: item.lineNo });
      }
    }

    let period = null;
    if (parsedLines.length > 0) {
      const dates = parsedLines.map((l) => l.date).sort();
      period = {
        from: dates[0],
        to: dates[dates.length - 1],
      };
    }

    return {
      ok: true,
      issuer: 'TESTBANK',
      account: { digits, product },
      period,
      lines: parsedLines,
      declaredTotals,
      warnings,
      unparsedLines,
    };
  },
};

