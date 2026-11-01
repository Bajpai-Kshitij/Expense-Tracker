import { parseRupees } from '../format/money.js';
import { generateManualExpenseId } from '../events/id.js';
import { categorize } from '../categorize/categorize.js';

const VALID_DIRECTIONS = new Set(['debit', 'credit']);
const VALID_KINDS = new Set(['spend', 'transfer', 'income', 'fixed']);
const VALID_MODES = new Set(['card', 'upi', 'cash', 'netbanking', 'other']);

/**
 * Validates expense form inputs.
 * 
 * @param {object} form - Form field values.
 * @returns {{ ok: boolean, errors: Record<string, string>, value: object }}
 */
export function validateExpenseForm(form = {}) {
  const errors = {};
  const value = {};

  // 1. Amount validation
  const amountParsed = parseRupees(form.amount);
  if (!amountParsed.ok) {
    errors.amount = amountParsed.error;
  } else {
    value.amount_paise = amountParsed.paise;
  }

  // 2. Date validation (YYYY-MM-DD)
  const dateStr = String(form.date || '').trim();
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    errors.date = 'Valid date (YYYY-MM-DD) is required';
  } else {
    value.date = dateStr;
  }

  // 3. Direction
  const direction = String(form.direction || 'debit').toLowerCase();
  value.direction = VALID_DIRECTIONS.has(direction) ? direction : 'debit';

  // 4. Kind
  const kind = String(form.kind || 'spend').toLowerCase();
  value.kind = VALID_KINDS.has(kind) ? kind : 'spend';

  // 5. Category ID (null for Uncategorized)
  const cat = form.categoryId !== undefined ? form.categoryId : form.category_id;
  if (!cat || cat === '__uncategorized__' || cat === 'null' || cat === 'Uncategorized') {
    value.category_id = null;
  } else {
    value.category_id = String(cat).trim() || null;
  }

  // 6. Account ID
  const acc = form.accountId !== undefined ? form.accountId : form.account_id;
  value.account_id = acc ? String(acc).trim() : null;

  // 7. Mode
  const mode = String(form.mode || 'card').toLowerCase();
  value.mode = VALID_MODES.has(mode) ? mode : 'card';

  // 8. Merchant
  const merchant = form.merchant !== undefined ? form.merchant : form.merchant_raw;
  value.merchant_raw = merchant ? String(merchant).trim() : null;

  // 9. Note
  value.note = form.note ? String(form.note).trim() : null;

  return {
    ok: Object.keys(errors).length === 0,
    errors,
    value,
  };
}

/**
 * Builds data object for expense.created event from validated form values.
 * When category is Uncategorized (null), calls categorize to auto-populate
 * brand, categoryId (unlocked), and kind.
 * 
 * @param {object} value - Validated form values.
 * @param {object} [options]
 * @param {string} [options.deviceId] - Device ID.
 * @param {() => number} [options.random=Math.random] - Random generator.
 * @param {() => number|string|Date} [options.now=() => Date.now()] - Clock.
 * @param {object[]|object} [options.brands=[]] - Active brands list or map.
 * @param {object[]|object} [options.rules=[]] - Active rules list or map.
 * @param {object[]|object} [options.accounts={}] - Accounts context.
 * @param {object[]|object} [options.categories={}] - Categories context.
 * @returns {object} Payload for expense.created event.
 */
