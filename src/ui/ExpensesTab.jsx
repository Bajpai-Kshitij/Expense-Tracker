import React, { useState, useEffect } from 'react';
import { listExpenses, totals } from '../core/db/queries.js';
import { normalizeFilters } from '../core/forms/filters.js';
import { formatPaise } from '../core/format/money.js';
import { formatDateDisplay } from '../core/format/dates.js';

export default function ExpensesTab({
  db,
  categories = [],
  accounts = [],
  devices = [],
  categoriesMap = {},
  accountsMap = {},
  initialFilters = {},
  onSelectExpense,
  onNavigateToUncategorized,
  refreshTick = 0,
}) {
  const [filterState, setFilterState] = useState({
    preset: initialFilters.preset || 'this_month',
    from: initialFilters.from || '',
    to: initialFilters.to || '',
    categoryId: initialFilters.uncategorizedOnly ? '__uncategorized__' : (initialFilters.categoryId || 'all'),
    accountId: initialFilters.accountId || 'all',
    mode: initialFilters.mode || 'all',
    createdByDev: initialFilters.createdByDev || 'all',
    text: initialFilters.text || '',
    typeFilter: initialFilters.typeFilter || 'spend_fixed', // 'spend_fixed' | 'spend' | 'fixed' | 'transfer' | 'income' | 'all'
    includeFixed: true,
    limit: 50,
  });

  const [expenses, setExpenses] = useState([]);
  const [totalsData, setTotalsData] = useState({ netPaise: 0, count: 0 });
  const [loading, setLoading] = useState(true);

  // Sync initialFilters if changed externally (e.g. from Home tab or Reports tab)
  useEffect(() => {
    if (!initialFilters || Object.keys(initialFilters).length === 0) return;
    setFilterState((prev) => {
      const next = { ...prev };
      if (initialFilters.preset !== undefined) next.preset = initialFilters.preset;
      if (initialFilters.from !== undefined) next.from = initialFilters.from;
      if (initialFilters.to !== undefined) next.to = initialFilters.to;
      if (initialFilters.categoryId !== undefined) next.categoryId = initialFilters.categoryId;
      if (initialFilters.uncategorizedOnly) {
        next.categoryId = '__uncategorized__';
        if (!initialFilters.from && !initialFilters.to) {
          next.preset = 'all_time';
        }
      }
      if (initialFilters.accountId !== undefined) next.accountId = initialFilters.accountId;
      if (initialFilters.mode !== undefined) next.mode = initialFilters.mode;
      if (initialFilters.createdByDev !== undefined) next.createdByDev = initialFilters.createdByDev;
      if (initialFilters.text !== undefined) next.text = initialFilters.text;
      if (initialFilters.typeFilter !== undefined) next.typeFilter = initialFilters.typeFilter;
      if (initialFilters.includeFixed !== undefined) {
        next.typeFilter = initialFilters.includeFixed ? 'spend_fixed' : 'spend';
      }
      next.limit = 50;
      return next;
    });
  }, [initialFilters]);

  const loadExpenses = async (isInitial = false) => {
    if (!db) return;
    try {
      if (isInitial) setLoading(true);
      const normalized = normalizeFilters({
        ...filterState,
        includeFixed: filterState.typeFilter === 'spend_fixed' || filterState.typeFilter === 'fixed' || filterState.typeFilter === 'all',
      });

      // Query totals of filtered set
      const tot = await totals(db, normalized);
      setTotalsData(tot);

      // Query expenses with current limit, always fetching all kinds so in-memory typeFilter works
      const list = await listExpenses(db, { ...normalized, includeFixed: true });
      setExpenses(list);
    } catch (err) {
      console.error('Failed to load expenses list:', err);
    } finally {
      setLoading(false);
    }
  };

  const displayedExpenses = expenses.filter((exp) => {
    if (filterState.typeFilter === 'spend_fixed') {
      return exp.kind === 'spend' || exp.kind === 'fixed';
    }
    if (filterState.typeFilter === 'spend') {
      return exp.kind === 'spend';
    }
    if (filterState.typeFilter === 'fixed') {
      return exp.kind === 'fixed';
    }
    if (filterState.typeFilter === 'transfer') {
      return exp.kind === 'transfer';
    }
    if (filterState.typeFilter === 'income') {
      return exp.kind === 'income';
    }
    return true; // 'all'
  });

  useEffect(() => {
    loadExpenses(expenses.length === 0);
  }, [db, filterState, refreshTick]);

  const handleFilterChange = (key, val) => {
    setFilterState((prev) => ({
      ...prev,
      [key]: val,
      limit: 50, // reset pagination on filter change
    }));
  };

  const handleLoadMore = () => {
    setFilterState((prev) => ({
      ...prev,
      limit: prev.limit + 50,
    }));
  };

  return (
    <div>
      {/* Filtered Total Display */}
      <div className="card" style={{ padding: '14px 16px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <div>
            <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Filtered Net Spend
            </div>
            <div style={{ fontSize: '1.6rem', fontWeight: 800, color: 'var(--text-primary)' }}>
              {formatPaise(totalsData.netPaise)}
            </div>
          </div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            {totalsData.count} {totalsData.count === 1 ? 'expense' : 'expenses'}
          </div>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="card filter-card">
        {/* Search */}
        <input
          type="text"
          className="search-input"
          placeholder="🔍 Search merchant, brand, note..."
          value={filterState.text}
          onChange={(e) => handleFilterChange('text', e.target.value)}
        />

        <div className="filter-grid">
          {/* Preset */}
          <div>
            <select
              className="filter-select"
              value={filterState.preset}
              onChange={(e) => handleFilterChange('preset', e.target.value)}
            >
              <option value="this_month">This Month</option>
              <option value="last_month">Last Month</option>
              <option value="custom">Custom Range</option>
              <option value="all_time">All Time</option>
            </select>
          </div>

          {/* Type / Kind Filter */}
          <div>
            <select
              className="filter-select"
              value={filterState.typeFilter}
              onChange={(e) => handleFilterChange('typeFilter', e.target.value)}
            >
              <option value="spend_fixed">Spend + Fixed</option>
              <option value="spend">Spend</option>
              <option value="fixed">Fixed</option>
              <option value="transfer">Transfer</option>
              <option value="income">Income</option>
              <option value="all">All</option>
            </select>
          </div>

          {/* Category */}
          <div>
            <select
              className="filter-select"
              value={filterState.categoryId}
              onChange={(e) => handleFilterChange('categoryId', e.target.value)}
            >
              <option value="all">All Categories</option>
              <option value="__uncategorized__">⚠️ Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Account */}
          <div>
            <select
              className="filter-select"
              value={filterState.accountId}
              onChange={(e) => handleFilterChange('accountId', e.target.value)}
            >
              <option value="all">All Accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Mode */}
          <div>
            <select
              className="filter-select"
              value={filterState.mode}
              onChange={(e) => handleFilterChange('mode', e.target.value)}
            >
              <option value="all">All Modes</option>
              <option value="card">Card</option>
              <option value="upi">UPI</option>
              <option value="cash">Cash</option>
              <option value="netbanking">Netbanking</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>

        {/* Custom Range Pickers */}
        {filterState.preset === 'custom' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '8px' }}>
            <input
              type="date"
              className="filter-select"
              value={filterState.from}
              onChange={(e) => handleFilterChange('from', e.target.value)}
            />
            <input
              type="date"
              className="filter-select"
              value={filterState.to}
              onChange={(e) => handleFilterChange('to', e.target.value)}
            />
          </div>
        )}

        {/* Attribution & Fixed Switch */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--border-color)' }}>
          {devices.length > 1 ? (
            <select
              className="filter-select"
              style={{ width: 'auto' }}
              value={filterState.createdByDev}
              onChange={(e) => handleFilterChange('createdByDev', e.target.value)}
            >
              <option value="all">All Devices</option>
              {devices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
          ) : <div />}

          <label className="toggle-fixed-label">
            <input
              type="checkbox"
              checked={filterState.includeFixed}
              onChange={(e) => handleFilterChange('includeFixed', e.target.checked)}
            />
            Include Fixed
          </label>
        </div>

        {filterState.categoryId === '__uncategorized__' && onNavigateToUncategorized && (
          <div style={{ marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Review in Inbox to batch categorize</span>
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: '4px 10px', minHeight: '30px', fontSize: '0.75rem' }}
              onClick={onNavigateToUncategorized}
            >
              Open Inbox ➔
            </button>
          </div>
        )}
      </div>

      {/* Expenses List */}
      <div className="card" style={{ padding: '8px 16px' }}>
        {displayedExpenses.length === 0 ? (
          <div className="state-box">
            <h3>No matching expenses</h3>
            <p>Try adjusting your search or filters.</p>
          </div>
        ) : (
          <div>
            {displayedExpenses.map((exp) => {
              const catName = categoriesMap[exp.category_id]?.name || 'Uncategorized';
              const accName = accountsMap[exp.account_id]?.name || '';
              const isCredit = exp.direction === 'credit';
              const linkId = exp.linkId || exp.link_id;
              const counterpartCount = linkId
                ? expenses.filter((e) => (e.linkId || e.link_id) === linkId && e.id !== exp.id).length
                : 0;

              return (
                <div
                  key={exp.id}
                  className="expense-item"
                  onClick={() => onSelectExpense(exp)}
                >
                  <div className="expense-left">
                    <div className="expense-title">
                      {exp.merchant_raw || exp.note || 'Expense'}
                    </div>
                    <div className="expense-meta">
                      <span>{catName}</span>
                      {accName && <span>&bull; {accName}</span>}
                      <span>&bull; {formatDateDisplay(exp.date)}</span>
                    </div>
                  </div>
                  <div className="expense-right">
                    <div className={`expense-amount ${isCredit ? 'credit' : 'debit'}`}>
                      {isCredit ? '+' : ''}{formatPaise(exp.amount_paise)}
                    </div>
                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginTop: '2px' }}>
                      {exp.kind !== 'spend' && (
                        <span className={`badge badge-${exp.kind}`}>
                          {exp.kind}
                        </span>
                      )}
                      {(exp.kind === 'transfer' || exp.kind === 'income') && (
                        <span className="badge badge-not-counted" style={{ background: 'var(--bg-tertiary, #e2e8f0)', color: 'var(--text-secondary, #64748b)', fontSize: '0.65rem', padding: '1px 5px', borderRadius: '4px' }}>
                          Not counted
                        </span>
                      )}
                      {exp.source === 'sms' && (
                        <span className="badge badge-sms" style={{ background: '#0284c7', color: '#fff', fontSize: '0.65rem', padding: '1px 4px', borderRadius: '4px' }}>
                          SMS
                        </span>
                      )}
                      {exp.kind === 'transfer' && counterpartCount > 0 && (
                        <span style={{ fontSize: '0.65rem', color: 'var(--accent-primary)', fontWeight: 600 }}>
                          🔗 {counterpartCount} {counterpartCount === 1 ? 'linked' : 'linked'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Load more button */}
            {expenses.length >= filterState.limit && (
              <div style={{ textAlign: 'center', padding: '16px 0' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleLoadMore}
                >
                  Load More Expenses
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

