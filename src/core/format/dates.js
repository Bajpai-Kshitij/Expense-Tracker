/**
 * Date helpers for Indian Standard Time (UTC+05:30) calculations, month ranges,
 * date range presets, and human-readable date display formatting.
 */

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const IST_OFFSET_MS = 19800000; // 5 hours 30 minutes in ms

function getClockMs(clock) {
  if (typeof clock === 'function') {
    const res = clock();
    return typeof res === 'number'
      ? res
      : (typeof res === 'string' ? Date.parse(res) : res.getTime());
  }
  if (typeof clock === 'number') return clock;
  if (typeof clock === 'string') return Date.parse(clock);
  if (clock instanceof Date) return clock.getTime();
  return Date.now();
}

/**
 * Returns today's date in IST formatted as YYYY-MM-DD.
 * 
 * @param {() => number|Date|string} [clock=() => Date.now()] - Injected clock.
 * @returns {string} Date string YYYY-MM-DD.
 */
export function getTodayIst(clock = () => Date.now()) {
  const ms = getClockMs(clock);
  const d = new Date(ms + IST_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns the date range for the current month in IST.
 * 
 * @param {() => number|Date|string} [clock=() => Date.now()] - Injected clock.
 * @returns {{ from: string, to: string }} Start and end date strings (YYYY-MM-DD).
 */
export function getThisMonthRange(clock = () => Date.now()) {
  const ms = getClockMs(clock);
  const d = new Date(ms + IST_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth(); // 0-based

  const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  return { from, to };
}

/**
 * Returns the date range for the previous month in IST.
 * 
 * @param {() => number|Date|string} [clock=() => Date.now()] - Injected clock.
 * @returns {{ from: string, to: string }} Start and end date strings (YYYY-MM-DD).
 */
export function getLastMonthRange(clock = () => Date.now()) {
  const ms = getClockMs(clock);
  const d = new Date(ms + IST_OFFSET_MS);
  let year = d.getUTCFullYear();
  let month = d.getUTCMonth() - 1;

  if (month < 0) {
    month = 11;
    year -= 1;
  }

  const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  return { from, to };
}

/**
 * Resolves date range bounds for standard period presets.
 * 
 * @param {'this_month'|'last_month'|'all_time'|'custom'|string} preset - Preset key.
 * @param {() => number|Date|string} [clock=() => Date.now()] - Injected clock.
 * @returns {{ from: string|null, to: string|null }} Date bounds.
 */
export function getDateRangePreset(preset, clock = () => Date.now()) {
  const normalized = String(preset || '').toLowerCase().replace(/\s+/g, '_');

  switch (normalized) {
    case 'this_month':
      return getThisMonthRange(clock);
    case 'last_month':
      return getLastMonthRange(clock);
    case 'all_time':
    case 'custom':
    case 'custom_range':
      return { from: null, to: null };
    default:
      return getThisMonthRange(clock);
  }
}

/**
 * Formats a YYYY-MM-DD or ISO date string for display (e.g. "30 Oct 2026").
 * 
 * @param {string} dateStr - Date string.
 * @returns {string} Formatted display date string.
 */
export function formatDateDisplay(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') {
    return '';
  }

  const datePart = dateStr.slice(0, 10);
  const parts = datePart.split('-');
  if (parts.length !== 3) {
    return dateStr;
  }

  const year = parts[0];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);

  if (isNaN(monthIdx) || monthIdx < 0 || monthIdx > 11 || isNaN(day)) {
    return dateStr;
  }

  return `${day} ${MONTH_NAMES[monthIdx]} ${year}`;
}

