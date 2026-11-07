/**
 * Matching engine for credit card statement lines with SMS and manual expenses.
 */

/**
 * Computes deterministic key for a statement line.
 * If line has refNo: "ref:" + refNo.
 * Otherwise: "st:" + accountId + "|" + paise + "|" + date + "|" + direction + "|" + normalizedMerchantToken + "|" + occurrence
 *
 * @param {object} line - Statement line
 * @param {string} accountId - Resolved account ID
 * @param {number} [occurrence=1] - 1-based index for identical lines in the same statement
 * @returns {string} Deduplication / linking key
 */
export function statementLineKey(line, accountId, occurrence = 1) {
  if (line.refNo) {
    return `ref:${line.refNo}`;
  }
  const tokenMatch = (line.merchantRaw || '').match(/[A-Za-z0-9]+/);
  const normalizedMerchantToken = tokenMatch ? tokenMatch[0].toUpperCase() : 'x';
  const paise = line.amountPaise;
  const date = line.date;
  const direction = line.direction;
  return `st:${accountId}|${paise}|${date}|${direction}|${normalizedMerchantToken}|${occurrence}`;
}

function daysDifference(d1, d2) {
  const t1 = Date.parse(d1);
  const t2 = Date.parse(d2);
  if (isNaN(t1) || isNaN(t2)) return Infinity;
  return Math.abs(t1 - t2) / 86400000;
}

function getAlphanumericTokens(str) {
  if (!str || typeof str !== 'string') return new Set();
  const words = str.toUpperCase().match(/[A-Za-z0-9]+/g) || [];
  return new Set(words);
}

function countSharedTokens(tokensA, tokensB) {
  let count = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) count++;
  }
  return count;
}

/**
 * Searches for matching SMS-sourced expenses for a statement line.
 * Criteria:
 * - Active expense (not deleted)
 * - source === 'sms'
 * - same accountId, direction, amountPaise
 * - date within 3 days
 * - no statementKey or statement_key yet
 * - not in usedExpenseIds
 * Scored by merchant similarity (shared alphanumeric token).
 *
 * @param {object} line - StatementLine
 * @param {string} accountId - Target account ID
 * @param {object|Array} expenses - Current expenses map or list
 * @param {Set<string>} [usedExpenseIds=new Set()] - Set of already paired expense IDs in this import
 * @returns {{ status: 'one', expenseId: string } | { status: 'many', candidates: Array<object> } | { status: 'none' }}
 */
export function findSmsMatch(line, accountId, expenses, usedExpenseIds = new Set(), lineContext = {}) {
  const lineTokens = getAlphanumericTokens(line.merchantRaw);
  const allExp = Array.isArray(expenses) ? expenses : Object.values(expenses || {});

  const candidates = allExp.filter((exp) => {
    if (!exp || exp.deleted || exp.status === 'deleted') return false;
    if (exp.source !== 'sms') return false;
    if (exp.accountId !== accountId) return false;
    if (exp.direction !== line.direction) return false;
    if (exp.amountPaise !== line.amountPaise) return false;
    if (exp.statementKey || exp.statement_key) return false;
    if (usedExpenseIds.has(exp.id)) return false;

    const diffDays = daysDifference(line.date, exp.date);
    return diffDays <= 3.0001;
  });

  if (candidates.length === 0) {
    return { status: 'none' };
  }

  // Score by shared alphanumeric merchant tokens
  const scored = candidates.map((c) => {
    const cTokens = getAlphanumericTokens(c.merchantRaw || c.brand || '');
    return {
      candidate: c,
      score: countSharedTokens(lineTokens, cTokens),
      dateDiff: daysDifference(line.date, c.date),
    };
  });

  // Sort by highest score first, then by earliest date / closest date
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.dateDiff - b.dateDiff;
  });

  const maxScore = scored[0].score;
  const topCandidates = scored
    .filter((s) => (maxScore > 0 ? s.score === maxScore : true))
    .map((s) => s.candidate);

  if (topCandidates.length === 1) {
    return { status: 'one', expenseId: topCandidates[0].id };
  }

  // If several SMS expenses are equally good for several statement lines (two identical purchases within window),
  // pair them in date order, one to one, and never use the same expense twice in one import.
  const totalIdentical = lineContext?.totalIdenticalCount || 1;
  const alreadyPaired = lineContext?.usedCount || 0;
  if (totalIdentical > 1 && totalIdentical === topCandidates.length + alreadyPaired) {
    topCandidates.sort((a, b) => {
      const diff = (Date.parse(a.date) || 0) - (Date.parse(b.date) || 0);
      if (diff !== 0) return diff;
      return (a.id || '').localeCompare(b.id || '');
    });
    return { status: 'one', expenseId: topCandidates[0].id };
  }

  return { status: 'many', candidates: topCandidates };
}

