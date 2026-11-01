import React, { useState, useEffect } from 'react';
import { totals, totalsByCategory, listExpenses, uncategorizedInbox } from '../core/db/queries.js';
import { formatPaise } from '../core/format/money.js';
import { getThisMonthRange, formatDateDisplay } from '../core/format/dates.js';

export default function HomeTab({
  db,
  categoriesMap = {},
  accountsMap = {},
  includeFixed,
  setIncludeFixed,
  onNavigateToExpenses,
  onNavigateToUncategorized,
  onSelectExpense,
}) {
  const [loading, setLoading] = useState(true);
  const [totalData, setTotalData] = useState({ netPaise: 0, spendPaise: 0, count: 0 });
  const [catChartData, setCatChartData] = useState([]);
  const [recentExpenses, setRecentExpenses] = useState([]);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);

  const loadData = async () => {
    if (!db) return;
    try {
      setLoading(true);
      const { from, to } = getThisMonthRange();

      // 1. Net spend this month
      const tot = await totals(db, { from, to, includeFixed });
      setTotalData(tot);

      // 2. Spend by category (top 6 + Other)
      const catTotals = await totalsByCategory(db, { from, to, includeFixed });
      const validCats = catTotals.filter((c) => c.spendPaise > 0);
      validCats.sort((a, b) => b.spendPaise - a.spendPaise);

      const top6 = validCats.slice(0, 6);
      const remaining = validCats.slice(6);
      const otherSpend = remaining.reduce((acc, c) => acc + c.spendPaise, 0);

      const chartItems = top6.map((c) => ({
        id: c.categoryId || 'uncategorized',
        name: c.name || categoriesMap[c.categoryId]?.name || 'Uncategorized',
        color: categoriesMap[c.categoryId]?.color || '#94a3b8',
        spendPaise: c.spendPaise,
      }));

      if (otherSpend > 0) {
        chartItems.push({
          id: 'other',
          name: 'Other',
          color: '#64748b',
          spendPaise: otherSpend,
        });
      }

      setCatChartData(chartItems);

      // 3. Uncategorized inbox
      const uncat = await uncategorizedInbox(db);
      setUncategorizedCount(uncat.length);

      // 4. Last 5 expenses
      const recent = await listExpenses(db, { limit: 5 });
      setRecentExpenses(recent);
    } catch (err) {
      console.error('Failed to load Home data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [db, includeFixed]);

  const maxCatSpend = catChartData.reduce((max, c) => Math.max(max, c.spendPaise), 1);

  return (
    <div>
      {/* Month Total Card */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">This Month's Net Spend</span>
          <label className="toggle-fixed-label">
            <input
              type="checkbox"
              checked={includeFixed}
              onChange={(e) => setIncludeFixed(e.target.checked)}
            />
            Include Fixed
          </label>
        </div>
        <div className="net-spend-display">
          <div className="net-spend-amount">
            {formatPaise(totalData.netPaise)}
          </div>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '4px' }}>
          {totalData.count} transactions in {new Date().toLocaleString('default', { month: 'long' })}
        </p>
      </div>

      {/* Uncategorized Alert Card */}
      {uncategorizedCount > 0 && (
        <div
          className="card uncategorized-card"
          onClick={() => {
            if (onNavigateToUncategorized) {
              onNavigateToUncategorized();
            } else {
              onNavigateToExpenses({ uncategorizedOnly: true });
            }
          }}
        >
          <div>
            <h3>⚠️ {uncategorizedCount} Uncategorized {uncategorizedCount === 1 ? 'Expense' : 'Expenses'}</h3>
            <p>Tap to review and assign categories</p>
          </div>
          <span style={{ fontSize: '1.2rem', color: 'var(--text-secondary)' }}>➔</span>
        </div>
      )}

      {/* Category Spend Bar Chart */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Spend by Category</span>
        </div>

        {catChartData.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', padding: '8px 0' }}>
            No spending recorded yet for this month.
          </p>
        ) : (
          <div className="chart-container">
            {catChartData.map((item) => {
              const pct = Math.min(100, Math.round((item.spendPaise / maxCatSpend) * 100));
              return (
                <div key={item.id} className="chart-bar-row">
                  <div className="chart-bar-header">
                    <span>{item.name}</span>
                    <span style={{ fontWeight: 600 }}>{formatPaise(item.spendPaise)}</span>
                  </div>
                  <div className="chart-bar-track">
                    <div
                      className="chart-bar-fill"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: item.color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Recent 5 Expenses */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Recent Transactions</span>
          {recentExpenses.length > 0 && (
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '2px 8px', fontSize: '0.75rem', minHeight: '28px' }}
              onClick={() => onNavigateToExpenses({})}
            >
              View All
            </button>
          )}
        </div>

        {recentExpenses.length === 0 ? (
          <div className="state-box">
            <h3>No expenses yet</h3>
            <p>Tap the + button to add your first expense.</p>
          </div>
        ) : (
          <div>
            {recentExpenses.map((exp) => {
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
          </div>
        )}
      </div>
    </div>
  );
}

