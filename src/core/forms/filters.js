import { getThisMonthRange, getLastMonthRange } from '../format/dates.js';

/**
 * Normalizes UI filter state into the exact filter criteria expected by SQLite read model queries.
 * 
 * Presets supported:
 * - "This month" / "this_month" (default): sets from/to for the current month in IST.
 * - "Last month" / "last_month": sets from/to for previous month in IST.
 * - "Custom range" / "custom": uses uiState.from and uiState.to.
 * - "All time" / "all_time": leaves from and to unset.
 * 
 * @param {object} [uiState={}] - Raw UI filter selections.
 * @param {() => number|Date|string} [clock=() => Date.now()] - Clock function.
 * @returns {object} Filter object formatted for listExpenses and totals queries.
 */
export function normalizeFilters(uiState = {}, clock = () => Date.now()) {
  const filters = {};

  const presetRaw = String(uiState.preset || uiState.period || 'this_month').toLowerCase().replace(/\s+/g, '_');

  if (presetRaw === 'this_month') {
    const range = getThisMonthRange(clock);
    filters.from = range.from;
    filters.to = range.to;
  } else if (presetRaw === 'last_month') {
    const range = getLastMonthRange(clock);
    filters.from = range.from;
    filters.to = range.to;
  } else if (presetRaw === 'custom' || presetRaw === 'custom_range') {
    if (uiState.from) filters.from = uiState.from;
    if (uiState.to) filters.to = uiState.to;
  } else if (presetRaw === 'all_time') {
    // No date bounds
  } else {
    // Default to this month
    const range = getThisMonthRange(clock);
    filters.from = range.from;
    filters.to = range.to;
  }

  // Handle explicit overrides if passed
  if (uiState.from && (presetRaw === 'custom' || presetRaw === 'custom_range')) {
    filters.from = uiState.from;
  }
  if (uiState.to && (presetRaw === 'custom' || presetRaw === 'custom_range')) {
    filters.to = uiState.to;
  }

  // Category filter
  if (uiState.uncategorizedOnly || uiState.categoryId === '__uncategorized__' || uiState.categoryId === 'Uncategorized') {
    filters.uncategorizedOnly = true;
  } else if (uiState.categoryId && uiState.categoryId !== 'all' && uiState.categoryId !== 'All') {
    filters.categoryId = uiState.categoryId;
  }

  // Account filter
  if (uiState.accountId && uiState.accountId !== 'all' && uiState.accountId !== 'All') {
    filters.accountId = uiState.accountId;
  }

  // Payment mode filter
  if (uiState.mode && uiState.mode !== 'all' && uiState.mode !== 'All') {
    filters.mode = uiState.mode.toLowerCase();
  }

  // Device attribution filter
  if (uiState.createdByDev && uiState.createdByDev !== 'all' && uiState.createdByDev !== 'All') {
    filters.createdByDev = uiState.createdByDev;
  }

  // Search text
  if (uiState.text) {
    const trimmed = String(uiState.text).trim();
    if (trimmed.length > 0) {
      filters.text = trimmed;
    }
  }

  // Include fixed expenses toggle
  filters.includeFixed = Boolean(uiState.includeFixed);

  // Pagination
  if (typeof uiState.limit === 'number' && uiState.limit > 0) {
    filters.limit = uiState.limit;
  }
  if (typeof uiState.offset === 'number' && uiState.offset >= 0) {
    filters.offset = uiState.offset;
  }

  return filters;
}

