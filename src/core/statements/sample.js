/**
 * Selects an informative structural sample of statement lines.
 *
 * Selection rules:
 * - First 25 lines of page 1 (header and summary)
 * - Up to 5 header lines wherever found
 * - Up to 40 txn-like lines (spread: first 15, 10 from middle, last 15)
 * - Plus 3 lines before the first txn-like line and 3 after the last one
 * - Plus up to 20 lines containing keywords: total, opening, closing, payment,
 *   reversal, refund, emi, fee, interest, gst
 * - Preserves original order, marks each with page and line numbers, removes duplicates
 */

import { isTxnLikeLine, isHeaderLine } from './summary.js';

const KEYWORD_REGEX = /\b(?:total|opening|closing|payment|reversal|refund|emi|fee|interest|gst)\b/i;

export function pickProbeSample(lines = [], summary = null, opts = {}) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return [];
  }

  const selectedIndices = new Set();

  // 1. First 25 lines of page 1
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l && l.page === 1 && l.lineNo <= 25) {
      selectedIndices.add(i);
    }
  }

  // 2. Up to 5 header lines wherever found
  let headerCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (headerCount >= 5) break;
    const l = lines[i];
    if (l && isHeaderLine(l.text)) {
      selectedIndices.add(i);
      headerCount += 1;
    }
  }

  // 3. Txn-like lines (up to 40)
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

  // 4. Up to 20 keyword lines
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

  // 5. Sort by original index to keep original order
  const sortedIndices = Array.from(selectedIndices).sort((a, b) => a - b);
  return sortedIndices.map((idx) => lines[idx]);
}

