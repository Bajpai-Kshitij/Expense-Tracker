/**
 * Selects an informative structural sample of statement lines.
 *
 * Selection rules:
 * - First 70 lines of page 1 (header and summary)
 * - Always include the 12 lines after any line containing "CREDIT SUMMARY", "Total Amount due" or "Previous Balance"
 * - When issuer guess is icici, include every line containing "Amortization", "EMI", "DCC", "IGST", "Autodebit" and the 6 lines that follow "EMI / PERSONAL LOAN"
 * - Up to 5 header lines wherever found
 * - Up to 40 txn-like lines (spread: first 15, 10 from middle, last 15)
 * - Plus 3 lines before the first txn-like line and 3 after the last one
 * - Plus up to 20 lines containing keywords: total, opening, closing, payment,
 *   reversal, refund, emi, fee, interest, gst
 * - Preserves original order, marks each with page and line numbers, removes duplicates
 */

import { isTxnLikeLine, isHeaderLine, summarizeStructure } from './summary.js';

const KEYWORD_REGEX = /\b(?:total|opening|closing|payment|reversal|refund|emi|fee|interest|gst)\b/i;
const SUMMARY_SECTION_REGEX = /(?:credit summary|total amount due|previous balance)/i;
const ICICI_KEYWORDS_REGEX = /\b(?:amortization|emi|dcc|igst|autodebit)\b/i;
const ICICI_EMI_LOAN_REGEX = /emi\s*\/\s*personal\s+loan/i;

export function pickProbeSample(lines = [], summary = null, opts = {}) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return [];
  }

  const selectedIndices = new Set();

  // 1. First 70 lines of page 1
  let page1Count = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l && l.page === 1) {
      if ((l.lineNo != null && l.lineNo <= 70) || (l.lineNo == null && page1Count < 70)) {
        selectedIndices.add(i);
      }
      page1Count += 1;
    }
  }

  // 2. Always include the 12 lines after any line containing "CREDIT SUMMARY", "Total Amount due" or "Previous Balance"
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l && typeof l.text === 'string' && SUMMARY_SECTION_REGEX.test(l.text)) {
      selectedIndices.add(i);
      const afterEnd = Math.min(lines.length, i + 13);
      for (let k = i + 1; k < afterEnd; k++) {
        selectedIndices.add(k);
      }
    }
  }

  // 3. When issuer guess is icici, include every line containing "Amortization", "EMI", "DCC", "IGST", "Autodebit"
  //    and the 6 lines that follow "EMI / PERSONAL LOAN"
  const rawIssuer = summary?.issuerGuess ?? opts?.issuerGuess;
  const issuerGuess = (
    rawIssuer != null
      ? rawIssuer
      : (summary ? '' : (lines.length > 0 ? summarizeStructure(lines).issuerGuess : ''))
  )?.toLowerCase();
  const isIcici = issuerGuess === 'icici';

  if (isIcici) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (l && typeof l.text === 'string') {
        if (ICICI_KEYWORDS_REGEX.test(l.text)) {
          selectedIndices.add(i);
        }
        if (ICICI_EMI_LOAN_REGEX.test(l.text)) {
          selectedIndices.add(i);
          const followEnd = Math.min(lines.length, i + 7);
          for (let k = i + 1; k < followEnd; k++) {
            selectedIndices.add(k);
          }
        }
      }
    }
  }

  // 4. Up to 5 header lines wherever found
  let headerCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (headerCount >= 5) break;
    const l = lines[i];
    if (l && isHeaderLine(l.text)) {
      selectedIndices.add(i);
      headerCount += 1;
    }
  }

  // 5. Txn-like lines (up to 40)
  const txnIndices = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l && isTxnLikeLine(l.text)) {
      txnIndices.push(i);
    }
  }

  if (txnIndices.length > 0) {
    if (txnIndices.length <= 40) {
      for (const idx of txnIndices) {
        selectedIndices.add(idx);
      }
    } else {
      // First 15
      for (let i = 0; i < 15; i++) {
        selectedIndices.add(txnIndices[i]);
      }
      // 10 from the middle
      const midStart = Math.max(15, Math.floor((txnIndices.length - 10) / 2));
      const midEnd = Math.min(txnIndices.length - 15, midStart + 10);
      for (let i = midStart; i < midEnd; i++) {
        selectedIndices.add(txnIndices[i]);
      }
      // Last 15
      for (let i = txnIndices.length - 15; i < txnIndices.length; i++) {
        selectedIndices.add(txnIndices[i]);
      }
    }

    // Plus 3 lines before the first txn-like line
    const firstTxnIdx = txnIndices[0];
    const beforeStart = Math.max(0, firstTxnIdx - 3);
    for (let i = beforeStart; i < firstTxnIdx; i++) {
      selectedIndices.add(i);
    }

    // Plus 3 lines after the last txn-like line
    const lastTxnIdx = txnIndices[txnIndices.length - 1];
    const afterEnd = Math.min(lines.length, lastTxnIdx + 4);
    for (let i = lastTxnIdx + 1; i < afterEnd; i++) {
      selectedIndices.add(i);
    }
  }

  // 6. Up to 20 keyword lines
  let keywordLinesCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (keywordLinesCount >= 20) break;
    const l = lines[i];
    if (l && KEYWORD_REGEX.test(l.text)) {
      if (!selectedIndices.has(i)) {
        selectedIndices.add(i);
        keywordLinesCount += 1;
      }
    }
  }

  // 7. Sort by original index to keep original order
  const sortedIndices = Array.from(selectedIndices).sort((a, b) => a - b);
  return sortedIndices.map((idx) => lines[idx]);
}
