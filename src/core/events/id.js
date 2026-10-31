import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * Computes deterministic expense ID from a dedupe key.
 * Format: "e_" + first 16 hex chars of SHA-256(dedupeKey).
 * 
 * @param {string} key - Deduplication key string.
 * @returns {string} Deterministic expense ID.
 */
export function expenseIdFromDedupeKey(key) {
  if (typeof key !== 'string' || key.length === 0) {
    throw new TypeError(`Expected non-empty string dedupeKey, received: ${key}`);
  }
  const hashBytes = sha256(utf8ToBytes(key));
  const hex = bytesToHex(hashBytes);
  return `e_${hex.slice(0, 16)}`;
}

/**
 * Generates a random expense ID for manually entered expenses.
 * Format: "e_" + 16 random hex characters.
 * 
 * @param {() => number} [random=Math.random] - Optional injected random number generator.
 * @returns {string} Random expense ID.
 */
export function generateManualExpenseId(random = Math.random) {
  const hexChars = Array.from({ length: 16 }, () =>
    Math.floor(random() * 16).toString(16)
  ).join('');
  return `e_${hexChars}`;
}

/**
 * Generates an event ID with a sortable time component and random characters.
 * Format: "ev_" + sortable time part + random part.
 * 
 * @param {number} [timeMs=Date.now()] - Timestamp in epoch milliseconds.
 * @param {() => number} [random=Math.random] - Injected random generator.
 * @returns {string} Sortable event ID.
 */
export function generateEventId(timeMs = Date.now(), random = Math.random) {
  // 9-digit base36 represents epoch ms monotonically and sortably
  const timePart = timeMs.toString(36).padStart(9, '0');
  const randomPart = Array.from({ length: 7 }, () =>
    Math.floor(random() * 36).toString(36)
  ).join('');
  return `ev_${timePart}${randomPart}`;
}

