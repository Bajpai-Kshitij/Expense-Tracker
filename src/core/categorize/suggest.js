/**
 * Rule suggestion helper.
 * Derives a clean, uppercase 1 or 2 word substring pattern from merchant names
 * by stripping store codes, digits, order IDs, payment handles, and punctuation.
 */

const NOISE_WORDS = new Set([
  'pvt',
  'ltd',
  'private',
  'limited',
  'order',
  'pos',
  'corp',
  'inc',
]);

const BANK_HANDLES = new Set([
  'hdfcbank',
  'icicibank',
  'sbibank',
  'axisbank',
  'kotakbank',
  'yesbank',
  'payu',
  'pty',
  'upi',
  'okhdfcbank',
  'okaxis',
  'okicici',
  'oksbi',
]);

/**
 * Suggests a rule pattern for a given raw merchant name.
 * 
 * @param {string} merchantRaw - Raw merchant string.
 * @returns {{ pattern: string, mode: 'words' } | null} Suggested rule or null if unusable.
 */
export function suggestRule(merchantRaw) {
  if (!merchantRaw || typeof merchantRaw !== 'string') {
    return null;
  }

  // Replace punctuation and separators with spaces
  const normalized = merchantRaw.replace(/[.*@\-_/#,;:+=\\()[\]{}!?~`'"<>|]/g, ' ');
  const rawTokens = normalized.split(/\s+/).filter(Boolean);

  const cleanTokens = [];
  for (const token of rawTokens) {
    // Strip trailing periods or commas
    const word = token.replace(/^[^\w]+|[^\w]+$/g, '');
    if (!word) continue;

    // Reject tokens containing digits
    if (/\d/.test(word)) continue;

    const lower = word.toLowerCase();
    if (NOISE_WORDS.has(lower) || BANK_HANDLES.has(lower)) {
      continue;
    }

    cleanTokens.push(word.toUpperCase());
  }

  if (cleanTokens.length === 0) {
    return null;
  }

  // Keep first 1 or 2 meaningful words
  const wordsToKeep = cleanTokens.slice(0, 2);
  const pattern = wordsToKeep.join(' ');

  if (!pattern || pattern.length === 0) {
    return null;
  }

  return {
    pattern,
    mode: 'words',
  };
}

