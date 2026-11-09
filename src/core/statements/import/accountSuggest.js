const norm = (v) => String(v || '').trim().toLowerCase();

function allDigits(acc) {
  const own = [acc.lastDigits, acc.digits].filter(Boolean).map((d) => ({ issuer: acc.issuer, digits: d }));
  return [...own, ...(Array.isArray(acc.aliases) ? acc.aliases : [])];
}

function isActive(acc) {
  return acc && acc.archived !== 1 && acc.archived !== true;
}

/**
 * Suggests the account for a statement from its issuer and card ending. Never picks one by default:
 * accountId is set only when exactly one account matches issuer and last 3 digits.
 *
 * @param {{ issuer?: string, digits?: string }} detected
 * @param {Array<object>} accounts
 * @param {string} [chosenId] - The account the user selected, for the mismatch check.
 * @returns {{ accountId: string|null, candidates: Array<object>, issuerMismatch: boolean }}
 */
export function suggestStatementAccount(detected = {}, accounts = [], chosenId = '') {
  const issuer = norm(detected.issuer);
  const suffix = String(detected.digits || '').slice(-3);
  const active = accounts.filter(isActive);

  const matches = active.filter((acc) =>
    allDigits(acc).some((a) => norm(a.issuer || acc.issuer) === issuer && suffix.length === 3 && String(a.digits).slice(-3) === suffix)
  );
  const candidates = matches.length > 0 ? matches : active.filter((acc) => norm(acc.issuer) === issuer);
  const chosen = accounts.find((a) => (a.id || a.accountId) === chosenId);

  return {
    accountId: matches.length === 1 ? matches[0].id || matches[0].accountId : null,
    candidates,
    issuerMismatch: Boolean(chosen && issuer && norm(chosen.issuer) && norm(chosen.issuer) !== issuer),
  };
}

/** True when the account already knows this statement's card ending. */
export function accountHasEnding(account, detected = {}) {
  const suffix = String(detected.digits || '').slice(-3);
  return allDigits(account).some((a) => norm(a.issuer || account.issuer) === norm(detected.issuer) && String(a.digits).slice(-3) === suffix);
}

/** Returns the account with the alias added, or null when it already has it. */
export function addAccountAlias(account, detected) {
  if (accountHasEnding(account, detected)) return null;
  const aliases = Array.isArray(account.aliases) ? account.aliases : [];
  return { ...account, aliases: [...aliases, { issuer: detected.issuer, digits: detected.digits }] };
}
