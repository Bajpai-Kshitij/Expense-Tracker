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
    if (!acc) return false;

    // 1. Primary account matching
    if (acc.issuer && acc.lastDigits) {
      const accIssuer = String(acc.issuer).trim().toLowerCase();
      const accDigitsStr = String(acc.lastDigits).trim();
      if (accDigitsStr.length >= 3) {
        const accSuffix = accDigitsStr.slice(-3);
        if (accIssuer === targetIssuer && accSuffix === targetSuffix) {
          return true;
        }
      }
    }

    // 2. Alias matching
    if (Array.isArray(acc.aliases)) {
      for (const alias of acc.aliases) {
        if (!alias || !alias.issuer || !alias.digits) continue;
        const aliasIssuer = String(alias.issuer).trim().toLowerCase();
        const aliasDigitsStr = String(alias.digits).trim();
        if (aliasDigitsStr.length >= 3) {
          const aliasSuffix = aliasDigitsStr.slice(-3);
          if (aliasIssuer === targetIssuer && aliasSuffix === targetSuffix) {
            return true;
          }
        }
      }
    }

    return false;
  });

  const uniqueCandidateIds = Array.from(
    new Set(candidates.map((c) => c.id || c.accountId).filter(Boolean))
  );

  if (uniqueCandidateIds.length === 1) {
    return uniqueCandidateIds[0];
  }

  return null;
}

