import { sha256Hex } from '../ingest/registry.js';
import { normalizeName, findSamePayee } from '../ingest/userIgnore.js';

/** Returns the UPI id in the text, or null. */
export function extractUpiId(text) {
  const m = String(text || '').match(/[a-z0-9._-]+@[a-z][a-z0-9.]*/i);
  return m ? m[0] : null;
}

function exactPattern(merchant) {
  const parts = normalizeName(merchant).split(' ').map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return `^${parts.join('\\s+')}$`;
}

/**
 * Brand entry that names one exact payee. Runs before starter brands (priority -100),
 * and goes through the same brand matching as every other import.
 */
export function buildPayeeBrand({ merchant, name, categoryId = null }) {
  const key = normalizeName(merchant);
  const id = `payee_${sha256Hex(`payee|${key}`).slice(0, 12)}`;
  return { id, name: String(name).trim(), pattern: exactPattern(merchant), mode: 'regex', categoryId, kind: null, note: 'Payee name', priority: -100, active: true };
}

/** expense.updated events that give past expenses of this payee the saved name. */
export function planPayeeRename(expenses, merchant, name) {
  return findSamePayee(expenses, merchant)
    .filter((e) => e.brand !== name)
    .map((e) => ({ type: 'expense.updated', data: { expenseId: e.id, patch: { brand: name } } }));
}

export function expenseTitle(exp = {}) {
  return exp.brand || exp.merchant_raw || exp.note || 'Expense';
}
