/**
 * Helper to extract the first alphanumeric token from a merchant string (lowercased).
 * 
 * @param {string} str
 * @returns {string}
 */
export function firstAlphaNumericToken(str) {
  if (!str) return '';
  const match = String(str).match(/[a-zA-Z0-9]+/);
  return match ? match[0].toLowerCase() : '';
}

/**
 * Searches for an original active debit expense to link a refund to.
 * 
 * Criteria:
 * - Direction is credit and kind is spend or fixed
 * - Candidate is active, direction debit, same accountId
 * - Within the previous 90 days (exp.date <= txn.date and diff <= 90 days)
 * - Amount >= refund amount
 * - Same brand (if both have brand), otherwise same first alphanumeric merchant token
 * - Exactly one candidate -> return { id, categoryId, brand }
 * - Zero or multiple candidates -> return null
 * 
 * @param {object} options
 * @param {object} options.txn - Incoming credit transaction
 * @param {Array<object>|object} options.expenses - Current expenses
 * @returns {{ id: string, categoryId: string|null, brand: string|null } | null}
 */
export function findRefundOriginal({ txn, expenses = [] }) {
  if (!txn || txn.direction !== 'credit' || (txn.kind !== 'spend' && txn.kind !== 'fixed')) {
    return null;
  }
  if (!txn.accountId || !txn.amountPaise || !txn.date) {
    return null;
  }

  const expList = Array.isArray(expenses)
    ? expenses
    : expenses && typeof expenses === 'object'
    ? Object.values(expenses)
    : [];

  const txnDateMs = Date.parse(txn.date);
  if (isNaN(txnDateMs)) return null;

  const txnBrand = txn.brand ? String(txn.brand).trim().toLowerCase() : null;
  const txnToken = firstAlphaNumericToken(txn.merchantRaw);

  const candidates = expList.filter((exp) => {
    if (!exp) return false;
    if (exp.deleted || exp.status === 'deleted') return false;
    if (exp.direction !== 'debit') return false;
    if (exp.accountId !== txn.accountId) return false;

    const expAmount = exp.amountPaise !== undefined ? exp.amountPaise : exp.amount_paise;
    if (typeof expAmount !== 'number' || expAmount < txn.amountPaise) return false;

    if (!exp.date) return false;
    const expDateMs = Date.parse(exp.date);
    if (isNaN(expDateMs)) return false;

    // Within previous 90 days (0 to 90 days before txn.date)
    const diffMs = txnDateMs - expDateMs;
    const diffDays = diffMs / 86400000;
    if (diffDays < 0 || diffDays > 90) return false;

    // Brand or first alphanumeric token match
    const expBrand = exp.brand ? String(exp.brand).trim().toLowerCase() : null;
    if (txnBrand && expBrand) {
      if (txnBrand !== expBrand) return false;
    } else {
      const expToken = firstAlphaNumericToken(exp.merchant_raw || exp.merchantRaw);
      if (!txnToken || !expToken || txnToken !== expToken) return false;
    }

    return true;
  });

  if (candidates.length === 1) {
    const orig = candidates[0];
    return {
      id: orig.id || orig.expenseId,
      categoryId: orig.category_id || orig.categoryId || null,
      brand: orig.brand || null,
    };
  }

  return null;
}

/**
 * Finds manual candidate expenses that might duplicate an imported transaction.
 * 
 * Criteria:
 * - Active expense
 * - source === 'manual'
 * - same accountId
 * - same amountPaise
 * - same direction
 * - date within 1 day (diff <= 1 day)
 * 
 * @param {object} options
 * @param {object} options.txn - Incoming parsed transaction
 * @param {Array<object>|object} options.expenses - Current expenses
 * @returns {string[]} Candidate expense IDs
 */
export function findManualCandidates({ txn, expenses = [] }) {
  if (!txn || !txn.accountId || !txn.amountPaise || !txn.date) {
    return [];
  }

  const expList = Array.isArray(expenses)
    ? expenses
    : expenses && typeof expenses === 'object'
    ? Object.values(expenses)
    : [];

  const txnDateMs = Date.parse(txn.date);
  if (isNaN(txnDateMs)) return [];

  const candidates = expList.filter((exp) => {
    if (!exp) return false;
    if (exp.deleted || exp.status === 'deleted') return false;
    if (exp.source !== 'manual') return false;
    if (exp.accountId !== txn.accountId) return false;
    if (exp.direction !== txn.direction) return false;

    const expAmount = exp.amountPaise !== undefined ? exp.amountPaise : exp.amount_paise;
    if (expAmount !== txn.amountPaise) return false;

    if (!exp.date) return false;
    const expDateMs = Date.parse(exp.date);
    if (isNaN(expDateMs)) return false;

    // Within 1 day
    const diffDays = Math.abs(txnDateMs - expDateMs) / 86400000;
    if (diffDays > 1.0001) return false;

    return true;
  });

  return candidates.map((c) => c.id || c.expenseId);
}

