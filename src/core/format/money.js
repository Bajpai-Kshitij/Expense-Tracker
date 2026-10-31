/**
 * Money formatting and string parsing utilities with integer paise precision.
 * Strict rules: No floating-point arithmetic. All monetary values represent integer paise.
 */

/**
 * Parses a rupee string input into integer paise without floating-point math.
 * 
 * Accepts formats:
 * - "1,250", "1250.5", "1250.50", "100", "0.5", "0.05"
 * 
 * Rejects:
 * - empty, whitespace-only
 * - zero ("0", "0.0", "0.00")
 * - negative values ("-10", "-0.5")
 * - alphabetic or invalid characters ("12a", "$50")
 * - more than 2 decimal places ("12.345")
 * 
 * @param {string|number} input - Rupee input string or number.
 * @returns {{ ok: true, paise: number } | { ok: false, error: string }}
 */
export function parseRupees(input) {
  if (input === null || input === undefined) {
    return { ok: false, error: 'Amount is required' };
  }

  const str = String(input).trim();
  if (str.length === 0) {
    return { ok: false, error: 'Amount cannot be empty' };
  }

  if (str.startsWith('-')) {
    return { ok: false, error: 'Amount cannot be negative' };
  }

  // Remove valid commas used for thousands / Indian grouping
  const cleaned = str.replace(/,/g, '');

  // Must contain only digits or digits with an optional single decimal dot
  if (!/^\d+(\.\d+)?$/.test(cleaned)) {
    return { ok: false, error: 'Amount contains invalid characters' };
  }

  const parts = cleaned.split('.');
  if (parts.length > 2 || (parts[1] && parts[1].length > 2)) {
    return { ok: false, error: 'Amount cannot have more than 2 decimal places' };
  }

  const rupeeStr = parts[0] || '0';
  const paiseStr = (parts[1] || '').padEnd(2, '0');

  const rupeePart = parseInt(rupeeStr, 10);
  const paisePart = parseInt(paiseStr, 10);

  if (isNaN(rupeePart) || isNaN(paisePart)) {
    return { ok: false, error: 'Invalid number' };
  }

  const totalPaise = rupeePart * 100 + paisePart;
  if (totalPaise <= 0) {
    return { ok: false, error: 'Amount must be greater than zero' };
  }

  if (!Number.isSafeInteger(totalPaise)) {
    return { ok: false, error: 'Amount is too large' };
  }

  return { ok: true, paise: totalPaise };
}

/**
 * Formats an integer paise amount into an Indian currency formatted string (e.g. "₹1,00,000.00").
 * Uses strictly integer mathematics to split rupees and paise.
 * 
 * @param {number} paise - Amount in integer paise.
 * @returns {string} Formatted Indian currency string.
 */
export function formatPaise(paise) {
  if (typeof paise !== 'number' || !Number.isFinite(paise)) {
    return '₹0.00';
  }

  const isNegative = paise < 0;
  const absPaise = Math.abs(Math.round(paise));
  const rupees = Math.floor(absPaise / 100);
  const remainder = absPaise % 100;
  const paiseStr = String(remainder).padStart(2, '0');

  const rupeeStr = String(rupees);
  let formattedRupees = '';

  if (rupeeStr.length <= 3) {
    formattedRupees = rupeeStr;
  } else {
    const last3 = rupeeStr.slice(-3);
    const remaining = rupeeStr.slice(0, -3);

    // Group remaining into pairs of 2 digits from right to left
    const parts = [];
    let i = remaining.length;
    while (i > 0) {
      const start = Math.max(0, i - 2);
      parts.unshift(remaining.slice(start, i));
      i = start;
    }
    formattedRupees = parts.join(',') + ',' + last3;
  }

  const sign = isNegative ? '-' : '';
  return `${sign}₹${formattedRupees}.${paiseStr}`;
}

