/**
 * Pure helper for parsing household owner names.
 * Allows multiple names separated by commas, newlines, or carriage returns.
 * Trims extra whitespace, removes empty entries, and deduplicates.
 * 
 * @param {string|string[]} input
 * @returns {string[]} Clean array of unique names
 */
export function parseHouseholdNames(input) {
  if (!input) return [];

  let rawList = [];
  if (Array.isArray(input)) {
    rawList = input;
  } else if (typeof input === 'string') {
    rawList = input.split(/[,\r\n]+/);
  } else {
    return [];
  }

  const result = [];
  const seen = new Set();

  for (const item of rawList) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (!seen.has(lower)) {
      seen.add(lower);
      result.push(trimmed);
    }
  }

  return result;
}
