/**
 * Validates account form values.
 *
 * Validation rules:
 * - name: required, non-empty string.
 * - owner: must be 'Me', 'Wife', or 'Joint'.
 * - type: must be 'card', 'bank', or 'cash'.
 * - digits: 3 or 4 digits, or empty for cash.
 * - duplicate check: no existing active account with the same issuer and last-3-digits
 *   unless editing the same account.
 *
 * @param {object} values - { name, owner, type, issuer, digits }
 * @param {Array<object>|object} [existingAccounts=[]] - Existing accounts list or map
 * @param {string|null} [currentId=null] - ID of account being edited, if any
 * @returns {{ ok: boolean, errors: object, value: object }}
 */
export function validateAccountForm(values = {}, existingAccounts = [], currentId = null) {
  const errors = {};

  // Extract values
  const name = typeof values.name === 'string' ? values.name.trim() : '';
  const owner = values.owner || 'Me';
  const type = values.type || 'card';
  const issuer = typeof values.issuer === 'string' ? values.issuer.trim() : '';
  const rawDigits = values.digits !== undefined && values.digits !== null ? String(values.digits).trim() : '';

  // Name validation
  if (!name) {
    errors.name = 'Account name is required';
  }

  // Owner validation
  const validOwners = ['Me', 'Wife', 'Joint'];
  if (!validOwners.includes(owner)) {
    errors.owner = 'Owner must be Me, Wife, or Joint';
  }

  // Type validation
  const validTypes = ['card', 'bank', 'cash'];
  if (!validTypes.includes(type)) {
    errors.type = 'Type must be card, bank, or cash';
  }

  // Digits validation
  if (type === 'cash') {
    if (rawDigits && !/^\d{3,4}$/.test(rawDigits)) {
      errors.digits = 'Digits must be 3 or 4 numbers, or empty for cash';
    }
  } else {
    if (!rawDigits || !/^\d{3,4}$/.test(rawDigits)) {
      errors.digits = 'Digits must be 3 or 4 numbers';
    }
  }

  // Duplicate check on issuer + last-3-digits
  if (!errors.digits && issuer && rawDigits && rawDigits.length >= 3) {
    const accList = Array.isArray(existingAccounts)
      ? existingAccounts
      : existingAccounts && typeof existingAccounts === 'object'
      ? Object.values(existingAccounts)
      : [];

    const targetSuffix = rawDigits.slice(-3);
    const targetIssuer = issuer.toLowerCase();

    for (const acc of accList) {
      if (!acc) continue;
      const accId = acc.id || acc.accountId;
      if (currentId && accId === currentId) {
        continue;
      }
      // Ignore archived accounts for duplicate checking
      if (acc.archived === 1 || acc.archived === true) {
        continue;
      }

      const accIssuer = String(acc.issuer || '').trim().toLowerCase();
      const accDigits = String(acc.digits || acc.lastDigits || '').trim();

      if (accIssuer === targetIssuer && accDigits.length >= 3) {
        if (accDigits.slice(-3) === targetSuffix) {
          errors.digits = 'An account with this issuer and digits already exists';
          break;
        }
      }
    }
  }

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value: {
      name,
      owner,
      type,
      issuer: issuer || null,
      digits: rawDigits || null,
    },
  };
}

/**
 * Builds payload for account.upserted event.
 * Keeps unknown extra fields and existing aliases.
 *
 * @param {object} value - Validated form values
 * @param {object|null} [existing=null] - Existing account object if editing
 * @returns {object} Event data for account.upserted
 */
export function buildAccountUpsert(value, existing = null) {
  const id = existing?.id || existing?.accountId || 'acc_' + Math.random().toString(36).slice(2, 10);
  const existingAliases = Array.isArray(existing?.aliases) ? existing.aliases : [];

  return {
    ...existing,
    id,
    accountId: id,
    name: value.name,
    owner: value.owner,
    type: value.type,
    issuer: value.issuer || null,
    digits: value.digits || null,
    lastDigits: value.digits || null,
    aliases: existingAliases,
    archived: existing?.archived ? 1 : 0,
  };
}

/**
 * Builds payload for archiving an account via account.upserted.
 *
 * @param {object} existing - Existing account object
 * @returns {object} Event data
 */
export function buildArchive(existing) {
  const id = existing?.id || existing?.accountId;
  return {
    ...existing,
    id,
    accountId: id,
    archived: 1,
  };
}

/**
 * Builds payload for restoring an archived account via account.upserted.
 *
 * @param {object} existing - Existing account object
 * @returns {object} Event data
 */
export function buildRestore(existing) {
  const id = existing?.id || existing?.accountId;
  return {
    ...existing,
    id,
    accountId: id,
    archived: 0,
  };
}

