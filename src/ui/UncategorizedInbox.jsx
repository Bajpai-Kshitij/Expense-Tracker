import React, { useState, useEffect } from 'react';
import { uncategorizedInbox } from '../core/db/queries.js';
import { formatPaise } from '../core/format/money.js';
import { formatDateDisplay } from '../core/format/dates.js';
import { suggestRule } from '../core/categorize/suggest.js';
import { compilePattern } from '../core/categorize/pattern.js';
import { findSimilar, planReapply, applyPlan } from '../core/categorize/categorize.js';

export default function UncategorizedInbox({
  db,
  writer,
  brands = [],
  rules = [],
  categories = [],
  accounts = [],
  onBack,
  showToast,
  onRefreshLookups,
}) {
  const [expenses, setExpenses] = useState([]);
  const [topCategories, setTopCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isApplyingAll, setIsApplyingAll] = useState(false);

  // Bottom Sheet for Rule Suggestion
  const [sheet, setSheet] = useState({
    open: false,
    expense: null,
    category: null,
    pattern: '',
    mode: 'words',
  });

  // "More..." Category Picker Modal
  const [morePickerExpense, setMorePickerExpense] = useState(null);

  const accountsMap = accounts.reduce((acc, a) => {
    acc[a.id] = a;
    return acc;
  }, {});

  const activeCategories = categories.filter((c) => !c.archived);

  const loadInboxData = async () => {
    if (!db) return;
    try {
      setLoading(true);
      // Query active uncategorized expenses, ordered newest first
      const list = await uncategorizedInbox(db);
      setExpenses(list);

      // Determine 6 most used categories
      const usageRows = await db.query(
        `SELECT category_id, COUNT(*) as cnt 
         FROM expenses 
         WHERE status = 'active' AND category_id IS NOT NULL 
         GROUP BY category_id 
         ORDER BY cnt DESC;`
      );

      const usedMap = new Set(usageRows.map((r) => r.category_id));
      const sortedActiveCats = [];

      // Add used categories in popularity order (filtering archived)
      for (const row of usageRows) {
        const cat = activeCategories.find((c) => c.id === row.category_id);
        if (cat && !sortedActiveCats.some((x) => x.id === cat.id)) {
          sortedActiveCats.push(cat);
        }
      }

      // Fill remaining slots up to 6 from other active categories
      for (const cat of activeCategories) {
        if (!usedMap.has(cat.id) && !sortedActiveCats.some((x) => x.id === cat.id)) {
          sortedActiveCats.push(cat);
        }
      }

      setTopCategories(sortedActiveCats.slice(0, 6));
    } catch (err) {
      console.error('Failed to load uncategorized inbox:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadInboxData();
  }, [db]);

  const totalPaise = expenses.reduce((sum, e) => sum + (e.amount_paise || 0), 0);

  // Handle category tap on an expense
  const handleSelectCategory = async (expense, category) => {
    if (!writer) return;

    const suggestion = suggestRule(expense.merchant_raw);
    if (!suggestion) {
      // No pattern suggested: directly assign category as locked
      try {
        await writer.write('expense.updated', {
          expenseId: expense.id,
          patch: { categoryId: category.id, category_locked: 1 },
        });
        showToast(`Categorized as ${category.name}`);
        await loadInboxData();
        if (onRefreshLookups) await onRefreshLookups();
      } catch (err) {
        console.error('Error assigning category:', err);
      }
      return;
    }

    // Open rule creation bottom sheet
    setSheet({
      open: true,
      expense,
      category,
      pattern: suggestion.pattern,
      mode: suggestion.mode,
    });
  };

  // Compile check & similar count for bottom sheet
  const patternValidation = sheet.open ? compilePattern({ pattern: sheet.pattern, mode: sheet.mode }) : { ok: false };
  let similarMatches = [];
  if (sheet.open && patternValidation.ok && sheet.expense) {
    const candidateExpenses = expenses.filter(
      (e) => e.id !== sheet.expense.id && !e.category_locked && (e.category_id === null || e.category_id === '')
    );
    similarMatches = findSimilar(
      candidateExpenses,
      { pattern: sheet.pattern, mode: sheet.mode },
      { brands, rules, accounts }
    );
  }

  // Create rule & apply to target + similar
  const handleCreateRuleAndApply = async () => {
    if (!writer || !sheet.expense || !sheet.category || !patternValidation.ok) return;

    try {
      const ruleId = `rule_${Date.now()}`;
      const priorities = rules.map((r) => r.priority).filter((p) => typeof p === 'number');
      const minPriority = priorities.length > 0 ? Math.min(...priorities) : 50;
      const newPriority = Math.max(1, minPriority - 10);

      const newRule = {
        id: ruleId,
        priority: newPriority,
        field: 'merchant',
        pattern: sheet.pattern.trim(),
        mode: sheet.mode,
        categoryId: sheet.category.id,
        kind: null,
        active: true,
        note: `Created from inbox for "${sheet.expense.merchant_raw || ''}"`,
      };

      // 1. Write rule
      await writer.write('rule.upserted', newRule);

      // 2. Lock target expense
      await writer.write('expense.updated', {
        expenseId: sheet.expense.id,
        patch: { categoryId: sheet.category.id, category_locked: 1 },
      });

      // 3. Batch apply to similar expenses (unlocked)
      for (const id of similarMatches) {
        await writer.write('expense.updated', {
          expenseId: id,
          patch: { categoryId: sheet.category.id, category_locked: 0 },
        });
      }

      const totalUpdated = similarMatches.length + 1;
      showToast(`Rule created! ${totalUpdated} ${totalUpdated === 1 ? 'expense' : 'expenses'} categorized.`);
      setSheet({ open: false, expense: null, category: null, pattern: '', mode: 'words' });
      await loadInboxData();
      if (onRefreshLookups) await onRefreshLookups();
    } catch (err) {
      console.error('Failed to create rule and apply:', err);
    }
  };

  // Assign only target expense
  const handleJustThisOne = async () => {
    if (!writer || !sheet.expense || !sheet.category) return;
    try {
      await writer.write('expense.updated', {
        expenseId: sheet.expense.id,
        patch: { categoryId: sheet.category.id, category_locked: 1 },
      });
      showToast(`Categorized as ${sheet.category.name}`);
      setSheet({ open: false, expense: null, category: null, pattern: '', mode: 'words' });
      await loadInboxData();
      if (onRefreshLookups) await onRefreshLookups();
    } catch (err) {
      console.error('Failed to update expense:', err);
    }
  };

  // Apply rules to all uncategorized
  const handleApplyRulesToAll = async () => {
    if (!writer || expenses.length === 0) return;
    try {
      setIsApplyingAll(true);
      const plan = planReapply(expenses, { brands, rules, accounts });
      if (plan.updates.length === 0) {
        alert('No uncategorized expenses matched any active rules.');
        return;
      }

      const confirmed = window.confirm(
        `Apply rules to all uncategorized?\n\nThis will automatically categorize ${plan.updates.length} ${
          plan.updates.length === 1 ? 'expense' : 'expenses'
        }.`
      );
      if (!confirmed) return;

      await applyPlan({ plan, writer });
      showToast(`Categorized ${plan.updates.length} expenses via rules.`);
      await loadInboxData();
      if (onRefreshLookups) await onRefreshLookups();
    } catch (err) {
      console.error('Failed to apply plan:', err);
    } finally {
      setIsApplyingAll(false);
    }
  };

  return (
    <div className="inbox-container">
      {/* Top Header Card */}
      <div className="card" style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '4px 10px', minHeight: '32px', fontSize: '0.85rem' }}
            onClick={onBack}
          >
            ← Back
          </button>
          <button
            type="button"
            className="btn btn-primary"
            style={{ padding: '6px 12px', minHeight: '34px', fontSize: '0.85rem' }}
            disabled={isApplyingAll || expenses.length === 0}
            onClick={handleApplyRulesToAll}
          >
            {isApplyingAll ? 'Applying...' : '⚡ Apply Rules to All'}
          </button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginTop: '6px' }}>
          <div>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800 }}>Uncategorized Inbox</h2>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              {expenses.length} {expenses.length === 1 ? 'item' : 'items'} needing category
            </div>
          </div>
          <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)' }}>
            {formatPaise(totalPaise)}
          </div>
        </div>
      </div>

      {/* Expense List */}
      {loading ? (
        <div className="state-box">
          <p>Loading uncategorized expenses...</p>
        </div>
      ) : expenses.length === 0 ? (
        <div className="state-box card">
          <div style={{ fontSize: '2.5rem', marginBottom: '10px' }}>🎉</div>
          <h3>Inbox Zero</h3>
          <p>All expenses are categorized. Great job!</p>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ marginTop: '14px' }}
            onClick={onBack}
          >
            Return to Home
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {expenses.map((exp) => {
            const accName = accountsMap[exp.account_id]?.name || '';
            const isCredit = exp.direction === 'credit';

            return (
              <div key={exp.id} className="card" style={{ padding: '12px 14px' }}>
                {/* Expense Details Row */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                      {exp.merchant_raw || exp.note || 'Unknown Merchant'}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      <span>{formatDateDisplay(exp.date)}</span>
                      {accName && <span> &bull; {accName}</span>}
                    </div>
                  </div>
                  <div className={`expense-amount ${isCredit ? 'credit' : 'debit'}`} style={{ fontSize: '1rem', fontWeight: 700 }}>
                    {isCredit ? '+' : ''}{formatPaise(exp.amount_paise)}
                  </div>
                </div>

                {/* Quick Category Chips */}
                <div className="category-chips-row">
                  {topCategories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      className="cat-chip"
                      onClick={() => handleSelectCategory(exp, cat)}
                    >
                      <span className="cat-chip-dot" style={{ backgroundColor: cat.color || '#94a3b8' }} />
                      <span>{cat.name}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className="cat-chip more-chip"
                    onClick={() => setMorePickerExpense(exp)}
                  >
                    More...
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bottom Sheet for Rule Suggestion */}
      {sheet.open && (
        <div className="modal-overlay" onClick={() => setSheet({ open: false, expense: null, category: null, pattern: '', mode: 'words' })}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Create Rule for Category?</h3>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '2px 8px', minHeight: '28px' }}
                onClick={() => setSheet({ open: false, expense: null, category: null, pattern: '', mode: 'words' })}
              >
                ✕
              </button>
            </div>

            <div className="modal-body">
              <p style={{ fontSize: '0.9rem', marginBottom: '14px', lineHeight: 1.4 }}>
                Create a rule for <strong>"{sheet.pattern}"</strong>?{' '}
                <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>
                  {similarMatches.length} similar uncategorized {similarMatches.length === 1 ? 'expense' : 'expenses'}
                </span>{' '}
                will also be assigned to <strong>{sheet.category?.name}</strong>.
              </p>

              {/* Editable Pattern Input */}
              <div className="form-group">
                <label className="form-label">Matcher Pattern</label>
                <input
                  type="text"
                  className={`form-input ${!patternValidation.ok ? 'error' : ''}`}
                  value={sheet.pattern}
                  onChange={(e) => setSheet((prev) => ({ ...prev, pattern: e.target.value }))}
                  placeholder="e.g. SWIGGY | SWIGGY INSTAMART"
                />
                {!patternValidation.ok ? (
                  <div className="error-msg">{patternValidation.reason}</div>
                ) : (
                  <div style={{ fontSize: '0.75rem', color: 'var(--success)', marginTop: '3px' }}>
                    ✓ Valid pattern ({similarMatches.length} similar matches)
                  </div>
                )}
              </div>

              {/* Mode Toggle */}
              <div className="form-group">
                <label className="form-label">Pattern Mode</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                  <button
                    type="button"
                    className={`btn ${sheet.mode === 'words' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ minHeight: '36px', fontSize: '0.85rem' }}
                    onClick={() => setSheet((prev) => ({ ...prev, mode: 'words' }))}
                  >
                    Words (Substrings)
                  </button>
                  <button
                    type="button"
                    className={`btn ${sheet.mode === 'regex' ? 'btn-primary' : 'btn-secondary'}`}
                    style={{ minHeight: '36px', fontSize: '0.85rem' }}
                    onClick={() => setSheet((prev) => ({ ...prev, mode: 'regex' }))}
                  >
                    Regular Expression
                  </button>
                </div>
              </div>
            </div>

            <div className="modal-footer" style={{ flexDirection: 'column', gap: '8px' }}>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%' }}
                disabled={!patternValidation.ok}
                onClick={handleCreateRuleAndApply}
              >
                Create Rule and Apply ({similarMatches.length + 1})
              </button>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', width: '100%' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleJustThisOne}
                >
                  Just This One
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setSheet({ open: false, expense: null, category: null, pattern: '', mode: 'words' })}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* "More..." All Categories Modal */}
      {morePickerExpense && (
        <div className="modal-overlay" onClick={() => setMorePickerExpense(null)}>
          <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Select Category</h3>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ padding: '2px 8px', minHeight: '28px' }}
                onClick={() => setMorePickerExpense(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                {activeCategories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    className="btn btn-secondary"
                    style={{
                      justifyContent: 'flex-start',
                      padding: '10px 12px',
                      fontSize: '0.85rem',
                      textAlign: 'left',
                    }}
                    onClick={() => {
                      const exp = morePickerExpense;
                      setMorePickerExpense(null);
                      handleSelectCategory(exp, cat);
                    }}
                  >
                    <span className="cat-chip-dot" style={{ backgroundColor: cat.color || '#94a3b8' }} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {cat.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

