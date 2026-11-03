/**
 * Formats a structural probe report from summary and sample lines.
 *
 * Rules:
 * - Plain-text report
 * - Summary as short key: value lines
 * - Sample lines with page:line prefix and visible tab markers (" ⇥ ")
 * - Strictly under 12,000 characters (truncates middle of sample if needed and notes it)
 */

export function formatProbeReport(summary = {}, sampleLines = []) {
  const safeSummary = summary || {};
  const safeSamples = Array.isArray(sampleLines) ? sampleLines : [];

  const cardEndingsStr = Array.isArray(safeSummary.cardEndings) && safeSummary.cardEndings.length > 0
    ? safeSummary.cardEndings.join(', ')
    : 'none';

  const dateFormatsStr = Array.isArray(safeSummary.dateFormatsSeen) && safeSummary.dateFormatsSeen.length > 0
    ? safeSummary.dateFormatsSeen.map((d) => (d.format ? `${d.format} (${d.count})` : String(d))).join(', ')
    : 'none';

  const headerLinesCount = Array.isArray(safeSummary.headerLines) ? safeSummary.headerLines.length : 0;

  const summarySection = [
    '=== Statement Structure Summary ===',
    `Pages: ${safeSummary.pageCount ?? 0}`,
    `Lines: ${safeSummary.lineCount ?? 0}`,
    `Has text: ${safeSummary.hasText ? 'yes' : 'no'}`,
    `Issuer guess: ${safeSummary.issuerGuess || 'unknown'}`,
    `Card endings: ${cardEndingsStr}`,
    `Date formats seen: ${dateFormatsStr}`,
    `Txn-like lines: ${safeSummary.txnLikeLineCount ?? 0}`,
    `Header lines: ${headerLinesCount}`,
    '',
    '=== Sample Lines ===',
  ].join('\n');

  const formattedSampleLines = safeSamples.map((l) => {
    const page = l?.page ?? 1;
    const lineNo = l?.lineNo ?? 1;
    const text = l?.text ?? '';
    return `[${page}:${lineNo}] ${text}`;
  });

  const fullReport = summarySection + '\n' + formattedSampleLines.join('\n');

  const MAX_CHARS = 12000;
  if (fullReport.length <= MAX_CHARS) {
    return fullReport;
  }

  // Truncate the middle of the sample lines to fit under MAX_CHARS
  const notice = '\n... [Sample truncated to stay under 12,000 characters] ...\n';
  const availableChars = MAX_CHARS - summarySection.length - notice.length - 10;

  if (availableChars <= 0 || formattedSampleLines.length <= 2) {
    return (summarySection + notice).slice(0, MAX_CHARS);
  }

  let headCount = Math.floor(formattedSampleLines.length / 2);
  let tailCount = formattedSampleLines.length - headCount;

  while (headCount > 1 && tailCount > 1) {
    const headText = formattedSampleLines.slice(0, headCount).join('\n');
    const tailText = formattedSampleLines.slice(formattedSampleLines.length - tailCount).join('\n');
    const candidate = summarySection + '\n' + headText + notice + tailText;
    if (candidate.length <= MAX_CHARS) {
      return candidate;
    }
    headCount = Math.max(1, headCount - 1);
    tailCount = Math.max(1, tailCount - 1);
  }

  // Fallback safe slice
  return (summarySection + '\n' + formattedSampleLines.slice(0, 5).join('\n') + notice).slice(0, MAX_CHARS);
}

