import { parseSms } from './index.js';

/**
 * Sanitizes an allowlist array by removing null, undefined, non-strings, and empty strings.
 * 
 * @param {Array<any>} allowlist
 * @returns {string[]} Sanitized array of non-empty strings
 */
export function sanitizeAllowlist(allowlist) {
  if (!allowlist || !Array.isArray(allowlist)) return [];
  const sanitized = [];
  const seen = new Set();
  for (const item of allowlist) {
    if (item !== null && item !== undefined && typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed.length > 0 && !seen.has(trimmed.toLowerCase())) {
        seen.add(trimmed.toLowerCase());
        sanitized.push(trimmed);
      }
    }
  }
  return sanitized;
}

/**
 * Aggregates a list of SMS messages by sender address with total and financial counts.
 * Financial count is the number of messages whose parseSms status is not "unknown".
 * Results are sorted by financial count descending, then total descending, then address ascending.
 * 
 * @param {Array<{ address: string, body: string, date: number }>} messages
 * @param {object} [ctx]
 * @returns {Array<{ address: string, sender: string, total: number, totalCount: number, financial: number, financialCount: number }>}
 */
export function listSenders(messages = [], ctx = {}) {
  const map = new Map();
  let emptySenderCount = 0;

  for (const msg of messages) {
    if (!msg || !msg.address || typeof msg.address !== 'string' || msg.address.trim().length === 0) {
      emptySenderCount += 1;
      continue;
    }
    const addr = msg.address.trim();
    if (!map.has(addr)) {
      map.set(addr, {
        address: addr,
        sender: addr,
        total: 0,
        totalCount: 0,
        financial: 0,
        financialCount: 0,
      });
    }
    const record = map.get(addr);
    record.total += 1;
    record.totalCount += 1;

    try {
      const parsed = parseSms(msg, ctx);
      if (parsed && parsed.status !== 'unknown') {
        record.financial += 1;
        record.financialCount += 1;
      }
    } catch {
      // Ignored during sender discovery
    }
  }

  const list = Array.from(map.values());
  list.sort((a, b) => {
    if (b.financial !== a.financial) {
      return b.financial - a.financial;
    }
    if (b.total !== a.total) {
      return b.total - a.total;
    }
    return a.address.localeCompare(b.address);
  });

  list.emptySenderCount = emptySenderCount;
  return list;
}

/**
 * Checks if a sender address is present in the allowlist.
 * 
 * @param {string} address
 * @param {string[]} allowlist
 * @returns {boolean}
 */
export function isAllowed(address, allowlist) {
  if (!allowlist || !Array.isArray(allowlist)) return false;
  if (!address || typeof address !== 'string') return false;
  const target = address.trim().toLowerCase();
  return allowlist.some(
    (item) => typeof item === 'string' && item.trim().length > 0 && item.trim().toLowerCase() === target
  );
}

/**
 * Validates that the allowlist is configured and non-empty.
 * Throws an Error with code NO_SENDERS_CONFIGURED if empty or missing.
 * 
 * @param {string[]} allowlist
 */
export function assertSendersConfigured(allowlist) {
  const sanitized = sanitizeAllowlist(allowlist);
  if (sanitized.length === 0) {
    const error = new Error('No SMS senders configured');
    error.code = 'NO_SENDERS_CONFIGURED';
    throw error;
  }
}
