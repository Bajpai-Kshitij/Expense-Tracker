/**
 * Pattern compilation utility for brand and rule matching.
 * Supports "words" mode (pipe-separated substring words) and "regex" mode.
 * Safe against catastrophic backtracking: rejects patterns longer than 200 characters
 * and patterns containing nested quantifiers.
 */

// Heuristic for detecting nested quantifiers like (a+)+, (.*)*, (a*)+, (a+)*, ([a-z]+)+
const NESTED_QUANTIFIER_REGEX = /\([^)]*[+*?{][^)]*\)[+*?{]/;

function escapeRegexCharacters(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compiles a pattern string into a RegExp object.
 * 
 * @param {object} options
 * @param {string} options.pattern - Pattern expression.
 * @param {'words'|'regex'} [options.mode='words'] - Matching mode.
 * @returns {{ ok: true, regex: RegExp } | { ok: false, reason: string }}
 */
export function compilePattern(options) {
  try {
    const { pattern, mode = 'words' } = options || {};
    if (typeof pattern !== 'string') {
      return { ok: false, reason: 'Pattern must be a string' };
    }

    const trimmed = pattern.trim();
    if (trimmed.length === 0) {
      return { ok: false, reason: 'Pattern cannot be empty' };
    }

    if (trimmed.length > 200) {
      return { ok: false, reason: 'Pattern exceeds maximum length of 200 characters' };
    }

    if (mode === 'words') {
      // Split by pipe '|', trim each token, escape regex special characters
      const tokens = trimmed
        .split('|')
        .map((t) => t.trim())
        .filter((t) => t.length > 0);

      if (tokens.length === 0) {
        return { ok: false, reason: 'Words pattern contains no valid terms' };
      }

      const escapedTokens = tokens.map(escapeRegexCharacters);
      const combined = `(?:${escapedTokens.join('|')})`;
      const regex = new RegExp(combined, 'i');
      return { ok: true, regex };
    }

    if (mode === 'regex') {
      // Check for nested quantifiers that can cause exponential ReDoS
      if (NESTED_QUANTIFIER_REGEX.test(trimmed)) {
        return { ok: false, reason: 'Nested quantifiers are not permitted' };
      }

      try {
        const regex = new RegExp(trimmed, 'i');
        return { ok: true, regex };
      } catch (err) {
        return { ok: false, reason: `Invalid regular expression: ${err.message}` };
      }
    }

    return { ok: false, reason: `Unsupported pattern mode: ${mode}` };
  } catch (err) {
    return { ok: false, reason: `Unexpected error: ${err.message}` };
  }
}
