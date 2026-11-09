import React, { useState, useEffect } from 'react';
import { validateExpenseForm, buildCreateData, buildPatch } from '../core/forms/expenseForm.js';
import { getTodayIst } from '../core/format/dates.js';
import { getExpenseExtras } from '../core/db/index.js';
import { buildMerchantIgnoreRule } from '../core/ingest/userIgnore.js';
import { buildPayeeBrand, extractUpiId, planPayeeRename } from '../core/payees/payees.js';

export default function ExpenseModal({
  expense = null, // if present, edit mode; if null, add mode
  initialValues = {},
  categories = [],
  accounts = [],
  brands = [],
  rules = [],
  writer,
  db,
  deviceId,
  onClose,
  onSuccess,
}) {
  const isEdit = Boolean(expense);
  const isSmsImported = isEdit && expense?.source === 'sms';
  const isStatement = isEdit && expense?.source === 'statement';
  const rawHash = isEdit ? getExpenseExtras(expense).rawHash : null;
  const [originalSms, setOriginalSms] = useState(initialValues?.sourceText || null);
  const [payeeName, setPayeeName] = useState(expense?.brand || '');
  const merchantRaw = expense?.merchant_raw || '';
  const upiId = extractUpiId(merchantRaw);

  useEffect(() => {
    if (!db || !rawHash) return undefined;
    let active = true;
    db.query('SELECT body FROM raw_messages WHERE hash = ? LIMIT 1;', [rawHash])
      .then((rows) => {
        if (active) setOriginalSms(rows[0]?.body || null);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [db, rawHash]);

  const initialAmount = expense && typeof expense.amount_paise === 'number'
    ? (expense.amount_paise / 100).toString()
    : (initialValues?.amount || '');

  const [form, setForm] = useState({
    amount: initialAmount,
    date: expense?.date || initialValues?.date || getTodayIst(),
    direction: expense?.direction || initialValues?.direction || 'debit',
    kind: expense?.kind || initialValues?.kind || 'spend',
    categoryId: expense?.category_id || initialValues?.categoryId || '',
    accountId: expense?.account_id || initialValues?.accountId || (accounts[0]?.id || ''),
    mode: expense?.mode || initialValues?.mode || 'card',
    merchant: expense?.merchant_raw || initialValues?.merchant || '',
    note: expense?.note || initialValues?.note || '',
  });

  const [errors, setErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!writer) return;

    if (isSmsImported) {
      const amountChanged = form.amount !== initialAmount;
      const dateChanged = form.date !== expense.date;
      if (amountChanged || dateChanged) {
        const confirmed = window.confirm('This was imported from your message. Change it anyway?');
        if (!confirmed) return;
      }
    }

    const validation = validateExpenseForm(form);
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }

    try {
      setIsSaving(true);
      if (isEdit) {
        const patch = buildPatch(expense, validation.value);
        if (patch) {
          await writer.write('expense.updated', {
            expenseId: expense.id,
            patch,
          });
          onSuccess('Expense updated successfully');
        } else {
          onClose();
        }
      } else {
        const createData = buildCreateData(validation.value, {
          deviceId,
          brands,
          rules,
          accounts,
        });
        await writer.write('expense.created', createData);
        onSuccess('Expense created successfully');
      }
    } catch (err) {
      setErrors({ form: err.message });
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!isEdit || !expense || !writer) return;
    const confirmed = window.confirm('Are you sure you want to delete this expense?');
    if (!confirmed) return;

    try {
      setIsSaving(true);
      await writer.write('expense.deleted', {
        expenseId: expense.id,
      });
      if (isSmsImported && merchantRaw && window.confirm(`Also skip future SMS for "${merchantRaw}"?`)) {
        await writer.write('rule.upserted', buildMerchantIgnoreRule({ merchant: merchantRaw }));
      }
      onSuccess('Expense deleted');
    } catch (err) {
      setErrors({ form: err.message });
      setIsSaving(false);
    }
  };

  const handleSavePayee = async () => {
    const name = payeeName.trim();
    if (!name || !merchantRaw || !writer || !db) return;
    try {
      setIsSaving(true);
      await writer.write('brand.upserted', buildPayeeBrand({ merchant: merchantRaw, name }));
      const rows = await db.query('SELECT * FROM expenses;');
      const updates = planPayeeRename(rows, merchantRaw, name);
      if (updates.length > 0) await writer.writeMany(updates);
      onSuccess(`Saved "${name}" for ${updates.length} ${updates.length === 1 ? 'expense' : 'expenses'}`);
    } catch (err) {
      setErrors({ form: err.message });
      setIsSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{isEdit ? 'Edit Expense' : 'Add Expense'}</h2>
          <button type="button" className="btn btn-secondary" style={{ padding: '4px 10px', minHeight: '32px' }} onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body">
            {isSmsImported && (
              <div style={{ fontSize: '0.8rem', color: '#38bdf8', marginBottom: '12px', background: 'var(--bg-secondary)', padding: '6px 10px', borderRadius: '4px' }}>
                Imported from SMS{expense.ref_no || expense.refNo ? ` · ref ${expense.ref_no || expense.refNo}` : ''}
              </div>
            )}

            {(originalSms || isSmsImported) && (
              <div style={{ marginBottom: '12px' }}>
                <div className="form-label">Original SMS</div>
                <div style={{ background: 'var(--bg-secondary)', padding: '10px', borderRadius: '6px', fontSize: '0.85rem', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                  {originalSms || 'This message is on the other phone, or was removed from this one.'}
                </div>
              </div>
            )}

            {isStatement && !originalSms && (
              <div style={{ background: 'var(--bg-secondary)', padding: '10px', borderRadius: '6px', fontSize: '0.85rem', marginBottom: '12px', overflowWrap: 'anywhere' }}>
                From card statement: {merchantRaw}
              </div>
            )}

            {errors.form && (
              <div className="alert-banner alert-danger">
                <span>{errors.form}</span>
              </div>
            )}

            {/* Amount input */}
            <div className="form-group">
              <label className="form-label">Amount (₹)</label>
              <input
                type="text"
                inputMode="decimal"
                autoFocus={!isEdit}
                className={`form-input ${errors.amount ? 'error' : ''}`}
                placeholder="e.g. 1,250.50"
                value={form.amount}
                onChange={(e) => handleChange('amount', e.target.value)}
              />
              {errors.amount && <div className="error-msg">{errors.amount}</div>}
            </div>

            {/* Direction & Kind */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div className="form-group">
                <label className="form-label">Direction</label>
                <select
                  className="form-select"
                  value={form.direction}
                  onChange={(e) => handleChange('direction', e.target.value)}
                >
                  <option value="debit">Debit (Spent)</option>
                  <option value="credit">Credit (Refund/Income)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Kind</label>
                <select
                  className="form-select"
                  value={form.kind}
                  onChange={(e) => handleChange('kind', e.target.value)}
                >
                  <option value="spend">Spend</option>
                  <option value="fixed">Fixed</option>
                  <option value="transfer">Transfer</option>
                  <option value="income">Income</option>
                </select>
              </div>
            </div>

            {/* Date */}
            <div className="form-group">
              <label className="form-label">Date (YYYY-MM-DD)</label>
              <input
                type="date"
                className={`form-input ${errors.date ? 'error' : ''}`}
                value={form.date}
                onChange={(e) => handleChange('date', e.target.value)}
              />
              {errors.date && <div className="error-msg">{errors.date}</div>}
            </div>

            {/* Category & Account */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div className="form-group">
                <label className="form-label">Category</label>
                <select
                  className="form-select"
                  value={form.categoryId}
                  onChange={(e) => handleChange('categoryId', e.target.value)}
                >
                  <option value="">(Uncategorized)</option>
                  {categories.filter((c) => !c.archived).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <label className="form-label">Account</label>
                <select
                  className="form-select"
                  value={form.accountId}
                  onChange={(e) => handleChange('accountId', e.target.value)}
                >
                  <option value="">(None)</option>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Mode */}
            <div>
              <div className="form-group">
                <label className="form-label">Payment Mode</label>
                <select
                  className="form-select"
                  value={form.mode}
                  onChange={(e) => handleChange('mode', e.target.value)}
                >
                  <option value="card">Card</option>
                  <option value="upi">UPI</option>
                  <option value="cash">Cash</option>
                  <option value="netbanking">Netbanking</option>
                  <option value="other">Other</option>
                </select>
              </div>

            </div>

            {/* Merchant gets the full width so long names and UPI ids stay readable */}
            <div className="form-group">
              <label className="form-label">Merchant / Payee</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Swiggy, Uber"
                value={form.merchant}
                onChange={(e) => handleChange('merchant', e.target.value)}
              />
            </div>

            {isEdit && merchantRaw && (
              <div className="form-group">
                <label className="form-label">Name this payee (both phones, past and future)</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="e.g. Corner Shop"
                    value={payeeName}
                    onChange={(e) => setPayeeName(e.target.value)}
                  />
                  <button type="button" className="btn btn-secondary" disabled={isSaving || !payeeName.trim()} onClick={handleSavePayee}>
                    Save name
                  </button>
                </div>
                {upiId && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '4px', overflowWrap: 'anywhere' }}>
                    UPI ID: {upiId}. To see the registered name, enter this ID in any UPI app; it shows the name before you pay.
                  </div>
                )}
              </div>
            )}

            {/* Note */}
            <div className="form-group">
              <label className="form-label">Note (Optional)</label>
              <input
                type="text"
                className="form-input"
                placeholder="Optional details"
                value={form.note}
                onChange={(e) => handleChange('note', e.target.value)}
              />
            </div>
          </div>

          <div className="modal-footer">
            {isEdit && (
              <button
                type="button"
                className="btn btn-danger"
                style={{ marginRight: 'auto' }}
                disabled={isSaving}
                onClick={handleDelete}
              >
                Delete
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={isSaving}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSaving}
            >
              {isSaving ? 'Saving...' : (isEdit ? 'Update' : 'Save')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

