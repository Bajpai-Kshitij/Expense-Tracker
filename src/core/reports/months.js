/**
 * Pure date and month utilities for reports.
 * Uses IST (Asia/Kolkata, UTC+5:30) for current day/month calculations.
 */

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * Returns the number of days in a given year and month.
 * @param {number} year
 * @param {number} monthIndex 0-indexed (0 = Jan, 1 = Feb, ...)
 * @returns {number}
 */
export function getDaysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Computes the date range and day count for a given "YYYY-MM" month string.
 * @param {string} ym e.g. "2026-10"
 * @returns {{ from: string, to: string, days: number }}
 */
export function monthRange(ym) {
  if (!ym || typeof ym !== 'string' || !/^\d{4}-\d{2}$/.test(ym)) {
    throw new Error(`Invalid month format "${ym}", expected "YYYY-MM"`);
  }
  const [yearStr, monthStr] = ym.split('-');
  const year = parseInt(yearStr, 10);
  const monthIndex = parseInt(monthStr, 10) - 1;

  const days = getDaysInMonth(year, monthIndex);
  const from = `${ym}-01`;
  const to = `${ym}-${String(days).padStart(2, '0')}`;

  return { from, to, days };
}

/**
 * Returns previous month in "YYYY-MM" format.
 * @param {string} ym
 * @returns {string}
 */
export function prevMonth(ym) {
  const [yearStr, monthStr] = ym.split('-');
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStr, 10) - 1; // 1-indexed minus 1 = 0-indexed
  if (month === 0) {
    month = 12;
    year -= 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Returns next month in "YYYY-MM" format.
 * @param {string} ym
 * @returns {string}
 */
export function nextMonth(ym) {
  const [yearStr, monthStr] = ym.split('-');
  let year = parseInt(yearStr, 10);
  let month = parseInt(monthStr, 10) + 1;
  if (month === 13) {
    month = 1;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Returns an array of the last N months up to and including ym, oldest first.
 * @param {string} ym
 * @param {number} n
 * @returns {string[]}
 */
export function lastNMonths(ym, n = 6) {
  const result = [];
  let curr = ym;
  for (let i = 0; i < n; i++) {
    result.unshift(curr);
    curr = prevMonth(curr);
  }
  return result;
}

/**
 * Returns current month in IST (Asia/Kolkata) as "YYYY-MM".
 * @param {Date|number} [now=new Date()]
 * @returns {string}
 */
export function currentMonthIST(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  // IST offset is UTC+5:30 = 330 minutes
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const istDate = new Date(utc + 330 * 60000);

  const year = istDate.getFullYear();
  const month = String(istDate.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * Returns today's day of month in IST (1..31).
 * @param {Date|number} [now=new Date()]
 * @returns {number}
 */
export function currentDayIST(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  const utc = date.getTime() + date.getTimezoneOffset() * 60000;
  const istDate = new Date(utc + 330 * 60000);
  return istDate.getDate();
}

/**
 * Returns whether ym is strictly in the future compared to current IST month.
 * @param {string} ym
 * @param {Date|number} [now=new Date()]
 * @returns {boolean}
 */
export function isFutureMonth(ym, now = new Date()) {
  const curr = currentMonthIST(now);
  return ym > curr;
}

/**
 * Formats "YYYY-MM" to "Mon YYYY", e.g. "2026-10" -> "Oct 2026".
 * @param {string} ym
 * @returns {string}
 */
export function formatMonthLabel(ym) {
  if (!ym || typeof ym !== 'string' || !/^\d{4}-\d{2}$/.test(ym)) {
    return ym || '';
  }
  const [yearStr, monthStr] = ym.split('-');
  const monthIndex = parseInt(monthStr, 10) - 1;
  const monthName = MONTH_NAMES[monthIndex] || monthStr;
  return `${monthName} ${yearStr}`;
}

