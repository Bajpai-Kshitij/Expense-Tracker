import React, { useState, useEffect, useCallback } from 'react';
import { listExpenses } from '../core/db/queries.js';
import { buildEmiPlans } from '../core/emi/plans.js';
import { formatPaise } from '../core/format/money.js';

function formatEndsDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const parts = dateStr.slice(0, 10).split('-');
  if (parts.length < 2) return dateStr;
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const year = parts[0];
  if (monthIdx >= 0 && monthIdx < 12) {
    return `${monthNames[monthIdx]} ${year}`;
  }
  return dateStr;
}

export default function EmiScreen({ db, onBack, showToast = () => {} }) {
  const [plans, setPlans] = useState([]);
  const [monthlyCommitmentPaise, setMonthlyCommitmentPaise] = useState(0);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    if (!db) return;
    try {
      setLoading(true);
      const expenses = await listExpenses(db);
      const emiData = buildEmiPlans(expenses, new Date());
      setPlans(emiData.plans || []);
      setMonthlyCommitmentPaise(emiData.monthlyCommitmentPaise || 0);
    } catch (err) {
      showToast(err?.message || 'Failed to load EMI plans');
    } finally {
      setLoading(false);
    }
  }, [db, showToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  return (
    <div className="tab-pane active" style={{ padding: '16px', maxWidth: '600px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px', gap: '12px' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onBack}
          style={{ padding: '6px 12px', fontSize: '0.9rem' }}
        >
          ← Back
        </button>
        <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700 }}>Loans & EMIs</h2>
      </div>

      {/* Monthly Commitment Banner */}
      <div
        className="card"
        style={{
          background: 'var(--primary-subtle, #f0f7ff)',
          border: '1px solid var(--primary-border, #bae0ff)',
          borderRadius: '8px',
          padding: '16px',
          marginBottom: '20px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
          Monthly EMI commitment
        </div>
        <div style={{ fontSize: '1.75rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '4px' }}>
          {formatPaise(monthlyCommitmentPaise)}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '32px', color: 'var(--text-secondary)' }}>
          Loading active EMI plans...
        </div>
      ) : plans.length === 0 ? (
        <div
          className="card"
          style={{
            textAlign: 'center',
            padding: '36px 16px',
            color: 'var(--text-secondary)',
            borderRadius: '8px',
          }}
        >
          <div style={{ fontSize: '2rem', marginBottom: '8px' }}>💳</div>
          <p style={{ margin: 0, fontWeight: 500 }}>No EMIs found yet. Import a statement.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {plans.map((plan) => {
            const formattedEnds = plan.finishDate ? formatEndsDate(plan.finishDate) : null;
            return (
              <div
                key={plan.planKey}
                className="card"
                style={{
                  padding: '16px',
                  borderRadius: '8px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {plan.merchant || 'EMI Purchase'}
                  </h3>
                  <span
                    style={{
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      background: 'var(--tag-bg, #e2e8f0)',
                      padding: '2px 8px',
                      borderRadius: '12px',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    Installment {plan.emiNo} of {plan.emiTotal}
                  </span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                  <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Monthly</span>
                  <span style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                    {formatPaise(plan.monthlyPaise)}
                  </span>
                </div>

                {formattedEnds && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Status</span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      Ends {formattedEnds}
                    </span>
                  </div>
                )}

                {plan.outstandingPaise > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Outstanding</span>
                    <span style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {formatPaise(plan.outstandingPaise)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
