/**
 * ICICI Credit Card Statement Parser.
 *
 * Implements Phase P8b-2b-1:
 * - Detects ICICI Credit Card Statements (requires "CREDIT CARD STATEMENT" and "SPENDS OVERVIEW" in first 80 lines; rejects Axis Bank)
 * - Extracts Statement Date and Period ("Statement period : <Month d, yyyy> to <Month d, yyyy>")
 * - Tracks card blocks (XXXXXXXXXXXX7922)
 * - Parses transaction lines from end: Date, Serial No (8-14 digits), Details, Reward Points, Amount (optional CR)
 * - Cleans merchantRaw (removes trailing " IN" when details has >= 4 words)
 * - Skips zero amounts (counted in warnings)
 * - Categorizes types: payment, refund, fee, tax, emi_interest, emi_principal, purchase
 * - Pairs IGST lines with preceding base within 3 lines on same date (18% +/- 1 paisa):
 *   base emi_interest -> emi_tax; other base -> base becomes fee, tax stays tax
 * - Groups EMI lines (interest, tax, principal) per date and extracts marker <n/N>Merchant
 * - Parses EMI table on page 2 and links plans by monthlyPaise = principal + interest
 * - Performs self-check: parsed + skipped + unparsed = txn-like lines count
 */

import { isTxnLikeLine } from '../summary.js';

const MONTH_NAMES = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseEnglishDate(str) {
  if (typeof str !== 'string') return null;
  const m = str.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return null;
  const monthName = m[1].toLowerCase();
  const month = MONTH_NAMES[monthName];
  if (!month) return null;
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { iso: `${year}-${mm}-${dd}`, ddmm: `${dd}/${mm}/${year}` };
}

