import { compareEvents } from './event.js';

const KNOWN_EVENT_TYPES = new Set([
  'expense.created',
  'expense.updated',
  'expense.deleted',
  'expense.merged',
  'category.upserted',
  'brand.upserted',
  'rule.upserted',
  'rule.deleted',
  'account.upserted',
  'review.resolved',
]);

/**
 * Initializes an empty state container for the event reducer.
 * @returns {object} Fresh empty state.
 */
export function createEmptyState() {
  return {
    expenses: {},
    categories: {},
    brands: {},
    rules: {},
    accounts: {},
    appliedEventIds: new Set(),
    parkedEvents: [],
    reviews: {},
    warnings: [],
  };
}

/**
 * Determines if a new field update wins over an existing field update based on Last-Writer-Wins.
 * Later timestamp wins; equal timestamps are broken by dev ID.
 * 
 * @param {{ ts: string|number, dev: string } | undefined} existingMeta - Existing field metadata.
 * @param {{ ts: string|number, dev: string }} newMeta - New candidate field metadata.
 * @returns {boolean} True if new field wins.
 */
export function isFieldUpdateWinning(existingMeta, newMeta) {
  if (!existingMeta) return true;

  const tsExisting = typeof existingMeta.ts === 'number' ? existingMeta.ts : Date.parse(existingMeta.ts);
  const tsNew = typeof newMeta.ts === 'number' ? newMeta.ts : Date.parse(newMeta.ts);

  if (tsNew > tsExisting) return true;
  if (tsNew < tsExisting) return false;

  // Timestamps equal: broken by dev id
  return newMeta.dev > existingMeta.dev;
}

/**
 * Internal single-event application handler.
 * Returns { status: 'applied' | 'parked' | 'skipped' }.
 */
function applySingleEvent(event, state) {
  if (!event || event.v !== 1 || !KNOWN_EVENT_TYPES.has(event.type)) {
    state.warnings.push({
      eventId: event?.id,
      type: event?.type,
      v: event?.v,
      reason: `Unknown event type or version: type=${event?.type}, v=${event?.v}`,
    });
    return { status: 'skipped' };
  }

  const { type, data, dev, ts } = event;

  switch (type) {
    case 'expense.created': {
      const expenseId = data.expenseId;
      if (!expenseId) {
        state.warnings.push({ eventId: event.id, reason: 'expense.created missing expenseId' });
        return { status: 'skipped' };
      }

      const existing = state.expenses[expenseId];
      if (existing) {
        // Expense already exists (e.g. same deterministic id created on two devices)
        // Merge without creating a second one, preserving tombstone if already deleted
        for (const [key, value] of Object.entries(data)) {
          if (key === 'expenseId') continue;
          if (!existing.deleted) {
            const existingMeta = existing.field_ts[key];
            const newMeta = { ts, dev };
            if (isFieldUpdateWinning(existingMeta, newMeta)) {
              existing[key] = value;
              existing.field_ts[key] = newMeta;
            }
          }
        }
      } else {
        const field_ts = {};
        const expenseFields = {};
        for (const [key, value] of Object.entries(data)) {
          if (key === 'expenseId') continue;
          expenseFields[key] = value;
          field_ts[key] = { ts, dev };
        }

        state.expenses[expenseId] = {
          id: expenseId,
          ...expenseFields,
          deleted: false,
          field_ts,
          createdAt: ts,
          createdDev: dev,
        };
      }
      return { status: 'applied' };
    }

    case 'expense.updated': {
      const expenseId = data.expenseId || data.id;
      if (!expenseId || !state.expenses[expenseId]) {
        // Unknown expense: park until expense.created arrives
        return { status: 'parked' };
      }

      const existing = state.expenses[expenseId];
      if (existing.deleted) {
        // Deleted is a tombstone: later updates are ignored
        return { status: 'applied' };
      }

      const patch = data.patch ? data.patch : { ...data };
      delete patch.expenseId;
      delete patch.id;

      for (const [key, value] of Object.entries(patch)) {
        const existingMeta = existing.field_ts[key];
        const newMeta = { ts, dev };
        if (isFieldUpdateWinning(existingMeta, newMeta)) {
          existing[key] = value;
          existing.field_ts[key] = newMeta;
        }
      }
      return { status: 'applied' };
    }

    case 'expense.deleted': {
      const expenseId = data.expenseId || data.id;
      if (!expenseId || !state.expenses[expenseId]) {
        // Unknown expense: park until expense.created arrives
        return { status: 'parked' };
      }

      const existing = state.expenses[expenseId];
      existing.deleted = true;
      existing.deletedAt = ts;
      existing.deletedDev = dev;
      return { status: 'applied' };
    }

    case 'expense.merged': {
      const { keepId, dropId } = data;
      if (!dropId || !state.expenses[dropId]) {
        // Unknown expense: park until dropped expense exists
        return { status: 'parked' };
      }

      const dropExpense = state.expenses[dropId];
      dropExpense.deleted = true;
      dropExpense.mergedInto = keepId;
      dropExpense.deletedAt = ts;
      dropExpense.deletedDev = dev;
      return { status: 'applied' };
    }

    case 'category.upserted': {
      const id = data.categoryId || data.id;
      if (id) {
        state.categories[id] = { ...data };
      }
      return { status: 'applied' };
    }

    case 'brand.upserted': {
      const id = data.brandId || data.id || data.name;
      if (id) {
        state.brands[id] = { ...data };
      }
      return { status: 'applied' };
    }

    case 'account.upserted': {
      const id = data.accountId || data.id;
      if (id) {
        state.accounts[id] = { ...data };
      }
      return { status: 'applied' };
    }

    case 'rule.upserted': {
      const id = data.ruleId || data.id;
      if (id) {
        state.rules[id] = { ...data };
      }
      return { status: 'applied' };
    }

    case 'rule.deleted': {
      const id = data.ruleId || data.id;
      if (id) {
        delete state.rules[id];
      }
      return { status: 'applied' };
    }

    case 'review.resolved': {
      const id = data.reviewId || data.id || event.id;
      state.reviews[id] = { ...data };
      return { status: 'applied' };
    }

    default:
      return { status: 'skipped' };
  }
}

