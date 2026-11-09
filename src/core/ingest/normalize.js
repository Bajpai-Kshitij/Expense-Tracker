/**
 * Normalization utilities for SMS text, amounts, dates, and times.
 * Pure functions only; no external dependencies or locale functions.
 */

const MONTH_MAP = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Parses currency text to integer paise.
 * Handles "INR 5000.00", "Rs.14028", "1,00,000.00", "41,614.08", "210", "312.0", "Rs 2.00", trailing dots.
 * Integer maths only, returns null for garbage, negative or zero amounts.
 * 
 * @param {string} text 
 * @returns {number|null} Amount in paise, or null if invalid.
 */
export function parseAmountToPaise(text) {
  if (typeof text !== 'string') return null;

  let clean = text.trim();
  if (!clean) return null;

  // Strip leading currency codes/symbols
  clean = clean.replace(/^(?:INR|Rs\.?)\s*/i, '').trim();

  // Strip trailing periods if any (e.g. from sentence endings "210." or "500.00.")
  if (clean.endsWith('.')) {
    clean = clean.slice(0, -1).trim();
  }

  // Remove commas (thousands separators in Indian and Western numbering)
  clean = clean.replace(/,/g, '');

  // Must match integer or decimal with 1 or 2 fractional digits
  if (!/^\d+(?:\.\d{1,2})?$/.test(clean)) {
    return null;
  }

  const parts = clean.split('.');
  const rupees = parseInt(parts[0], 10);
  if (!Number.isSafeInteger(rupees)) return null;

  let paiseFraction = 0;
  if (parts.length === 2) {
    if (parts[1].length === 1) {
      paiseFraction = parseInt(parts[1], 10) * 10;
    } else if (parts[1].length === 2) {
      paiseFraction = parseInt(parts[1], 10);
    }
  }

  const totalPaise = rupees * 100 + paiseFraction;
  if (totalPaise <= 0 || !Number.isSafeInteger(totalPaise)) {
    return null;
  }

  return totalPaise;
}

/**
 * Validates whether year y is a leap year.
 */
function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
}

/**
 * Parses date tokens into canonical "YYYY-MM-DD" string.
 * Accepts dd-mm-yy, dd-mm-yyyy, dd/mm/yy, dd/mm/yyyy, dd-Mon-yy, dd-MON-yy, dd-Mon-yyyy.
 * Validates real calendar date (rejects 31-02, 29-02 on non-leap years).
 * Two-digit years mean 20yy.
 * 
 * @param {string} text 
 * @returns {string|null} "YYYY-MM-DD" or null.
 */
export function parseDateToken(text) {
  if (typeof text !== 'string') return null;

  const clean = text.trim().replace(/\.+$/, '').trim();
  const match = clean.match(/^(\d{1,2})[-/]([a-zA-Z]{3}|\d{1,2})[-/](\d{2}|\d{4})$/);
  if (!match) return null;

  const dayStr = match[1];
  const monthStr = match[2];
  const yearStr = match[3];

  let y = parseInt(yearStr, 10);
  if (yearStr.length === 2) {
    y = 2000 + y;
  }

  let m;
  if (/^\d+$/.test(monthStr)) {
    m = parseInt(monthStr, 10);
  } else {
    m = MONTH_MAP[monthStr.toLowerCase()];
    if (!m) return null;
  }

  if (m < 1 || m > 12) return null;

  const d = parseInt(dayStr, 10);
  if (d < 1) return null;

  // Validate maximum days in month
  let maxDays = 31;
  if (m === 4 || m === 6 || m === 9 || m === 11) {
    maxDays = 30;
  } else if (m === 2) {
    maxDays = isLeapYear(y) ? 29 : 28;
  }

  if (d > maxDays) return null;

  const mm = String(m).padStart(2, '0');
  const dd = String(d).padStart(2, '0');
  return `${y}-${mm}-${dd}`;
}

/**
 * Parses time token into canonical "HH:MM:SS" string.
 * Accepts HH:MM or HH:MM:SS.
 * 
 * @param {string} text 
 * @returns {string|null} "HH:MM:SS" or null.
 */
export function parseTimeToken(text) {
  if (typeof text !== 'string') return null;

  const clean = text.trim().replace(/\s*IST\.?$/i, '').trim();
  const match = clean.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return null;

  const h = parseInt(match[1], 10);
  const min = parseInt(match[2], 10);
  const sec = match[3] !== undefined ? parseInt(match[3], 10) : 0;

  if (h < 0 || h > 23 || min < 0 || min > 59 || sec < 0 || sec > 59) {
    return null;
  }

  const hh = String(h).padStart(2, '0');
  const mm = String(min).padStart(2, '0');
  const ss = String(sec).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** Parses a 12-hour time such as "09:15 PM" or "09:15:00 PM" into HH:MM:SS. */
export function parseTime12Token(text) {
  const m = String(text || '').trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)$/i);
  if (!m) return null;
  const hour = (Number(m[1]) % 12) + (/pm/i.test(m[4]) ? 12 : 0);
  return parseTimeToken(`${hour}:${m[2]}:${m[3] || '00'}`);
}

/** YYYY-MM-DD in IST for an epoch timestamp, for messages that give no date of their own. */
export function istDateFromMs(ms) {
  return new Date(ms + 19800000).toISOString().slice(0, 10);
}

/**
 * Converts date and time strings into ISO-8601 timestamp with +05:30 IST offset.
 * 
 * @param {string|null} date "YYYY-MM-DD"
 * @param {string|null} time "HH:MM:SS"
 * @returns {string|null}
 */
export function toTxnTs(date, time) {
  if (!date || !time) return null;
  return `${date}T${time}+05:30`;
}

/**
 * Prepares raw SMS body into trimmed lines and flattened single-space text.
 * 
 * @param {string} body 
 * @returns {{ lines: Array<string>, flat: string }}
 */
export function prepareBody(body) {
  if (typeof body !== 'string') {
    return { lines: [], flat: '' };
  }

  const rawLines = body.split(/\r\n|\r|\n/);
  const lines = rawLines
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const flat = lines.join(' ').replace(/\s+/g, ' ').trim();
  return { lines, flat };
}

/**
 * Checks if a merchant/payee name matches any household owner names.
 * Matching rules:
 * - case-insensitive
 * - spaces collapsed
 * - punctuation ignored
 * - match when equal, OR when one is a prefix of the other and the shorter has at least 8 characters.
 * 
 * @param {string} text 
 * @param {Array<string>|string} names 
 * @returns {boolean}
 */
export function isHouseholdName(text, names) {
  if (typeof text !== 'string' || !text.trim()) return false;
  if (!names) return false;

  const nameList = Array.isArray(names) ? names : [names];
  if (nameList.length === 0) return false;

  const clean = (s) => {
    if (typeof s !== 'string') return '';
    return s
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  };

  const cleanText = clean(text);
  if (!cleanText) return false;

  for (const raw of nameList) {
    const cleanCandidate = clean(raw);
    if (!cleanCandidate) continue;

    if (cleanText === cleanCandidate) {
      return true;
    }

    if (cleanText.startsWith(cleanCandidate) && cleanCandidate.length >= 8) {
      return true;
    }

    if (cleanCandidate.startsWith(cleanText) && cleanText.length >= 8) {
      return true;
    }
  }

  return false;
}