/**
 * Checks for duplicate manual expenses (source === 'manual').
 *
 * @param {object} line - StatementLine
 * @param {string} accountId - Target account ID
 * @param {object|Array} expenses - Current expenses map or list
 * @returns {Array<object>|null}
 */
export function findManualMatch(line, accountId, expenses) {
  const allExp = Array.isArray(expenses) ? expenses : Object.values(expenses || {});

  const candidates = allExp.filter((exp) => {
    if (!exp || exp.deleted || exp.status === 'deleted') return false;
    if (exp.source !== 'manual') return false;
    if (exp.accountId !== accountId) return false;
    if (exp.direction !== line.direction) return false;
    if (exp.amountPaise !== line.amountPaise) return false;

    const diffDays = daysDifference(line.date, exp.date);
    return diffDays <= 3.0001;
  });

  return candidates.length > 0 ? candidates : null;
}

/**
 * Mirrored rule for SMS import to find matching statement-sourced expenses.
 * Criteria:
 * - Active expense
 * - source === 'statement'
 * - same accountId, direction, amountPaise
 * - within 3 days
 * - no smsKey yet and no sms link in linkedKeys
 *
 * @param {object} txn - SMS transaction
 * @param {string} accountId - Resolved account ID
 * @param {object|Array} expenses - Current expenses map or list
 * @returns {{ status: 'one', expenseId: string } | { status: 'many', candidates: Array<object> } | { status: 'none' }}
 */
export function findStatementMatch(txn, accountId, expenses) {
  const txnTokens = getAlphanumericTokens(txn.merchantRaw);
  const allExp = Array.isArray(expenses) ? expenses : Object.values(expenses || {});

  const candidates = allExp.filter((exp) => {
    if (!exp || exp.deleted || exp.status === 'deleted') return false;
    if (exp.source !== 'statement') return false;
    if (exp.accountId !== accountId) return false;
    if (exp.direction !== txn.direction) return false;
    if (exp.amountPaise !== txn.amountPaise) return false;
    if (exp.smsKey) return false;

    if (exp.linkedKeys) {
      for (const k of exp.linkedKeys) {
        if (typeof k === 'string' && (k.startsWith('sms:') || k.startsWith('pay_') || k.startsWith('rf_'))) {
          return false;
        }
      }
    }

    const diffDays = daysDifference(exp.date, txn.date);
    return diffDays <= 3.0001;
  });

  if (candidates.length === 0) {
    return { status: 'none' };
  }

  const scored = candidates.map((c) => {
    const cTokens = getAlphanumericTokens(c.merchantRaw || c.brand || '');
    return {
      candidate: c,
      score: countSharedTokens(txnTokens, cTokens),
      dateDiff: daysDifference(txn.date, c.date),
    };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.dateDiff - b.dateDiff;
  });

  const maxScore = scored[0].score;
  const topCandidates = scored
    .filter((s) => (maxScore > 0 ? s.score === maxScore : true))
    .map((s) => s.candidate);

  if (topCandidates.length === 1) {
    return { status: 'one', expenseId: topCandidates[0].id };
  }

  return { status: 'many', candidates: topCandidates };
}
