import { parseRupees } from '../../format/money.js';

function isValidDateParts(dd, mm, yyyy) {
  if (isNaN(dd) || isNaN(mm) || isNaN(yyyy)) return false;
  if (yyyy < 2000 || yyyy > 2100) return false;
  if (mm < 1 || mm > 12) return false;
  const daysInMonth = new Date(yyyy, mm, 0).getDate();
  return dd >= 1 && dd <= daysInMonth;
}

function parseDateDdMmYyyy(str) {
  const m = str.match(/^(\d{2})[/.-](\d{2})[/.-](\d{4})$/);
  if (!m) return null;
  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const yyyy = parseInt(m[3], 10);
  if (!isValidDateParts(dd, mm, yyyy)) return null;
  return `${yyyy}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

function moneyStringToPaise(str) {
  if (typeof str !== 'string' && typeof str !== 'number') return null;
  const clean = String(str).replace(/,/g, '').trim();
  const n = parseFloat(clean);
  if (isNaN(n) || n < 0) return null;
  return Math.round(n * 100);
}

function extractProduct(lines) {
  for (let i = 0; i < Math.min(lines.length, 15); i++) {
    const text = (lines[i].text || '').trim();
    if (/flipkart/i.test(text)) return 'Flipkart';
    if (/my\s*zone/i.test(text)) return 'MY ZONE';
    const m = text.match(/^(.*?)\s+(?:Axis\s+Bank\s+)?(?:VISA\s+|MasterCard\s+|Rupay\s+)?CREDIT\s+CARD\s+STATEMENT/i);
    if (m && m[1].trim()) return m[1].trim();
  }
  return 'Credit Card';
}

function extractInitialCardDigits(lines) {
  for (const item of lines) {
    const text = item.text || '';
    const m = text.match(/\b\d{4,6}[*Xx]{4,10}(\d{4})\b/);
    if (m) return m[1];
  }
  return '';
}

function extractPeriod(lines) {
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text || '';
    if (/Total\s+Payment\s+Due.*Statement\s+Period/i.test(text)) {
      for (let j = i + 1; j < Math.min(lines.length, i + 5); j++) {
        const nextText = lines[j].text || '';
        const rangeMatch = nextText.match(/(\d{2})[/.-](\d{2})[/.-](\d{4})\s*-\s*(\d{2})[/.-](\d{2})[/.-](\d{4})/);
        if (rangeMatch) {
          const from = parseDateDdMmYyyy(`${rangeMatch[1]}/${rangeMatch[2]}/${rangeMatch[3]}`);
          const to = parseDateDdMmYyyy(`${rangeMatch[4]}/${rangeMatch[5]}/${rangeMatch[6]}`);
          if (from && to) {
            return { from, to };
          }
        }
      }
    }
  }
  return null;
}

function extractDeclaredTotals(lines, warnings) {
  let headerIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].text || '';
    if (/Previous\s+Balance\s*-\s*Payments\s*-\s*Credits\s*\+\s*Purchase/i.test(text)) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    warnings.push('Declared totals row could not be read');
    return null;
  }

  let totalsRowText = '';
  for (let i = headerIndex + 1; i < Math.min(lines.length, headerIndex + 5); i++) {
    const text = (lines[i].text || '').trim();
    const textBeforeTab = text.split('⇥')[0].trim();
    const moneyMatches = textBeforeTab.match(/[\d,]+\.\d{2}/g);
    if (moneyMatches && moneyMatches.length >= 7) {
      totalsRowText = text;
      break;
    }
  }

  if (!totalsRowText) {
    warnings.push('Declared totals row could not be read');
    return null;
  }

  const textBeforeTab = totalsRowText.split('⇥')[0].trim();
  const moneyMatches = textBeforeTab.match(/[\d,]+\.\d{2}/g);

  if (!moneyMatches || moneyMatches.length < 7) {
    warnings.push('Declared totals row could not be read');
    return null;
  }

  const payments = moneyStringToPaise(moneyMatches[1]);
  const credits = moneyStringToPaise(moneyMatches[2]);
  const purchases = moneyStringToPaise(moneyMatches[3]);
  const cash = moneyStringToPaise(moneyMatches[4]);
  const other = moneyStringToPaise(moneyMatches[5]);

  if (payments === null || credits === null || purchases === null || cash === null || other === null) {
    warnings.push('Declared totals row could not be read');
    return null;
  }

  return {
    payments,
    credits,
    purchases,
    cash,
    other,
  };
}

export function detect(lines = []) {
  if (!Array.isArray(lines) || lines.length === 0) return false;

  const hasIcici = lines.some((l) => /ICICI/i.test(l.text || ''));
  if (hasIcici) return false;

  const first60 = lines.slice(0, 60);
  const hasAxisOrCc = first60.some((l) => /Axis\s+Bank|CREDIT\s+CARD\s+STATEMENT/i.test(l.text || ''));
  const hasPaymentSummary = first60.some((l) => /PAYMENT\s+SUMMARY/i.test(l.text || ''));
  const hasAccountSummary = lines.some((l) => /Account\s+Summary/i.test(l.text || ''));

  return hasAxisOrCc && hasPaymentSummary && hasAccountSummary;
}

export function parse(lines = [], ctx = {}) {
  const warnings = [];
  const unparsedLines = [];
  const parsedLines = [];

  const product = extractProduct(lines);
  let defaultDigits = extractInitialCardDigits(lines);
  const period = extractPeriod(lines);
  const declaredTotals = extractDeclaredTotals(lines, warnings);

  let inTxnSection = false;
  let currentCardDigits = defaultDigits;

  for (let i = 0; i < lines.length; i++) {
    const item = lines[i];
    const text = (item.text || '').trim();
    if (!text) continue;

    // Check for end of statement
    if (/\*{3,}\s*End\s+of\s+Statement\s*\*{3,}/i.test(text)) {
      break;
    }

    // Check for Card No line
    const cardNoMatch =
      text.match(/^Card\s+No\s*:\s*(?:[A-Za-z0-9*X]+[*X]+)?(\d{4})/i) ||
      text.match(/^Card\s+No\s*:.*?\b\d{4,6}[*Xx]{4,10}(\d{4})\b/i);
    if (cardNoMatch) {
      inTxnSection = true;
      currentCardDigits = cardNoMatch[1];
      if (!defaultDigits) defaultDigits = currentCardDigits;
      continue;
    }

    if (!inTxnSection) {
      continue;
    }

    // Skip table headers
    if (/^DATE\s+(?:TRANSACTION\s+DETAILS|MERCHANT)/i.test(text)) {
      continue;
    }

    // Check if line starts with a date
    const dateStartMatch = text.match(/^(\d{2})[/.-](\d{2})[/.-](\d{4})\b/);
    if (!dateStartMatch) {
      continue;
    }

    const isoDate = parseDateDdMmYyyy(dateStartMatch[0]);
    if (!isoDate) {
      unparsedLines.push({ page: item.page, lineNo: item.lineNo });
      continue;
    }

    const restOfLine = text.slice(dateStartMatch[0].length);
    const moneyMatch = restOfLine.match(/([\d,]+\.\d{2})\s*(Dr|Cr)\b/i);

    if (!moneyMatch) {
      unparsedLines.push({ page: item.page, lineNo: item.lineNo });
      continue;
    }

    const amountStr = moneyMatch[1];
    const dirStr = moneyMatch[2];
    const parsedAmount = parseRupees(amountStr);

    if (!parsedAmount.ok || parsedAmount.paise < 0) {
      unparsedLines.push({ page: item.page, lineNo: item.lineNo });
      continue;
    }

    if (parsedAmount.paise === 0) {
      warnings.push(`Zero-amount line skipped on ${isoDate}`);
      continue;
    }

    const direction = dirStr.toUpperCase() === 'CR' ? 'credit' : 'debit';

    const middle = restOfLine.slice(0, moneyMatch.index).trim();
    if (!middle) {
      unparsedLines.push({ page: item.page, lineNo: item.lineNo });
      continue;
    }

    const middleParts = middle.split(/(?:\s{2,}|\s*⇥\s*)/).map((p) => p.trim()).filter(Boolean);
    let details = '';
    let bankCategory = null;

    if (middleParts.length >= 2) {
      details = middleParts[0];
      bankCategory = middleParts.slice(1).join(' ');
    } else {
      details = middleParts[0] || middle;
    }

    const lastComma = details.lastIndexOf(',');
    let merchantRaw = details;
    let city = null;
    if (lastComma !== -1) {
      merchantRaw = details.slice(0, lastComma).trim();
      city = details.slice(lastComma + 1).trim() || null;
    }

    let type = 'purchase';
    const upperDetails = details.toUpperCase();
    if (direction === 'credit') {
      if (upperDetails.includes('PAYMENT RECEIVED')) {
        type = 'payment';
      } else if (upperDetails.startsWith('CASHBACK CREDIT')) {
        type = 'cashback';
      } else {
        type = 'refund';
      }
    } else {
      if (/\b(?:FEE|GST|IGST|CGST|SGST|INTEREST|FINANCE\s+CHARGE)\b/i.test(upperDetails)) {
        type = 'fee';
      } else {
        type = 'purchase';
      }
    }

    parsedLines.push({
      date: isoDate,
      amountPaise: parsedAmount.paise,
      direction,
      type,
      merchantRaw,
      city,
      bankCategory,
      cardDigits: currentCardDigits,
      page: item.page,
      lineNo: item.lineNo,
    });
  }

  return {
    ok: true,
    issuer: 'axis',
    account: {
      digits: defaultDigits,
      product,
    },
    period,
    lines: parsedLines,
    declaredTotals,
    warnings,
    unparsedLines,
  };
}

export function checkTotals(result) {
  if (!result || !result.declaredTotals) {
    if (result && Array.isArray(result.warnings) && result.warnings.length > 0) {
      return { ok: false, differences: [{ field: 'declaredTotals', declared: 0, parsed: 0, diff: 1 }] };
    }
    return { ok: true, differences: [] };
  }

  const { declaredTotals, lines = [] } = result;
  const differences = [];

  const sumLines = (predicate) =>
    lines.filter(predicate).reduce((acc, l) => acc + (l.amountPaise || 0), 0);

  // payments = sum of payment lines
  const declaredPayments = declaredTotals.payments ?? declaredTotals.paymentsPaise;
  if (declaredPayments !== undefined && declaredPayments !== null) {
    const parsedPayments = sumLines((l) => l.type === 'payment');
    const diff = Math.abs(parsedPayments - declaredPayments);
    if (diff > 0) {
      differences.push({
        field: 'payments',
        declared: declaredPayments,
        parsed: parsedPayments,
        diff,
      });
    }
  }

  // credits = sum of refund and cashback lines
  const declaredCredits = declaredTotals.credits ?? declaredTotals.creditsPaise;
  if (declaredCredits !== undefined && declaredCredits !== null) {
    const parsedCredits = sumLines((l) => l.type === 'refund' || l.type === 'cashback');
    const diff = Math.abs(parsedCredits - declaredCredits);
    if (diff > 0) {
      differences.push({
        field: 'credits',
        declared: declaredCredits,
        parsed: parsedCredits,
        diff,
      });
    }
  }

  // purchases + cash advance + other = sum of all debit lines
  const declaredDebits =
    (declaredTotals.purchases ?? declaredTotals.purchasesPaise ?? 0) +
    (declaredTotals.cash ?? 0) +
    (declaredTotals.other ?? 0);

  if (declaredTotals.purchases !== undefined || declaredTotals.purchasesPaise !== undefined) {
    const parsedDebits = sumLines((l) => l.direction === 'debit');
    const diff = Math.abs(parsedDebits - declaredDebits);
    if (diff > 0) {
      differences.push({
        field: 'purchases',
        declared: declaredDebits,
        parsed: parsedDebits,
        diff,
      });
    }
  }

  return {
    ok: differences.length === 0,
    differences,
  };
}

export const axisParser = {
  issuer: 'axis',
  detect,
  parse,
  checkTotals,
};
