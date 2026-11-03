import React, { useState } from 'react';
import {
  validateAccountForm,
  buildAccountUpsert,
  buildArchive,
  buildRestore,
} from '../core/accounts/accountForm.js';

export default function AccountsScreen({
  accounts = [],
  writer,
  onBack,
  showToast = () => {},
  onReloadLookups = () => {},
}) {
  const [modalMode, setModalMode] = useState(null); // 'add' | 'edit' | null
  const [editingAccount, setEditingAccount] = useState(null);
  const [form, setForm] = useState({
    name: '',
    owner: 'Me',
    type: 'card',
    issuer: '',
    digits: '',
  });
  const [errors, setErrors] = useState({});
  const [showArchived, setShowArchived] = useState(false);

  const activeAccounts = accounts.filter((a) => !a.archived && a.archived !== 1 && a.archived !== true);
  const archivedAccounts = accounts.filter((a) => a.archived === 1 || a.archived === true);

  const handleOpenAdd = () => {
    setForm({
      name: '',
      owner: 'Me',
      type: 'card',
      issuer: '',
      digits: '',
    });
    setErrors({});
    setEditingAccount(null);
    setModalMode('add');
  };

  const handleOpenEdit = (acc) => {
    setForm({
      name: acc.name || '',
      owner: acc.owner || 'Me',
      type: acc.type || 'card',
      issuer: acc.issuer || '',
      digits: acc.digits || acc.lastDigits || '',
    });
    setErrors({});
    setEditingAccount(acc);
    setModalMode('edit');
  };

  const handleCloseModal = () => {
    setModalMode(null);
    setEditingAccount(null);
    setErrors({});
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!writer) return;

    const currentId = editingAccount?.id || editingAccount?.accountId || null;
    const validation = validateAccountForm(form, accounts, currentId);

    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }

    try {
      const upsertData = buildAccountUpsert(validation.value, editingAccount);
      await writer.write('account.upserted', upsertData);

      showToast(modalMode === 'add' ? 'Account created' : 'Account updated');
      handleCloseModal();
      if (onReloadLookups) {
        await onReloadLookups();
      }
    } catch (err) {
      setErrors({ form: err.message });
    }
  };

  const handleArchive = async (acc) => {
    const confirmed = window.confirm(`Archive "${acc.name}"? It will not appear in new transaction pickers.`);
    if (!confirmed || !writer) return;

    try {
      const archiveData = buildArchive(acc);
      await writer.write('account.upserted', archiveData);
      showToast(`Archived "${acc.name}"`);
      if (onReloadLookups) {
        await onReloadLookups();
      }
    } catch (err) {
      showToast(`Archive failed: ${err.message}`);
    }
  };

  const handleRestore = async (acc) => {
    if (!writer) return;
    try {
      const restoreData = buildRestore(acc);
      await writer.write('account.upserted', restoreData);
      showToast(`Restored "${acc.name}"`);
      if (onReloadLookups) {
        await onReloadLookups();
      }
    } catch (err) {
      showToast(`Restore failed: ${err.message}`);
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button type="button" className="btn btn-secondary" onClick={onBack}>
            ← Back
          </button>
          <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>Accounts</h2>
        </div>
        <button type="button" className="btn btn-primary" onClick={handleOpenAdd}>
          + Add Account
        </button>
      </div>

      {/* Active Accounts List */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-header">
          <span className="card-title">Active Accounts ({activeAccounts.length})</span>
        </div>

        {activeAccounts.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>No active accounts found.</p>
        ) : (
          <div>
            {activeAccounts.map((acc) => {
              const digits = acc.digits || acc.lastDigits;
              return (
                <div
                  key={acc.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 0',
                    borderBottom: '1px solid var(--border-color)',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{acc.name}</div>
                    <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                      <span
                        style={{
                          fontSize: '0.7rem',
                          background: 'var(--bg-secondary)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontWeight: 600,
                        }}
                      >
                        {acc.owner || 'Me'}
                      </span>
                      <span
                        style={{
                          fontSize: '0.7rem',
                          background: 'var(--bg-secondary)',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          textTransform: 'capitalize',
                        }}
                      >
                        {acc.type || 'card'}
                      </span>
                      {digits && (
                        <span
                          style={{
                            fontSize: '0.7rem',
                            color: 'var(--text-secondary)',
                            padding: '2px 4px',
                          }}
                        >
                          XX{digits}
                        </span>
                      )}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                      onClick={() => handleOpenEdit(acc)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '4px 8px', color: 'var(--danger)' }}
                      onClick={() => handleArchive(acc)}
                    >
                      Archive
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Collapsed Section for Archived Accounts */}
      {archivedAccounts.length > 0 && (
        <div className="card">
          <div
            onClick={() => setShowArchived(!showArchived)}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              cursor: 'pointer',
            }}
          >
            <span style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
              Archived Accounts ({archivedAccounts.length})
            </span>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              {showArchived ? '▲' : '▼'}
            </span>
          </div>

          {showArchived && (
            <div style={{ marginTop: '12px' }}>
              {archivedAccounts.map((acc) => {
                const digits = acc.digits || acc.lastDigits;
                return (
                  <div
                    key={acc.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 0',
                      borderBottom: '1px solid var(--border-color)',
                      opacity: 0.75,
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>{acc.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        {acc.owner} · {acc.type} {digits ? `· XX${digits}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: '0.75rem', padding: '4px 8px' }}
                      onClick={() => handleRestore(acc)}
                    >
                      Restore
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Add / Edit Account Modal */}
      {modalMode && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '420px', width: '100%' }}>
            <div className="modal-header">
              <h3>{modalMode === 'add' ? 'Add Account' : 'Edit Account'}</h3>
              <button type="button" className="close-btn" onClick={handleCloseModal}>✕</button>
            </div>
            <form onSubmit={handleSubmit} style={{ padding: '16px' }}>
              {errors.form && (
                <div className="alert-banner alert-danger" style={{ marginBottom: '12px' }}>
                  {errors.form}
                </div>
              )}

              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label className="form-label">Account Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Axis Flipkart 3765"
                />
                {errors.name && <span className="field-error">{errors.name}</span>}
              </div>

              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label className="form-label">Owner</label>
                <select
                  className="form-input"
                  value={form.owner}
                  onChange={(e) => setForm({ ...form, owner: e.target.value })}
                >
                  <option value="Me">Me</option>
                  <option value="Wife">Wife</option>
                  <option value="Joint">Joint</option>
                </select>
                {errors.owner && <span className="field-error">{errors.owner}</span>}
              </div>

              <div className="form-group" style={{ marginBottom: '12px' }}>
                <label className="form-label">Account Type</label>
                <select
                  className="form-input"
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                >
                  <option value="card">Card</option>
                  <option value="bank">Bank</option>
                  <option value="cash">Cash</option>
                </select>
                {errors.type && <span className="field-error">{errors.type}</span>}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                <div className="form-group">
                  <label className="form-label">Issuer</label>
                  <input
                    type="text"
                    className="form-input"
                    value={form.issuer}
                    onChange={(e) => setForm({ ...form, issuer: e.target.value })}
                    placeholder="e.g. Axis, HDFC"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Digits (3 or 4)</label>
                  <input
                    type="text"
                    className="form-input"
                    value={form.digits}
                    onChange={(e) => setForm({ ...form, digits: e.target.value })}
                    placeholder="e.g. 7068"
                  />
                  {errors.digits && <span className="field-error">{errors.digits}</span>}
                </div>
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                {modalMode === 'add' ? 'Create Account' : 'Save Changes'}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