export function buildCreateData(value, {
  deviceId,
  random = Math.random,
  now = () => Date.now(),
  brands = [],
  rules = [],
  accounts = {},
  categories = {},
} = {}) {
  const expenseId = generateManualExpenseId(random);
  const nowVal = typeof now === 'function' ? now() : Date.now();
  const nowIso = typeof nowVal === 'string' ? nowVal : new Date(nowVal).toISOString();

  let categoryId = value.category_id !== undefined ? value.category_id : (value.categoryId || null);
  let categoryLocked = value.category_locked !== undefined ? (value.category_locked ? 1 : 0) : (categoryId ? 1 : 0);
  let brand = value.brand || null;
  let kind = value.kind || 'spend';

  // Auto-categorize if category is left as Uncategorized
  if (!categoryId) {
    const catRes = categorize(
      {
        merchantRaw: value.merchant_raw || value.merchant || '',
        note: value.note || '',
        accountId: value.account_id || value.accountId || null,
        direction: value.direction || 'debit',
        amountPaise: value.amount_paise,
      },
      { brands, rules, accounts, categories }
    );

    if (catRes.categoryId) {
      categoryId = catRes.categoryId;
      categoryLocked = 0; // Rule-matched: not locked
    }
    if (catRes.brand) {
      brand = catRes.brand;
    }
    if (catRes.kind) {
      kind = catRes.kind;
    }
  }

  return {
    expenseId,
    amount_paise: value.amount_paise,
    date: value.date,
    txn_ts: value.txn_ts || nowIso,
    direction: value.direction || 'debit',
    kind,
    merchant_raw: value.merchant_raw || value.merchant || null,
    brand,
    category_id: categoryId,
    category_locked: categoryLocked,
    account_id: value.account_id !== undefined ? value.account_id : (value.accountId || null),
    mode: value.mode || 'card',
    source: 'manual',
    ref_no: null,
    dedupe_key: null,
    note: value.note || null,
    status: 'active',
  };
}

/**
 * Builds a patch object containing ONLY the fields that changed between original and updated values.
 * If categoryId changes, sets category_locked = 1 (or 0 if category is Uncategorized / null).
 * Returns null if no fields changed.
 * 
 * @param {object} original - Existing expense row.
 * @param {object} value - New values.
 * @returns {object|null} Patch object or null.
 */
export function buildPatch(original = {}, value = {}) {
  const patch = {};

  if (value.amount_paise !== undefined && value.amount_paise !== original.amount_paise) {
    patch.amount_paise = value.amount_paise;
  }

  if (value.date !== undefined && value.date !== original.date) {
    patch.date = value.date;
  }

  if (value.direction !== undefined && value.direction !== original.direction) {
    patch.direction = value.direction;
  }

  if (value.kind !== undefined && value.kind !== original.kind) {
    patch.kind = value.kind;
  }

  const newMerchant = value.merchant_raw !== undefined
    ? value.merchant_raw
    : (value.merchant !== undefined ? value.merchant : undefined);
  if (newMerchant !== undefined) {
    const normNew = newMerchant ? String(newMerchant).trim() : null;
    const normOrig = original.merchant_raw ? String(original.merchant_raw).trim() : null;
    if (normNew !== normOrig) {
      patch.merchant_raw = normNew;
    }
  }

  const newCat = value.category_id !== undefined
    ? value.category_id
    : (value.categoryId !== undefined ? value.categoryId : undefined);
  if (newCat !== undefined) {
    const normNew = newCat && newCat !== '__uncategorized__' ? String(newCat).trim() : null;
    const normOrig = original.category_id ? String(original.category_id).trim() : null;
    if (normNew !== normOrig) {
      patch.category_id = normNew;
      patch.category_locked = normNew ? 1 : 0;
    }
  }

  const newAcc = value.account_id !== undefined
    ? value.account_id
    : (value.accountId !== undefined ? value.accountId : undefined);
  if (newAcc !== undefined) {
    const normNew = newAcc ? String(newAcc).trim() : null;
    const normOrig = original.account_id ? String(original.account_id).trim() : null;
    if (normNew !== normOrig) {
      patch.account_id = normNew;
    }
  }

  if (value.mode !== undefined && value.mode !== original.mode) {
    patch.mode = value.mode;
  }

  if (value.note !== undefined) {
    const normNew = value.note ? String(value.note).trim() : null;
    const normOrig = original.note ? String(original.note).trim() : null;
    if (normNew !== normOrig) {
      patch.note = normNew;
    }
  }

  return Object.keys(patch).length > 0 ? patch : null;
}
