/**
 * Matches an issuer and digit string to an account ID from accounts list.
 * 
 * Rules:
 * - Match on issuer (case-insensitive) plus the LAST 3 DIGITS (compare suffixes).
 * - Digits in message or account may be 3 or 4 digits long; compare last 3 characters.
 * - If more than one candidate matches -> return null (ambiguous).
 * - Never match on digits alone without issuer.
 * - Missing issuer or digits -> return null.
 * 
 * @param {string} issuer e.g. "axis" or "Axis"
 * @param {string|number} digits e.g. "4230" or "7693" or "476"
 * @param {Array<object>|object} accounts Account objects list or map
 * @returns {string|null} accountId or null
 */
export function matchAccount(issuer, digits, accounts) {
  if (!issuer || !digits) return null;

  const targetIssuer = String(issuer).trim().toLowerCase();
  const targetDigitsStr = String(digits).trim();
  if (targetDigitsStr.length < 3) return null;
  const targetSuffix = targetDigitsStr.slice(-3);

  const accList = Array.isArray(accounts)
    ? accounts
    : accounts && typeof accounts === 'object'
    ? Object.values(accounts)
    : [];

  const candidates = accList.filter((acc) => {
    if (!acc || !acc.issuer || !acc.lastDigits) return false;
    const accIssuer = String(acc.issuer).trim().toLowerCase();
    if (accIssuer !== targetIssuer) return false;

    const accDigitsStr = String(acc.lastDigits).trim();
    if (accDigitsStr.length < 3) return false;
    const accSuffix = accDigitsStr.slice(-3);

    return accSuffix === targetSuffix;
  });

  if (candidates.length === 1) {
    return candidates[0].id || null;
  }

  return null;
}

