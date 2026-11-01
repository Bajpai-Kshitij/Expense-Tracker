/**
 * Dedupe key formatting helpers for financial transactions.
 */

/**
 * Returns accountKey: either the resolved accountId, or "unk-<issuer>-<digits>".
 * 
 * @param {string|null} accountId 
 * @param {string} issuer 
 * @param {string} digits 
 * @returns {string}
 */
export function formatAccountKey(accountId, issuer, digits) {
  if (accountId) return accountId;
  const iss = String(issuer || 'unknown').toLowerCase();
  const dig = String(digits || '0000');
  return `unk-${iss}-${dig}`;
}

/**
 * Formats date and optional time into compact digits: YYYYMMDD or YYYYMMDDHHMMSS.
 * 
 * @param {string} date "YYYY-MM-DD"
 * @param {string|null} [time] "HH:MM:SS"
 * @returns {string}
 */
export function formatCompactDateTime(date, time) {
  const d = String(date || '').replace(/[-/]/g, '');
  if (!time) return d;
  const t = String(time).replace(/:/g, '');
  return `${d}${t}`;
}

