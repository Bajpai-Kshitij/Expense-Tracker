import { createEmptyState } from '../events/reducer.js';

/**
 * Converts pure reducer state into relational table rows.
 * @param {object} state - Reducer state.
 * @returns {object} Table rows grouped by table name.
 */
export function stateToRows(state) {
  const expenses = Object.values(state.expenses || {})
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((exp) => ({
      id: exp.id,
      amount_paise: exp.amountPaise !== undefined ? exp.amountPaise : null,
      date: exp.date || null,
      txn_ts: exp.txnTs || exp.createdAt || null,
      direction: exp.direction || 'debit',
      kind: exp.kind || 'spend',
      merchant_raw: exp.merchantRaw || null,
      brand: exp.brand || null,
      category_id: exp.categoryId || null,
      category_locked: exp.categoryLocked ? 1 : 0,
      account_id: exp.accountId || null,
      mode: exp.mode || null,
      source: exp.source || null,
      ref_no: exp.refNo || null,
      dedupe_key: exp.dedupeKey || null,
      note: exp.note || null,
      status: exp.deleted ? 'deleted' : 'active',
      field_ts: JSON.stringify(exp.field_ts || {}),
      created_by_dev: exp.createdDev || null,
      merged_into: exp.mergedInto || null,
    }));

  const categories = Object.values(state.categories || {})
    .sort((a, b) => {
      const idA = a.categoryId || a.id;
      const idB = b.categoryId || b.id;
      return idA < idB ? -1 : idA > idB ? 1 : 0;
    })
    .map((cat) => ({
      id: cat.categoryId || cat.id,
      name: cat.name || null,
      icon: cat.icon || null,
      color: cat.color || null,
      extras: JSON.stringify(cat),
    }));

  const brands = Object.values(state.brands || {})
    .sort((a, b) => {
      const idA = a.brandId || a.id || a.name;
      const idB = b.brandId || b.id || b.name;
      return idA < idB ? -1 : idA > idB ? 1 : 0;
    })
    .map((b) => ({
      id: b.brandId || b.id || b.name,
      name: b.name || null,
      default_category_id: b.defaultCategoryId || b.default_category_id || null,
      extras: JSON.stringify(b),
    }));

  const rules = Object.values(state.rules || {})
    .sort((a, b) => {
      const idA = a.ruleId || a.id;
      const idB = b.ruleId || b.id;
      return idA < idB ? -1 : idA > idB ? 1 : 0;
    })
    .map((r) => ({
      id: r.ruleId || r.id,
      pattern: r.pattern || null,
      category_id: r.categoryId || null,
      account_id: r.accountId || null,
      extras: JSON.stringify(r),
    }));

  const accounts = Object.values(state.accounts || {})
    .sort((a, b) => {
      const idA = a.accountId || a.id;
      const idB = b.accountId || b.id;
      return idA < idB ? -1 : idA > idB ? 1 : 0;
    })
    .map((acc) => ({
      id: acc.accountId || acc.id,
      name: acc.name || null,
      type: acc.type || null,
      extras: JSON.stringify(acc),
    }));

  const applied_events = Array.from(state.appliedEventIds || [])
    .sort()
    .map((id) => ({ id }));

  const pending_events = (state.parkedEvents || [])
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((ev) => ({ id: ev.id, event: JSON.stringify(ev) }));

  const review_queue = Object.values(state.reviews || {})
    .sort((a, b) => {
      const idA = a.reviewId || a.id;
      const idB = b.reviewId || b.id;
      return idA < idB ? -1 : idA > idB ? 1 : 0;
    })
    .map((rev) => ({
      id: rev.reviewId || rev.id,
      type: rev.type || 'unparsed',
      payload: JSON.stringify(rev),
      status: rev.status || 'pending',
    }));

  return {
    expenses,
    categories,
    brands,
    rules,
    accounts,
    applied_events,
    pending_events,
    review_queue,
  };
}

/**
 * Reconstitutes reducer state from database table rows.
 * @param {object} rows - Database rows grouped by table name.
 * @returns {object} Hydrated reducer state.
 */
export function rowsToState(rows = {}) {
  const state = createEmptyState();

  for (const row of rows.expenses || []) {
    const fieldTs = row.field_ts
      ? typeof row.field_ts === 'string'
        ? JSON.parse(row.field_ts)
        : row.field_ts
      : {};

    const exp = {
      id: row.id,
      deleted: row.status === 'deleted',
      field_ts: fieldTs,
    };

    if (row.amount_paise !== null && row.amount_paise !== undefined) {
      exp.amountPaise = row.amount_paise;
    }
    if (row.date !== null && row.date !== undefined) exp.date = row.date;
    if (row.direction !== null && row.direction !== undefined) exp.direction = row.direction;
    if (row.kind !== null && row.kind !== undefined) exp.kind = row.kind;
    if (row.merchant_raw !== null && row.merchant_raw !== undefined) exp.merchantRaw = row.merchant_raw;
    if (row.brand !== null && row.brand !== undefined) exp.brand = row.brand;
    if (row.category_id !== null && row.category_id !== undefined) exp.categoryId = row.category_id;
    if (row.category_locked) exp.categoryLocked = true;
    if (row.account_id !== null && row.account_id !== undefined) exp.accountId = row.account_id;
    if (row.mode !== null && row.mode !== undefined) exp.mode = row.mode;
    if (row.source !== null && row.source !== undefined) exp.source = row.source;
    if (row.ref_no !== null && row.ref_no !== undefined) exp.refNo = row.ref_no;
    if (row.dedupe_key !== null && row.dedupe_key !== undefined) exp.dedupeKey = row.dedupe_key;
    if (row.note !== null && row.note !== undefined) exp.note = row.note;
    if (row.txn_ts) exp.createdAt = row.txn_ts;
    if (row.created_by_dev) exp.createdDev = row.created_by_dev;
    if (row.merged_into) exp.mergedInto = row.merged_into;

    state.expenses[row.id] = exp;
  }

  for (const row of rows.categories || []) {
    state.categories[row.id] = row.extras
      ? JSON.parse(row.extras)
      : { id: row.id, name: row.name, icon: row.icon, color: row.color };
  }

  for (const row of rows.brands || []) {
    state.brands[row.id] = row.extras
      ? JSON.parse(row.extras)
      : { id: row.id, name: row.name, defaultCategoryId: row.default_category_id };
  }

  for (const row of rows.rules || []) {
    state.rules[row.id] = row.extras
      ? JSON.parse(row.extras)
      : { id: row.id, pattern: row.pattern, categoryId: row.category_id, accountId: row.account_id };
  }

  for (const row of rows.accounts || []) {
    state.accounts[row.id] = row.extras
      ? JSON.parse(row.extras)
      : { id: row.id, name: row.name, type: row.type };
  }

  for (const row of rows.applied_events || []) {
    state.appliedEventIds.add(row.id);
  }

  for (const row of rows.pending_events || []) {
    const ev = typeof row.event === 'string' ? JSON.parse(row.event) : row.event;
    state.parkedEvents.push(ev);
  }

  for (const row of rows.review_queue || []) {
    state.reviews[row.id] = row.payload
      ? JSON.parse(row.payload)
      : { id: row.id, type: row.type, status: row.status };
  }

  return state;
}
