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
    includeFixed: Boolean(initialFilters.includeFixed),
    limit: 50,
  });

  const [expenses, setExpenses] = useState([]);
  const [totalsData, setTotalsData] = useState({ netPaise: 0, count: 0 });
  const [loading, setLoading] = useState(true);

  // Sync initialFilters if changed externally (e.g. from Home tab's uncategorized card)
  useEffect(() => {
    if (initialFilters.uncategorizedOnly) {
      setFilterState((prev) => ({
        ...prev,
        categoryId: '__uncategorized__',
        preset: 'all_time',
      }));
    }
  }, [initialFilters]);

  const loadExpenses = async () => {
    if (!db) return;
    try {
      setLoading(true);
      const normalized = normalizeFilters(filterState);

      // Query totals of filtered set
      const tot = await totals(db, normalized);
      setTotalsData(tot);

      // Query expenses with current limit
      const list = await listExpenses(db, normalized);
      setExpenses(list);
    } catch (err) {
      console.error('Failed to load expenses list:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadExpenses();
  }, [db, filterState]);

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
      </div>

      {/* Expenses List */}
      <div className="card" style={{ padding: '8px 16px' }}>
        {expenses.length === 0 ? (
          <div className="state-box">
            <h3>No matching expenses</h3>
            <p>Try adjusting your search or filters.</p>
          </div>
        ) : (
          <div>
            {expenses.map((exp) => {
              const catName = categoriesMap[exp.category_id]?.name || 'Uncategorized';
              const accName = accountsMap[exp.account_id]?.name || '';
              const isCredit = exp.direction === 'credit';

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
                    {exp.kind !== 'spend' && (
                      <span className={`badge badge-${exp.kind}`}>
                        {exp.kind}
                      </span>
                    )}
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

