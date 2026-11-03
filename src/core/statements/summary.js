/**
 * Summarizes the structural characteristics of extracted statement lines.
 *
 * Returned structure:
 * {
 *   pageCount: number,
 *   lineCount: number,
 *   hasText: boolean,
 *   issuerGuess: "axis" | "icici" | "hdfc" | "idfc" | "unknown",
 *   cardEndings: string[],
 *   dateFormatsSeen: Array<{ format: string, count: number }>,
 *   txnLikeLineCount: number,
 *   headerLines: Array<{ page: number, lineNo: number, text: string }>
 * }
 */

const HEADER_KEYWORDS = [
  'date',
  'description',
  'particulars',
  'merchant',
  'amount',
  'debit',
  'credit',
  'dr',
  'cr',
  'transaction',
  'reward',
];

const DATE_FORMAT_PATTERNS = [
  { regex: /\b\d{2}\/\d{2}\/\d{4}\b/g, format: 'dd/mm/yyyy' },
  { regex: /\b\d{2}\/\d{2}\/\d{2}\b/g, format: 'dd/mm/yy' },
  { regex: /\b\d{2}-\d{2}-\d{4}\b/g, format: 'dd-mm-yyyy' },
  { regex: /\b\d{2}-\d{2}-\d{2}\b/g, format: 'dd-mm-yy' },
  { regex: /\b\d{2}-[A-Za-z]{3}-\d{4}\b/gi, format: 'dd-Mon-yyyy' },
  { regex: /\b\d{2}-[A-Za-z]{3}-\d{2}\b/gi, format: 'dd-Mon-yy' },
  { regex: /\b\d{2}\s+[A-Za-z]{3}\s+\d{4}\b/gi, format: 'dd Mon yyyy' },
  { regex: /\b\d{2}\s+[A-Za-z]{3}\s+\d{2}\b/gi, format: 'dd Mon yy' },
  { regex: /\b\d{4}-\d{2}-\d{2}\b/g, format: 'yyyy-mm-dd' },
  { regex: /\b\d{2}\.\d{2}\.\d{4}\b/g, format: 'dd.mm.yyyy' },
];

export function isTxnLikeLine(text) {
  if (typeof text !== 'string') return false;
  // Starts with date token
  const startsWithDate = /^\s*(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}[- ](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[- ]\d{2,4}|\d{4}-\d{2}-\d{2})\b/i.test(text);
  if (!startsWithDate) return false;

  // Ends with amount token (optionally followed by Dr or Cr)
  const endsWithAmount = /[\d,9]+\.\d{2}(?:\s*(?:Dr|Cr|dr|cr))?\s*$/i.test(text);
  return endsWithAmount;
}

export function isHeaderLine(text) {
  if (typeof text !== 'string') return false;
  let matches = 0;
  for (const kw of HEADER_KEYWORDS) {
    const reg = new RegExp(`\\b${kw}\\b`, 'i');
    if (reg.test(text)) {
      matches += 1;
      if (matches >= 2) return true;
    }
  }
  return false;
}

export function summarizeStructure(lines = []) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return {
      pageCount: 0,
      lineCount: 0,
      hasText: false,
      issuerGuess: 'unknown',
      cardEndings: [],
      dateFormatsSeen: [],
      txnLikeLineCount: 0,
      headerLines: [],
    };
  }

  // 1. Line count and page count
  const lineCount = lines.length;
  let maxPage = 0;
  let totalChars = 0;
  for (const line of lines) {
    if (line && line.page && line.page > maxPage) {
      maxPage = line.page;
    }
    if (line && typeof line.text === 'string') {
      totalChars += line.text.trim().length;
    }
  }
  const pageCount = maxPage > 0 ? maxPage : 1;
  const hasText = totalChars >= 20;

  // 2. Issuer guess in first 40 lines (case-insensitive)
  const first40 = lines.slice(0, 40);
  const first40Text = first40.map((l) => l.text || '').join(' ').toLowerCase();

  let issuerGuess = 'unknown';
  const issuers = ['axis', 'icici', 'hdfc', 'idfc'];
  let earliestIdx = Infinity;

  for (const iss of issuers) {
    const idx = first40Text.indexOf(iss);
    if (idx !== -1 && idx < earliestIdx) {
      earliestIdx = idx;
      issuerGuess = iss;
    }
  }

  // 3. Card endings: unique last 4 digits seen in card-number-shaped tokens
  const cardEndingsSet = new Set();
  const cardTokenRegex = /\b(?:\d{4}[ -]?|\d{2}XX[ -]?|XXXX[ -]?|[X\d]{4}[ -]?){3}(\d{4})\b/g;
  const shortCardRegex = /\b(?:card|no\.?|ending\s+in|a\/c|xx)\s*:?\s*[xX*]+(\d{4})\b/gi;

  for (const line of lines) {
    const t = line?.text || '';
    let m;
    while ((m = cardTokenRegex.exec(t)) !== null) {
      cardEndingsSet.add(m[1]);
    }
    while ((m = shortCardRegex.exec(t)) !== null) {
      cardEndingsSet.add(m[1]);
    }
  }
  const cardEndings = Array.from(cardEndingsSet);

  // 4. Date formats seen with counts
  const formatCounts = new Map();
  for (const line of lines) {
    const t = line?.text || '';
    for (const { regex, format } of DATE_FORMAT_PATTERNS) {
      const re = new RegExp(regex.source, regex.flags);
      let match;
      while ((match = re.exec(t)) !== null) {
        formatCounts.set(format, (formatCounts.get(format) || 0) + 1);
      }
    }
  }

  const dateFormatsSeen = Array.from(formatCounts.entries())
    .map(([format, count]) => ({
      format,
      count,
      toString() {
        return `${this.format} (${this.count})`;
      },
    }))
    .sort((a, b) => b.count - a.count);

  // 5. Txn-like lines and Header lines
  let txnLikeLineCount = 0;
  const headerLines = [];

  for (const line of lines) {
    const t = line?.text || '';
    if (isTxnLikeLine(t)) {
      txnLikeLineCount += 1;
    }
    if (isHeaderLine(t)) {
      headerLines.push(line);
    }
  }

  return {
    pageCount,
    lineCount,
    hasText,
    issuerGuess,
    cardEndings,
    dateFormatsSeen,
    txnLikeLineCount,
    headerLines,
  };
}