/**
 * Pure state reducer applying an array of events onto the state.
 * Returns a new state without mutating the original.
 * 
 * @param {object} state - Current state container.
 * @param {object[]} events - Array of incoming event objects.
 * @returns {object} New state after applying events.
 */
export function applyEvents(state = createEmptyState(), events = []) {
  // Deep clone collections to enforce immutability
  const expenses = {};
  for (const [id, exp] of Object.entries(state.expenses || {})) {
    expenses[id] = {
      ...exp,
      field_ts: { ...(exp.field_ts || {}) },
    };
  }

  const categories = { ...(state.categories || {}) };
  const brands = { ...(state.brands || {}) };
  const rules = { ...(state.rules || {}) };
  const accounts = { ...(state.accounts || {}) };
  const reviews = { ...(state.reviews || {}) };
  const appliedEventIds = new Set(state.appliedEventIds || []);
  const warnings = [...(state.warnings || [])];

  // Combine previously parked events and incoming events, skipping already applied
  const seenCandidateIds = new Set();
  const candidates = [];

  for (const ev of [...(state.parkedEvents || []), ...(events || [])]) {
    if (!ev || !ev.id) continue;
    if (appliedEventIds.has(ev.id)) continue;
    if (!seenCandidateIds.has(ev.id)) {
      seenCandidateIds.add(ev.id);
      candidates.push(ev);
    }
  }

  // Sort candidates deterministically by (ts, dev, seq, id)
  candidates.sort(compareEvents);

  const context = {
    expenses,
    categories,
    brands,
    rules,
    accounts,
    reviews,
    appliedEventIds,
    warnings,
  };

  // Repeatedly apply queue as long as progress is made (resolving parked events)
  let queue = candidates;
  let progress = true;

  while (progress && queue.length > 0) {
    progress = false;
    const nextQueue = [];

    for (const event of queue) {
      if (appliedEventIds.has(event.id)) {
        progress = true;
        continue;
      }

      const res = applySingleEvent(event, context);

      if (res.status === 'applied') {
        appliedEventIds.add(event.id);
        progress = true;
      } else if (res.status === 'parked') {
        nextQueue.push(event);
      } else if (res.status === 'skipped') {
        appliedEventIds.add(event.id);
        progress = true;
      }
    }

    queue = nextQueue;
  }

  // Remaining unapplied events stay parked in deterministic order
  const parkedEvents = [...queue].sort(compareEvents);

  return {
    expenses,
    categories,
    brands,
    rules,
    accounts,
    reviews,
    appliedEventIds,
    parkedEvents,
    warnings,
  };
}

