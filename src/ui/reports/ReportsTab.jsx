import React, { useState, useEffect, useCallback, useMemo } from 'react';
import './reports.css';

import {
  monthRange,
  prevMonth,
  nextMonth,
  lastNMonths,
  currentMonthIST,
  isFutureMonth,
  formatMonthLabel,
  percentChange,
  buildCategoryBreakdown,
  buildTrend,
  buildDailySeries,
  projectMonthEnd,
  buildInsights,
} from '../../core/reports/index.js';
import { categoryLabel } from '../../core/health/categories.js';

import {
  categoryTotals,
  dayTotals,
  monthTotals,
  topBrands,
  accountTotals,
  ownerTotals,
  addedByTotals,
  uncountedTotals,
} from '../../core/db/reportQueries.js';

import { formatPaise } from '../../core/format/money.js';

export default function ReportsTab({
  db,
  categories = [],
  accounts = [],
  devices = [],
  initialMonth,
  onMonthChange,
  initialIncludeFixed = false,
  onIncludeFixedChange,
  onNavigateToExpenses,
  onNavigateToUncategorized,
  refreshTick = 0,
}) {
  const [selectedMonth, setSelectedMonth] = useState(
    initialMonth || currentMonthIST()
  );
  const [includeFixed, setIncludeFixed] = useState(Boolean(initialIncludeFixed));
  const [activeWhoTab, setActiveWhoTab] = useState('owner'); // 'owner' | 'account' | 'device'

  // Section data states
  const [monthSummary, setMonthSummary] = useState({
    netPaise: 0,
    fixedPaise: 0,
    incomePaise: 0,
    count: 0,
  });
  const [prevMonthSummary, setPrevMonthSummary] = useState({ netPaise: 0 });
  const [breakdown, setBreakdown] = useState([]);
  const [trendData, setTrendData] = useState({ points: [], maxPaise: 0, averagePaise: 0 });
  const [dailyData, setDailyData] = useState({ days: [], maxPaise: 0 });
  const [topMerchantsList, setTopMerchantsList] = useState([]);
  const [ownerList, setOwnerList] = useState([]);
  const [accountList, setAccountList] = useState([]);
  const [deviceList, setDeviceList] = useState([]);
  const [insightsList, setInsightsList] = useState([]);
  const [uncounted, setUncounted] = useState({
    transfersOutPaise: 0,
    transfersInPaise: 0,
    incomePaise: 0,
  });

  // Loading states
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [breakdownLoading, setBreakdownLoading] = useState(true);
  const [trendLoading, setTrendLoading] = useState(true);
  const [dailyLoading, setDailyLoading] = useState(true);
  const [merchantsLoading, setMerchantsLoading] = useState(true);
  const [whoLoading, setWhoLoading] = useState(true);

  // Month navigation handlers
  const handlePrevMonth = () => {
    const prev = prevMonth(selectedMonth);
    setSelectedMonth(prev);
    if (onMonthChange) onMonthChange(prev);
  };

  const handleNextMonth = () => {
    const next = nextMonth(selectedMonth);
    if (!isFutureMonth(next)) {
      setSelectedMonth(next);
      if (onMonthChange) onMonthChange(next);
    }
  };

  const handleSelectTrendMonth = (ym) => {
    setSelectedMonth(ym);
    if (onMonthChange) onMonthChange(ym);
  };

  const handleToggleFixed = (e) => {
    const nextVal = e.target.checked;
    setIncludeFixed(nextVal);
    if (onIncludeFixedChange) onIncludeFixedChange(nextVal);
  };

  // Maps for display names
  const accountNameMap = useMemo(() => {
    const map = new Map();
    for (const a of accounts) {
      if (a && a.id) {
        map.set(a.id, a.name || a.id);
      }
    }
    return map;
  }, [accounts]);

  const deviceLabelMap = useMemo(() => {
    const map = new Map();
    for (const d of devices) {
      if (d && d.deviceId) {
        map.set(d.deviceId, d.label || d.deviceLabel || d.deviceId);
      }
    }
    return map;
  }, [devices]);

  // Load all reports data
  const loadReportsData = useCallback(async () => {
    if (!db) return;

    const { from, to, days } = monthRange(selectedMonth);
    const prevYm = prevMonth(selectedMonth);
    const { from: prevFrom, to: prevTo } = monthRange(prevYm);

    // 1. Month Totals & Previous Month Totals
    setSummaryLoading(true);
    let curSummary = { netPaise: 0, fixedPaise: 0, incomePaise: 0, count: 0 };
    try {
      const mRows = await monthTotals(db, {
        fromMonth: prevYm,
        toMonth: selectedMonth,
        includeFixed,
      });

      const curRow = mRows.find((r) => r.month === selectedMonth);
      if (curRow) curSummary = curRow;
      setMonthSummary(curSummary);

      const prevRow = mRows.find((r) => r.month === prevYm);
      setPrevMonthSummary(prevRow || { netPaise: 0 });
    } catch (err) {
      console.error('Failed to load monthTotals in ReportsTab:', err);
    } finally {
      setSummaryLoading(false);
    }

    // 2. Category Breakdown & Insights
    setBreakdownLoading(true);
    let currentBreakdown = [];
    try {
      const [catRows, prevCatRows] = await Promise.all([
        categoryTotals(db, { from, to, includeFixed }),
        categoryTotals(db, { from: prevFrom, to: prevTo, includeFixed }),
      ]);

      currentBreakdown = buildCategoryBreakdown(catRows, categories, { topN: 8 });
      setBreakdown(currentBreakdown);

      const prevBreakdown = buildCategoryBreakdown(prevCatRows, categories, { topN: 8 });

      // Daily rows for insight spike detection
      const dRowsForInsight = await dayTotals(db, { from, to, includeFixed });
      const dailySeriesForInsight = buildDailySeries(dRowsForInsight, selectedMonth);

      const insights = buildInsights({
        breakdown: currentBreakdown,
        prevBreakdown,
        dailySeries: dailySeriesForInsight,
        netPaise: curSummary.netPaise,
        fixedPaise: curSummary.fixedPaise,
        totalCount: curSummary.count,
        daysInMonth: days,
      });
      setInsightsList(insights);
    } catch (err) {
      console.error('Failed to load categoryTotals/insights in ReportsTab:', err);
    } finally {
      setBreakdownLoading(false);
    }

    // 3. 6-Month Trend
    setTrendLoading(true);
    try {
      const trendMonths = lastNMonths(selectedMonth, 6);
      const trendRows = await monthTotals(db, {
        fromMonth: trendMonths[0],
        toMonth: trendMonths[trendMonths.length - 1],
        includeFixed,
      });
      const trend = buildTrend(trendRows, trendMonths);
      setTrendData(trend);
    } catch (err) {
      console.error('Failed to load trend in ReportsTab:', err);
    } finally {
      setTrendLoading(false);
    }

    // 4. Daily Series & Month-end Projection
    setDailyLoading(true);
    try {
      const dRows = await dayTotals(db, { from, to, includeFixed });
      const series = buildDailySeries(dRows, selectedMonth);
      setDailyData(series);
    } catch (err) {
      console.error('Failed to load dailyTotals in ReportsTab:', err);
    } finally {
      setDailyLoading(false);
    }

    // 5. Top Merchants
    setMerchantsLoading(true);
    try {
      const merchants = await topBrands(db, { from, to, includeFixed, limit: 10 });
      setTopMerchantsList(merchants);
    } catch (err) {
      console.error('Failed to load topBrands in ReportsTab:', err);
    } finally {
      setMerchantsLoading(false);
    }

    // 6. Who Section: Owner, Account, Device
    setWhoLoading(true);
    try {
      const [owners, accs, devs] = await Promise.all([
        ownerTotals(db, { from, to, includeFixed }),
        accountTotals(db, { from, to, includeFixed }),
        addedByTotals(db, { from, to, includeFixed }),
      ]);
      setOwnerList(owners);
      setAccountList(accs);
      setDeviceList(devs);
      // 7. Uncounted Totals
      try {
        const uncountedData = await uncountedTotals(db, { from, to });
        setUncounted(uncountedData);
      } catch (err) {
        console.error('Failed to load uncountedTotals in ReportsTab:', err);
      }
    } catch (err) {
      console.error('Failed to load whoTotals in ReportsTab:', err);
    } finally {
      setWhoLoading(false);
    }
  }, [db, selectedMonth, includeFixed, categories]);

  useEffect(() => {
    loadReportsData();
  }, [loadReportsData, refreshTick]);

  // Derived comparison vs previous month
  const compare = useMemo(() => {
    return percentChange(monthSummary.netPaise, prevMonthSummary.netPaise);
  }, [monthSummary.netPaise, prevMonthSummary.netPaise]);

  // Derived month-end projection
  const projection = useMemo(() => {
    return projectMonthEnd({
      ym: selectedMonth,
      netSoFarPaise: monthSummary.netPaise,
    });
  }, [selectedMonth, monthSummary.netPaise]);

  const { from, to } = useMemo(() => monthRange(selectedMonth), [selectedMonth]);
  const isNextDisabled = isFutureMonth(nextMonth(selectedMonth));
  const maxMerchantSpend = useMemo(() => {
    return topMerchantsList.reduce((max, m) => Math.max(max, m.netPaise), 0);
  }, [topMerchantsList]);

  return (
    <div className="reports-container">
      {/* Month Selector & Summary Card */}
      <section className="reports-header-card">
        <div className="month-picker-row">
          <button
            type="button"
            className="month-nav-btn"
            onClick={handlePrevMonth}
            aria-label="Previous Month"
          >
            ‹
          </button>
          <span className="month-nav-label">{formatMonthLabel(selectedMonth)}</span>
          <button
            type="button"
            className="month-nav-btn"
            onClick={handleNextMonth}
            disabled={isNextDisabled}
            aria-label="Next Month"
          >
            ›
          </button>
        </div>

        <div className="net-spend-container">
          <span className="net-spend-title">Net Spend</span>
          <span className="net-spend-amount">{formatPaise(monthSummary.netPaise)}</span>

          {compare && (
            <div className={`compare-badge ${compare.direction}`}>
              {compare.label} vs {formatMonthLabel(prevMonth(selectedMonth))}
            </div>
          )}
        </div>

        {(monthSummary.fixedPaise > 0 || monthSummary.incomePaise > 0) && (
          <div className="sub-totals-row">
            {monthSummary.fixedPaise > 0 && (
              <div className="sub-total-item">
                <span>Fixed payments:</span>
                <span className="sub-total-value">
                  {formatPaise(monthSummary.fixedPaise)}
                </span>
              </div>
            )}
            {monthSummary.incomePaise > 0 && (
              <div className="sub-total-item">
                <span>Income:</span>
                <span className="sub-total-value">
                  {formatPaise(monthSummary.incomePaise)}
                </span>
              </div>
            )}
          </div>
        )}

        <div className="toggle-fixed-row">
          <label className="toggle-label">
            <input
              type="checkbox"
              checked={includeFixed}
              onChange={handleToggleFixed}
            />
            <span>Include fixed payments</span>
          </label>
        </div>

        <div style={{ marginTop: '10px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          Not counted: transfers out {formatPaise(uncounted.transfersOutPaise)}, transfers in {formatPaise(uncounted.transfersInPaise)}, income {formatPaise(uncounted.incomePaise)}
        </div>
      </section>

      {/* Monthly Insights Card */}
      {insightsList.length > 0 && (
        <section className="insights-card">
          <div className="insights-title">
            <span>💡</span>
            <span>Monthly Insights</span>
          </div>
          <div className="insights-list">
            {insightsList.map((text, idx) => (
              <div key={idx} className="insight-line">
                <span className="insight-bullet">•</span>
                <span>{text}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Category Breakdown */}
      <section className="report-section-card">
        <h3 className="section-title">Spending by Category</h3>

        {breakdownLoading ? (
          <div className="loading-placeholder">Loading categories...</div>
        ) : breakdown.length === 0 ? (
          <div className="empty-state-text">No spending recorded for this month</div>
        ) : (
          <div className="category-breakdown-list">
            {breakdown.map((item, idx) => {
              const isUncat = item.id === null;
              const pct = Math.round(item.shareBps / 100);
              const barWidthPct = Math.max(0, Math.min(100, pct));

              return (
                <div key={item.id || `row-${idx}`}>
                  <button
                    type="button"
                    className="category-row-btn"
                    onClick={() => {
                      if (onNavigateToExpenses) {
                        onNavigateToExpenses({
                          from,
                          to,
                          preset: 'custom',
                          categoryId: isUncat ? undefined : item.id,
                          uncategorizedOnly: isUncat,
                          includeFixed,
                        });
                      }
                    }}
                  >
                    <div className="category-row-header">
                      <div className="category-name-group">
                        <span>{item.id === 'other' ? item.name : categoryLabel(item.id, categories)}</span>
                        {item.label && (
                          <span className="badge warning">({item.label})</span>
                        )}
                      </div>
                      <div className="category-amounts-group">
                        <span className="category-spend-amount">
                          {formatPaise(item.netPaise)}
                        </span>
                        {item.netPaise > 0 && (
                          <span className="category-share-pct">{pct}%</span>
                        )}
                      </div>
                    </div>

                    <div className="category-bar-track">
                      <div
                        className="category-bar-fill"
                        style={{
                          width: `${barWidthPct}%`,
                          backgroundColor: item.isRefund ? 'var(--warning)' : undefined,
                        }}
                      />
                    </div>
                  </button>

                  {isUncat && onNavigateToUncategorized && (
                    <div style={{ marginTop: 4 }}>
                      <button
                        type="button"
                        className="uncat-action-link"
                        onClick={(e) => {
                          e.stopPropagation();
                          onNavigateToUncategorized();
                        }}
                      >
                        Categorize in Inbox →
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* 6-Month Trend */}
      <section className="report-section-card">
        <h3 className="section-title">6-Month Trend</h3>

        {trendLoading ? (
          <div className="loading-placeholder">Loading trend...</div>
        ) : (
          <div>
            <div className="trend-chart-container">
              {trendData.points.map((pt) => {
                const isSelected = pt.month === selectedMonth;
                const heightPct =
                  trendData.maxPaise > 0
                    ? Math.max(4, Math.round((pt.netPaise / trendData.maxPaise) * 100))
                    : 4;

                const label = formatMonthLabel(pt.month).split(' ')[0];

                return (
                  <div
                    key={pt.month}
                    className={`trend-bar-column ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSelectTrendMonth(pt.month)}
                    title={`${formatMonthLabel(pt.month)}: ${formatPaise(pt.netPaise)}`}
                  >
                    <div
                      className="trend-bar-body"
                      style={{ height: `${heightPct}%` }}
                    />
                    <span className="trend-bar-label">{label}</span>
                  </div>
                );
              })}
            </div>

            {trendData.averagePaise > 0 && (
              <div className="trend-average-note">
                Monthly average: {formatPaise(trendData.averagePaise)} (past complete months)
              </div>
            )}
          </div>
        )}
      </section>

      {/* Daily Spending & Projection */}
      <section className="report-section-card">
        <h3 className="section-title">Daily Spending</h3>

        {dailyLoading ? (
          <div className="loading-placeholder">Loading daily data...</div>
        ) : (
          <div>
            <div className="daily-chart-scroll">
              <div className="daily-chart-container">
                {dailyData.days.map((d) => {
                  const heightPct =
                    dailyData.maxPaise > 0
                      ? Math.max(4, Math.round((d.netPaise / dailyData.maxPaise) * 100))
                      : 4;
                  const isSpike =
                    dailyData.maxPaise > 0 && d.netPaise === dailyData.maxPaise;

                  return (
                    <div
                      key={d.date}
                      className="daily-bar-column"
                      title={`${d.date}: ${formatPaise(d.netPaise)}`}
                    >
                      <div
                        className={`daily-bar-body ${isSpike ? 'spike' : ''}`}
                        style={{ height: `${heightPct}%` }}
                      />
                      <span className="daily-bar-label">{d.day}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {projection && (
              <div className="projection-card" style={{ marginTop: 12 }}>
                <span>📈</span>
                <span>
                  Projected month-end: {formatPaise(projection.projectedPaise)} (estimate based on {projection.daysElapsed} days)
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Top Merchants */}
      <section className="report-section-card">
        <h3 className="section-title">Top Merchants</h3>

        {merchantsLoading ? (
          <div className="loading-placeholder">Loading top merchants...</div>
        ) : topMerchantsList.length === 0 ? (
          <div className="empty-state-text">No merchant data for this month</div>
        ) : (
          <div className="merchants-list">
            {topMerchantsList.map((m, idx) => {
              const widthPct =
                maxMerchantSpend > 0
                  ? Math.max(4, Math.round((m.netPaise / maxMerchantSpend) * 100))
                  : 4;

              return (
                <button
                  key={`${m.key}-${idx}`}
                  type="button"
                  className="merchant-row-btn"
                  onClick={() => {
                    if (onNavigateToExpenses) {
                      onNavigateToExpenses({
                        from,
                        to,
                        preset: 'custom',
                        text: m.label,
                        includeFixed,
                      });
                    }
                  }}
                >
                  <div className="merchant-row-top">
                    <span className="merchant-label">
                      {idx + 1}. {m.label}
                    </span>
                    <span className="merchant-amount">{formatPaise(m.netPaise)}</span>
                  </div>

                  <div className="category-bar-track">
                    <div
                      className="category-bar-fill"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Breakdown by Owner / Account / Device */}
      <section className="report-section-card">
        <h3 className="section-title">Breakdown by Source</h3>

        <div className="who-tabs-row">
          <button
            type="button"
            className={`who-subtab-btn ${activeWhoTab === 'owner' ? 'active' : ''}`}
            onClick={() => setActiveWhoTab('owner')}
          >
            By Owner
          </button>
          <button
            type="button"
            className={`who-subtab-btn ${activeWhoTab === 'account' ? 'active' : ''}`}
            onClick={() => setActiveWhoTab('account')}
          >
            By Account
          </button>
          <button
            type="button"
            className={`who-subtab-btn ${activeWhoTab === 'device' ? 'active' : ''}`}
            onClick={() => setActiveWhoTab('device')}
          >
            By Device
          </button>
        </div>

        {whoLoading ? (
          <div className="loading-placeholder">Loading breakdown...</div>
        ) : (
          <div className="who-list" style={{ marginTop: 8 }}>
            {activeWhoTab === 'owner' && (
              ownerList.length === 0 ? (
                <div className="empty-state-text">No data by owner</div>
              ) : (
                ownerList.map((o) => (
                  <div key={o.owner} className="who-item">
                    <div>
                      <div className="who-item-title">{o.owner}</div>
                      <div className="who-item-detail">{o.count} expenses</div>
                    </div>
                    <div className="who-item-amount">{formatPaise(o.netPaise)}</div>
                  </div>
                ))
              )
            )}

            {activeWhoTab === 'account' && (
              accountList.length === 0 ? (
                <div className="empty-state-text">No data by account</div>
              ) : (
                accountList.map((a, idx) => {
                  const name = a.accountId
                    ? accountNameMap.get(a.accountId) || 'Unknown Account'
                    : 'Unassigned Account';
                  return (
                    <div key={a.accountId || `acc-${idx}`} className="who-item">
                      <div>
                        <div className="who-item-title">{name}</div>
                        <div className="who-item-detail">{a.count} expenses</div>
                      </div>
                      <div className="who-item-amount">{formatPaise(a.netPaise)}</div>
                    </div>
                  );
                })
              )
            )}

            {activeWhoTab === 'device' && (
              deviceList.length === 0 ? (
                <div className="empty-state-text">No data by device</div>
              ) : (
                deviceList.map((d, idx) => {
                  const label = d.deviceId
                    ? deviceLabelMap.get(d.deviceId) || d.deviceId
                    : 'Unknown Device';
                  return (
                    <div key={d.deviceId || `dev-${idx}`} className="who-item">
                      <div>
                        <div className="who-item-title">{label}</div>
                        <div className="who-item-detail">{d.count} expenses</div>
                      </div>
                      <div className="who-item-amount">{formatPaise(d.netPaise)}</div>
                    </div>
                  );
                })
              )
            )}
          </div>
        )}
      </section>
    </div>
  );
}

