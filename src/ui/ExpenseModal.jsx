import React, { useState } from 'react';
import { validateExpenseForm, buildCreateData, buildPatch } from '../core/forms/expenseForm.js';
import { getTodayIst } from '../core/format/dates.js';

export default function ExpenseModal({
  expense = null, // if present, edit mode; if null, add mode
  categories = [],
  accounts = [],
  brands = [],
  rules = [],
  writer,
  deviceId,
  onClose,
  onSuccess,
}) {
  const isEdit = Boolean(expense);

  const initialAmount = expense && typeof expense.amount_paise === 'number'
    ? (expense.amount_paise / 100).toString()
    : '';

  const [form, setForm] = useState({
    amount: initialAmount,
    date: expense?.date || getTodayIst(),
    direction: expense?.direction || 'debit',
    kind: expense?.kind || 'spend',
    categoryId: expense?.category_id || '',
    accountId: expense?.account_id || (accounts[0]?.id || ''),
    mode: expense?.mode || 'card',
    merchant: expense?.merchant_raw || '',
    note: expense?.note || '',
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
      onSuccess('Expense deleted');
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
                autoFocus
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

            {/* Mode & Merchant */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
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
            </div>

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