function parseDdMmYyyy(str) {
  if (typeof str !== 'string') return null;
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

function parseAmountPaise(str) {
  if (typeof str !== 'string') return 0;
  const clean = str.replace(/,/g, '').trim();
  const val = Math.round(parseFloat(clean) * 100);
  return isNaN(val) ? 0 : val;
}

function cleanMerchantRaw(details) {
  if (typeof details !== 'string') return '';
  const trimmed = details.trim();
  if (trimmed.endsWith(' IN')) {
    const words = trimmed.split(/\s+/);
    if (words.length >= 4) {
      return trimmed.slice(0, -3).trim();
    }
  }
  return trimmed;
}

export function detect(lines = []) {
  if (!Array.isArray(lines) || lines.length === 0) return false;
  const first80 = lines.slice(0, 80);
  const text80 = first80.map((l) => l.text || '').join(' ');
  if (/Axis\s+Bank/i.test(text80)) return false;
  const hasCcStatement = /CREDIT\s+CARD\s+STATEMENT/i.test(text80);
  const hasSpendsOverview = first80.some((l) => /SPENDS\s+OVERVIEW/i.test(l.text || ''));
  return hasCcStatement && hasSpendsOverview;
}

export function checkTotals(result) {
  return {
    ok: true,
    differences: [],
    note: 'totals not checked yet',
  };
}

export function parse(lines = [], ctx = {}) {
  const result = {
    ok: true,
    issuer: 'icici',
    parser: 'icici_cc',
    account: { issuer: 'icici', digits: null },
    period: null,
    statementDate: null,
    lines: [],
    emiPlans: [],
    declaredTotals: null,
    unparsedLines: [],
    warnings: [],
  };

  if (!Array.isArray(lines) || lines.length === 0) {
    return result;
  }

  // Pre-normalize lines by replacing " ⇥ " and "⇥" with 3 spaces
  const normLines = lines.map((l) => {
    const text = (l?.text || '').replace(/ ⇥ /g, '   ').replace(/⇥/g, '   ');
    return { ...l, text };
  });

  // 1. Statement Date: line after "STATEMENT DATE"
  for (let i = 0; i < normLines.length; i++) {
    if (/STATEMENT\s+DATE/i.test(normLines[i].text)) {
      if (i + 1 < normLines.length) {
        const parsed = parseEnglishDate(normLines[i + 1].text);
        if (parsed) {
          result.statementDate = parsed.iso;
          break;
        }
      }
    }
  }

  // 2. Period: "Statement period : <Month d, yyyy> to <Month d, yyyy>" searched across ALL lines
  const periodRegex = /Statement\s+period\s*:\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})\s+to\s+([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i;
  for (const l of normLines) {
    const m = l.text.match(periodRegex);
    if (m) {
      const start = parseEnglishDate(m[1]);
      const end = parseEnglishDate(m[2]);
      if (start && end) {
        result.period = {
          start: start.ddmm,
          end: end.ddmm,
          startDate: start.iso,
          endDate: end.iso,
        };
        break;
      }
    }
  }

  // 3. Find Transaction Section & EMI Table boundaries
  let txnStartIdx = -1;
  let txnEndIdx = normLines.length;
  let emiTableStartIdx = -1;

  for (let i = 0; i < normLines.length; i++) {
    const text = normLines[i].text;
    if (txnStartIdx === -1 && /SPENDS\s+OVERVIEW/i.test(text)) {
      txnStartIdx = i;
    }
    if (txnStartIdx !== -1 && i > txnStartIdx && txnEndIdx === normLines.length) {
      if (/International\s+Spends/i.test(text) || /EMI\s*\/\s*PERSONAL\s+LOAN\s+ON\s+CREDIT\s+CARDS/i.test(text)) {
        txnEndIdx = i;
      }
    }
    if (/EMI\s*\/\s*PERSONAL\s+LOAN\s+ON\s+CREDIT\s+CARDS/i.test(text)) {
      emiTableStartIdx = i;
    }
  }

  // 4. Parse EMI Table (after "EMI / PERSONAL LOAN ON CREDIT CARDS")
  if (emiTableStartIdx !== -1) {
    for (let i = emiTableStartIdx + 1; i < normLines.length; i++) {
      const text = normLines[i].text.trim();
      if (!text || text.startsWith('*') || /Transaction\//i.test(text)) continue;

      // Row layout: Merchant EMI   11/05/2026   11/01/2027   9   64,417.00   3   22,928.19   7,642.72
      const tokens = text.split(/\s{2,}/);
      if (tokens.length >= 8) {
        const creationIso = parseDdMmYyyy(tokens[1]);
        const finishIso = parseDdMmYyyy(tokens[2]);
        const total = parseInt(tokens[3], 10);
        const loanPaise = parseAmountPaise(tokens[4]);
        const pending = parseInt(tokens[5], 10);
        const outstandingPaise = parseAmountPaise(tokens[6]);
        const monthlyPaise = parseAmountPaise(tokens[7]);

        if (creationIso && finishIso && !isNaN(total) && !isNaN(pending)) {
          result.emiPlans.push({
            creationDate: creationIso,
            finishDate: finishIso,
            total,
            loanPaise,
            pending,
            outstandingPaise,
            monthlyPaise,
          });
        }
      }
    }
  }

  // 5. Parse Transaction Section
  let currentCardDigits = null;
  const rawTxnLines = [];
  let skippedZeroCount = 0;
  let txnLikeInScopeCount = 0;

  const cardMaskRegex = /^[X\*\d\s\-]+$/i;

  const sliceStart = txnStartIdx !== -1 ? txnStartIdx : 0;
  const sliceEnd = txnEndIdx;

  for (let i = sliceStart; i < sliceEnd; i++) {
    const l = normLines[i];
    const text = l.text.trim();
    if (!text) continue;

    // Check for card block line: e.g. XXXXXXXXXXXX7922
    if (cardMaskRegex.test(text) && /\d{4}$/.test(text)) {
      const m = text.match(/(\d{4})$/);
      if (m) {
        currentCardDigits = m[1];
        if (!result.account.digits) {
          result.account.digits = currentCardDigits;
        }
      }
      continue;
    }

    // Inside transaction section, ignore every line that does not start with dd/mm/yyyy
    const startsWithDate = /^\d{2}\/\d{2}\/\d{4}\b/.test(text);
    if (!startsWithDate) {
      continue;
    }

    // Count line as transaction-like candidate
    if (isTxnLikeLine(text)) {
      txnLikeInScopeCount += 1;
    }

    // Extract Date dd/mm/yyyy
    const dateMatch = text.match(/^(\d{2}\/\d{2}\/\d{4})\s+(.*)$/);
    if (!dateMatch) {
      result.unparsedLines.push({ page: l.page, lineNo: l.lineNo, text });
      continue;
    }

    const dateDdmm = dateMatch[1];
    const dateIso = parseDdMmYyyy(dateDdmm);
    const rest = dateMatch[2].trim();

    // Must have a serial number of 8 to 14 digits next
    const serialMatch = rest.match(/^(\d{8,14})\s+(.*)$/);
    if (!serialMatch) {
      result.unparsedLines.push({ page: l.page, lineNo: l.lineNo, text });
      continue;
    }

    const serialNo = serialMatch[1];
    const afterSerial = serialMatch[2].trim();

    // Parse from the end: points (integer) and amount with optional CR
    // Expected tail: <details> <integer points> <amount>[ CR]
    const endMatch = afterSerial.match(/^(.*?)\s+(-?\d+)\s+([\d,]+\.\d{2})\s*(CR)?$/i);
    if (!endMatch) {
      result.unparsedLines.push({ page: l.page, lineNo: l.lineNo, text });
      continue;
    }

    const details = endMatch[1].trim();
    const rewardPoints = parseInt(endMatch[2], 10);
    const amountStr = endMatch[3];
    const isCr = Boolean(endMatch[4]);
    const amountPaise = parseAmountPaise(amountStr);

    if (amountPaise === 0) {
      skippedZeroCount += 1;
      continue;
    }

    const merchantRaw = cleanMerchantRaw(details);

    // Initial type assignment
    let type = 'purchase';
    let direction = isCr ? 'credit' : 'debit';

    if (isCr) {
      if (/payment\s+recd|payment\s+received|autodebit\s+payment|bbps|neft|upi\s+payment/i.test(details)) {
        type = 'payment';
      } else {
        type = 'refund';
      }
    } else {
      if (/DCC\s+Fee/i.test(details) || /\b(?:FEE|CHARGE|LATE\s+PAYMENT)\b/i.test(details)) {
        type = 'fee';
      } else if (/IGST-CI@18%|CGST|SGST/i.test(details)) {
        type = 'tax';
      } else if (/Interest\s+Amount\s+Amortization/i.test(details)) {
        type = 'emi_interest';
      } else if (/Principal\s+Amount\s+Amortization/i.test(details)) {
        type = 'emi_principal';
      } else {
        type = 'purchase';
      }
    }

    rawTxnLines.push({
      page: l.page,
      lineNo: l.lineNo,
      date: dateIso,
      dateDdmm,
      serialNo,
      details,
      merchantRaw,
      rewardPoints,
      amountPaise,
      direction,
      type,
      cardDigits: currentCardDigits,
    });
  }

  // 6. TAX PAIRING:
  // An IGST line belongs to the nearest PRECEDING line of the same date, within 3 lines,
  // whose amount x 18% rounded to the nearest paisa (+/- 1 paisa) equals the IGST amount.
  const pairedBaseIndices = new Set();
  for (let i = 0; i < rawTxnLines.length; i++) {
    const line = rawTxnLines[i];
    if (line.type === 'tax' && /IGST/i.test(line.details)) {
      for (let j = i - 1; j >= Math.max(0, i - 3); j--) {
        const cand = rawTxnLines[j];
        if (cand.date === line.date && !pairedBaseIndices.has(j)) {
          const expectedTax = Math.round(cand.amountPaise * 0.18);
          if (Math.abs(expectedTax - line.amountPaise) <= 1) {
            pairedBaseIndices.add(j);
            if (cand.type === 'emi_interest') {
              line.type = 'emi_tax';
            } else {
              cand.type = 'fee';
            }
            break;
          }
        }
      }
    }
  }

  // 7. EMI GROUPING:
  // For each date, group the emi_interest, emi_tax and emi_principal lines.
  const emiGroupMap = new Map();
  for (let i = 0; i < rawTxnLines.length; i++) {
    const line = rawTxnLines[i];
    if (line.type === 'emi_interest' || line.type === 'emi_tax' || line.type === 'emi_principal') {
      if (!emiGroupMap.has(line.date)) {
        emiGroupMap.set(line.date, []);
      }
      emiGroupMap.get(line.date).push(line);
    }
  }

  for (const [date, emiLines] of emiGroupMap.entries()) {
    // Collect marker <n/N>Merchant
    let emiNo = null;
    let emiTotal = null;
    let emiMerchant = '';

    for (const l of emiLines) {
      const markerMatch = l.details.match(/<(\d+)\/(\d+)>(.*)$/);
      if (markerMatch) {
        emiNo = parseInt(markerMatch[1], 10);
        emiTotal = parseInt(markerMatch[2], 10);
        emiMerchant = cleanMerchantRaw(markerMatch[3]);
        break;
      }
    }

    // Find principal and interest amounts to match against EMI plan
    const principalLine = emiLines.find((l) => l.type === 'emi_principal');
    const interestLine = emiLines.find((l) => l.type === 'emi_interest');
    const principalPaise = principalLine ? principalLine.amountPaise : 0;
    const interestPaise = interestLine ? interestLine.amountPaise : 0;
    const combinedMonthly = principalPaise + interestPaise;

    // Match plan from result.emiPlans where monthlyPaise === principal + interest
    const matchedPlan = result.emiPlans.find((p) => p.monthlyPaise === combinedMonthly);

    for (const l of emiLines) {
      l.emiNo = emiNo;
      l.emiTotal = emiTotal;
      l.emiMerchant = emiMerchant;
      if (matchedPlan) {
        l.plan = matchedPlan;
        l.emiFinishDate = matchedPlan.finishDate;
        l.emiOutstandingPaise = matchedPlan.outstandingPaise;
        l.emiMonthlyPaise = matchedPlan.monthlyPaise;
      }
    }
  }

  result.lines = rawTxnLines;

  if (skippedZeroCount > 0) {
    result.warnings.push(`Skipped ${skippedZeroCount} zero-amount transaction line(s)`);
  }

  // Self-check: parsed + skipped + unparsed = txn-like lines found by isTxnLikeLine in the section
  const totalCount = result.lines.length + skippedZeroCount + result.unparsedLines.length;
  if (totalCount !== txnLikeInScopeCount) {
    result.warnings.push(`Conservation check mismatch: parsed+skipped+unparsed=${totalCount}, txnLikeFound=${txnLikeInScopeCount}`);
  }

  return result;
}

export const iciciParser = {
  issuer: 'icici',
  name: 'icici_cc',
  detect,
  parse,
  checkTotals,
};
