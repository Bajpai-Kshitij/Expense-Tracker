/**
 * Masking helper for collecting raw SMS samples safely.
 * Replaces sensitive digits, URLs, and phone numbers while keeping card endings and line breaks.
 * Pure function only; never throws and is idempotent.
 */

const URL_REGEX = /(?:https?:\/\/[^\s]+|\b[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}\/[^\s]*)/gi;

const PHONE_REGEX =
  /(?:\+91[\s-]?)?\b[6-9]\d{3}[\s-]?[xX\d]{6}\b|(?:\+91[\s-]?)?\b18[06]0[\s-]?[xX\d]{3,4}[\s-]?[xX\d]{3,4}\b|\+91[\s-]?\d{10,}\b|\b0[6-9]\d{9}\b|(?<=\b(?:call|dial|helpline)\s+)(?:\+91[\s-]?)?\d{10,}\b/gi;

/**
 * Masks raw SMS body text for safe sharing.
 * 
 * @param {string} body 
 * @returns {string} Masked body text
 */
export function maskForSharing(body) {
  if (typeof body !== 'string') {
    return '';
  }

  try {
    let result = body;

    // 1. Replace URLs (http/https or bare domain with path) with <url>
    result = result.replace(URL_REGEX, (url) => {
      // If URL ends with sentence punctuation, separate it
      let trailing = '';
      while (/[.,;:!?]$/.test(url)) {
        trailing = url.slice(-1) + trailing;
        url = url.slice(0, -1);
      }
      return '<url>' + trailing;
    });

    // 2. Replace phone-like runs (10+ digits, optionally with +91) with <phone>
    result = result.replace(PHONE_REGEX, '<phone>');

    // 3. Replace runs of 5 or more digits with X keeping only the last two digits
    // Runs of 4 or fewer digits are kept as-is (e.g. card last 4 digits)
    result = result.replace(/\d{5,}/g, (match) => {
      return 'X'.repeat(match.length - 2) + match.slice(-2);
    });

    // 4. Collapse whitespace within lines but keep line breaks
    result = result
      .split(/\r?\n/)
      .map((line) => line.replace(/[^\S\r\n]+/g, ' ').trim())
      .join('\n');

    return result;
  } catch (err) {
    return '';
  }
}
