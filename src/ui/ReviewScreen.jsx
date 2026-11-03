import React, { useState, useEffect } from 'react';
import { listReviewItems, countOpenReviewItems, markReviewResolved } from '../core/db/reviewQueue.js';
import {
  groupReviewItems,
  describeUnknownAccount,
  describeDuplicate,
  describeUnparsed,
} from '../core/review/viewModels.js';
import {
  assignAccountAlias,
  resolveDuplicate,
  dismissUnparsed,
} from '../core/ingest/review.js';
import { validateAccountForm, buildAccountUpsert } from '../core/accounts/accountForm.js';
import { rowsToState } from '../core/db/index.js';
import { formatPaise } from '../core/format/money.js';
import { formatDateDisplay } from '../core/format/dates.js';

export default function ReviewScreen({
  db,
  writer,
  accounts = [],
  categoriesMap = {},
  accountsMap = {},
  onBack,
  onAddManually,
  showToast = () => {},
  onReloadLookups = () => {},
}) {
  const [activeTab, setActiveTab] = useState('unknown_accounts'); // 'unknown_accounts' | 'duplicates' | 'unparsed'
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState([]);
  const [allExpenses, setAllExpenses] = useState({});
  const [heldCountMap, setHeldCountMap] = useState({});

  // Selected account for each unknown account item: { [itemId]: accountId }
  const [selectedAccountForUnknown, setSelectedAccountForUnknown] = useState({});

  // New account form state for unknown account resolution
  const [creatingAccountForItem, setCreatingAccountForItem] = useState(null); // item being resolved with new account
  const [newAccForm, setNewAccForm] = useState({ name: '', owner: 'Me', type: 'card', issuer: '', digits: '' });
  const [newAccErrors, setNewAccErrors] = useState({});

  // Selected candidate index for duplicate items with multiple manual candidates: { [itemId]: candidateId }
  const [selectedDuplicateCandidate, setSelectedDuplicateCandidate] = useState({});

  // Revealed full texts for unparsed items: { [itemId]: string }
  const [revealedTexts, setRevealedTexts] = useState({});

  const loadData = async () => {
    if (!db) return;
    try {
      setLoading(true);
      const rawItems = await listReviewItems(db);
      setItems(rawItems);

      // Load expenses map for duplicate matching
      const expRows = await db.query('SELECT * FROM expenses;');
      const expMap = {};
      for (const e of expRows) {
        expMap[e.id] = e;
      }
      setAllExpenses(expMap);

      // Compute held message count per stableKey or issuer+digits
      const rawRows = await db.query("SELECT parsed FROM raw_messages WHERE kind = 'parsed';");
      const heldCounts = {};
      for (const r of rawRows) {
        try {
          const parsed = JSON.parse(r.parsed || '{}');
          if (!parsed.accountId) {
            const issuer = parsed.accountHint?.issuer || '';
            const digits = parsed.accountHint?.digits || parsed.accountHint?.product || '';
            const key = `${issuer}|${digits}`;
            heldCounts[key] = (heldCounts[key] || 0) + 1;
          }
        } catch {}
      }
      setHeldCountMap(heldCounts);
    } catch (err) {
      console.error('Failed to load review queue:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [db]);

  const grouped = groupReviewItems(items);

  // 1. Unknown Account Resolution: "Use this account"
  const handleAssignAlias = async (item, targetAccountId) => {
    if (!targetAccountId) {
      showToast('Please select an account');
      return;
    }
    const issuer = item.payload?.issuer;
    const digits = item.payload?.digits || item.payload?.product;

    try {
      const state = rowsToState({
        expenses: await db.query('SELECT * FROM expenses;'),
        categories: await db.query('SELECT * FROM categories;'),
        accounts: await db.query('SELECT * FROM accounts;'),
        brands: await db.query('SELECT * FROM brands;'),
        rules: await db.query('SELECT * FROM rules;'),
        review_queue: await db.query('SELECT * FROM review_queue;'),
      });

      const summary = await assignAccountAlias({
        accountId: targetAccountId,
        issuer,
        digits,
        writer,
        state,
        db,
      });

      const createdCount = summary?.created || 0;
      showToast(`Assigned account! Created ${createdCount} ${createdCount === 1 ? 'expense' : 'expenses'}`);

      if (onReloadLookups) await onReloadLookups();
      await loadData();
    } catch (err) {
      console.error('Failed to assign account alias:', err);
      showToast(`Failed: ${err.message}`);
    }
  };

  // 2. Unknown Account: "Create new account"
  const handleOpenCreateAccount = (item) => {
    const rawIssuer = item.payload?.issuer || '';
    const digits = item.payload?.digits || '';
    let defName = '';
    if (rawIssuer && digits) {
      defName = `${rawIssuer.toUpperCase()} ending ${digits}`;
    }

    setNewAccForm({
      name: defName,
      owner: 'Me',
      type: 'card',
      issuer: rawIssuer,
      digits,
    });
    setNewAccErrors({});
    setCreatingAccountForItem(item);
  };

  const handleSaveNewAccountAndAssign = async (e) => {
    e.preventDefault();
    if (!creatingAccountForItem) return;

    const validation = validateAccountForm(newAccForm, accounts);
    if (!validation.ok) {
      setNewAccErrors(validation.errors);
      return;
    }

    try {
      const upsertData = buildAccountUpsert(validation.value);
      await writer.write('account.upserted', upsertData);

      // Now assign the alias and reprocess
      const item = creatingAccountForItem;
      const issuer = item.payload?.issuer;
      const digits = item.payload?.digits || item.payload?.product;

      const state = rowsToState({
        expenses: await db.query('SELECT * FROM expenses;'),
        categories: await db.query('SELECT * FROM categories;'),
        accounts: await db.query('SELECT * FROM accounts;'),
        brands: await db.query('SELECT * FROM brands;'),
        rules: await db.query('SELECT * FROM rules;'),
        review_queue: await db.query('SELECT * FROM review_queue;'),
      });

      const summary = await assignAccountAlias({
        accountId: upsertData.id,
        issuer,
        digits,
        writer,
        state,
        db,
      });

      const createdCount = summary?.created || 0;
      showToast(`Created account & imported ${createdCount} ${createdCount === 1 ? 'expense' : 'expenses'}`);

      setCreatingAccountForItem(null);
      if (onReloadLookups) await onReloadLookups();
      await loadData();
    } catch (err) {
      setNewAccErrors({ form: err.message });
    }
  };

  // 3. Duplicate Resolution: Merge
  const handleResolveDuplicateMerge = async (item, desc) => {
    const candidateId = selectedDuplicateCandidate[item.id] || desc.manual[0]?.id;
    if (!candidateId) return;

    try {
      const state = rowsToState({
        expenses: await db.query('SELECT * FROM expenses;'),
        categories: await db.query('SELECT * FROM categories;'),
        accounts: await db.query('SELECT * FROM accounts;'),
        brands: await db.query('SELECT * FROM brands;'),
        rules: await db.query('SELECT * FROM rules;'),
        review_queue: await db.query('SELECT * FROM review_queue;'),
      });

      await resolveDuplicate({
        reviewId: item.id,
        decision: 'merge',
        keepId: desc.imported.id,
        dropId: candidateId,
        writer,
        state,
        db,
      });

      showToast('Merged expenses');
      if (onReloadLookups) await onReloadLookups();
      await loadData();
    } catch (err) {
      console.error('Failed to merge duplicate:', err);
      showToast(`Failed: ${err.message}`);
    }
  };

  // 4. Duplicate Resolution: Keep Both
  const handleResolveDuplicateKeepBoth = async (item) => {
    try {
      await resolveDuplicate({
        reviewId: item.id,
        decision: 'keep_both',
        writer,
        db,
      });

      showToast('Kept both expenses');
      if (onReloadLookups) await onReloadLookups();
      await loadData();
    } catch (err) {
      console.error('Failed to keep both expenses:', err);
      showToast(`Failed: ${err.message}`);
    }
  };

  // 5. Remove Stale Item
  const handleRemoveStale = async (item) => {
    try {
      await markReviewResolved(db, item.id);
      showToast('Removed item');
      await loadData();
    } catch (err) {
      showToast(`Failed: ${err.message}`);
    }
  };

  // 6. Unparsed: Show full text
  const handleRevealFullText = async (item) => {
    const rawHash = item.payload?.rawHash;
    if (!rawHash) return;

    try {
      const rows = await db.query('SELECT body FROM raw_messages WHERE hash = ? LIMIT 1;', [rawHash]);
      const body = rows[0]?.body || '(Body not found)';
      setRevealedTexts((prev) => ({ ...prev, [item.id]: body }));
    } catch (err) {
      console.error('Failed to retrieve full body:', err);
    }
  };

  // 7. Unparsed: Dismiss
  const handleDismissUnparsed = async (item) => {
    try {
      await dismissUnparsed({
        reviewId: item.id,
        writer,
        db,
      });

      showToast('Dismissed unparsed message');
      await loadData();
    } catch (err) {
      showToast(`Failed: ${err.message}`);
    }
  };

  // 8. Copy masked text
  const handleCopyMasked = async (desc) => {
    try {
      await navigator.clipboard.writeText(desc.preview);
      showToast('Copied masked text to clipboard');
    } catch (err) {
      showToast('Failed to copy');
    }
  };

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px', gap: '8px' }}>
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          ← Back
        </button>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>Review Queue</h2>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', marginBottom: '16px' }}>
        <button
          type="button"
          onClick={() => setActiveTab('unknown_accounts')}
          style={{
            flex: 1,
            padding: '10px 4px',
            border: 'none',
            background: 'none',
            borderBottom: activeTab === 'unknown_accounts' ? '2px solid var(--accent-primary)' : 'none',
            color: activeTab === 'unknown_accounts' ? 'var(--accent-primary)' : 'var(--text-secondary)',
            fontWeight: activeTab === 'unknown_accounts' ? 700 : 500,
            fontSize: '0.85rem',
            cursor: 'pointer',
          }}
        >
          Unknown Accounts ({grouped.counts.unknownAccounts})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('duplicates')}
          style={{
            flex: 1,
            padding: '10px 4px',
            border: 'none',
            background: 'none',
            borderBottom: activeTab === 'duplicates' ? '2px solid var(--accent-primary)' : 'none',
            color: activeTab === 'duplicates' ? 'var(--accent-primary)' : 'var(--text-secondary)',
            fontWeight: activeTab === 'duplicates' ? 700 : 500,
            fontSize: '0.85rem',
            cursor: 'pointer',
          }}
        >
          Duplicates ({grouped.counts.possibleDuplicates})
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('unparsed')}
          style={{
            flex: 1,
            padding: '10px 4px',
            border: 'none',
            background: 'none',
            borderBottom: activeTab === 'unparsed' ? '2px solid var(--accent-primary)' : 'none',
            color: activeTab === 'unparsed' ? 'var(--accent-primary)' : 'var(--text-secondary)',
            fontWeight: activeTab === 'unparsed' ? 700 : 500,
            fontSize: '0.85rem',
            cursor: 'pointer',
          }}
        >
          Unparsed ({grouped.counts.unparsed})
        </button>
      </div>

      {loading ? (
        <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '24px' }}>Loading review queue...</p>
      ) : null}

      {/* TAB 1: Unknown Accounts */}
      {!loading && activeTab === 'unknown_accounts' && (
        <div>
          {grouped.unknownAccounts.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>
              ✓ No unknown accounts waiting for assignment.
            </div>
          ) : (
            grouped.unknownAccounts.map((item) => {
              const digitsOrProd = item.payload?.digits || item.payload?.product || '';
              const stableKey = `${item.payload?.issuer || ''}|${digitsOrProd}`;
              const waitingCount = heldCountMap[stableKey] || 1;
              const desc = describeUnknownAccount(item, waitingCount, accounts);

              const selectedAccId = selectedAccountForUnknown[item.id] || desc.suggestions[0]?.id || '';

              return (
                <div key={item.id} className="card" style={{ marginBottom: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px' }}>
                    <h3 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>{desc.title}</h3>
                    <span style={{ fontSize: '0.8rem', color: 'var(--accent-primary)', fontWeight: 600 }}>
                      {desc.subtitle}
                    </span>
                  </div>

                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                    Link these messages to an existing account or create a new one.
                  </p>

                  <div style={{ marginBottom: '12px' }}>
                    <label className="form-label" style={{ fontSize: '0.8rem' }}>Choose Account</label>
                    <select
                      className="form-input"
                      value={selectedAccId}
                      onChange={(e) => setSelectedAccountForUnknown({ ...selectedAccountForUnknown, [item.id]: e.target.value })}
                    >
                      {desc.suggestions.map((acc) => (
                        <option key={acc.id} value={acc.id}>
                          {acc.name} ({acc.owner} · {acc.type}{acc.lastDigits ? ` · XX${acc.lastDigits}` : ''})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleAssignAlias(item, selectedAccId)}
                    >
                      Use this account
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => handleOpenCreateAccount(item)}
                    >
                      Create new account
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Modal / Dialog for Creating New Account */}
      {creatingAccountForItem && (
        <div className="modal-backdrop">
          <div className="modal-content" style={{ maxWidth: '420px', width: '100%' }}>
            <div className="modal-header">
              <h3>Create & Assign Account</h3>
              <button type="button" className="close-btn" onClick={() => setCreatingAccountForItem(null)}>✕</button>
            </div>
            <form onSubmit={handleSaveNewAccountAndAssign} style={{ padding: '16px' }}>
              {newAccErrors.form && (
                <div className="alert-banner alert-danger" style={{ marginBottom: '12px' }}>
                  {newAccErrors.form}
                </div>
              )}

              <div className="form-group" style={{ marginBottom: '10px' }}>
                <label className="form-label">Account Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={newAccForm.name}
                  onChange={(e) => setNewAccForm({ ...newAccForm, name: e.target.value })}
                  placeholder="e.g. ICICI Coral 7922"
                />
                {newAccErrors.name && <span className="field-error">{newAccErrors.name}</span>}
              </div>

              <div className="form-group" style={{ marginBottom: '10px' }}>
                <label className="form-label">Owner</label>
                <select
                  className="form-input"
                  value={newAccForm.owner}
                  onChange={(e) => setNewAccForm({ ...newAccForm, owner: e.target.value })}
                >
                  <option value="Me">Me</option>
                  <option value="Wife">Wife</option>
                  <option value="Joint">Joint</option>
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: '10px' }}>
                <label className="form-label">Type</label>
                <select
                  className="form-input"
                  value={newAccForm.type}
                  onChange={(e) => setNewAccForm({ ...newAccForm, type: e.target.value })}
                >
                  <option value="card">Card</option>
                  <option value="bank">Bank</option>
                  <option value="cash">Cash</option>
                </select>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                <div className="form-group">
                  <label className="form-label">Issuer</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newAccForm.issuer}
                    onChange={(e) => setNewAccForm({ ...newAccForm, issuer: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Digits</label>
                  <input
                    type="text"
                    className="form-input"
                    value={newAccForm.digits}
                    onChange={(e) => setNewAccForm({ ...newAccForm, digits: e.target.value })}
                  />
                  {newAccErrors.digits && <span className="field-error">{newAccErrors.digits}</span>}
                </div>
              </div>

              <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>
                Create and Assign
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TAB 2: Possible Duplicates */}
      {!loading && activeTab === 'duplicates' && (
        <div>
          {grouped.possibleDuplicates.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>
              ✓ No duplicate candidates waiting for review.
            </div>
          ) : (
            grouped.possibleDuplicates.map((item) => {
              const desc = describeDuplicate(item, allExpenses);

              if (desc.stale) {
                return (
                  <div key={item.id} className="card" style={{ marginBottom: '14px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <h4 style={{ margin: 0, fontSize: '0.95rem' }}>Duplicate review item (Stale)</h4>
                        <p style={{ margin: '4px 0 0 0', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                          One of the expenses in this duplicate check was deleted.
                        </p>
                      </div>
                      <button type="button" className="btn btn-secondary" onClick={() => handleRemoveStale(item)}>
                        Remove
                      </button>
                    </div>
                  </div>
                );
              }

              const imp = desc.imported;
              const chosenCandidateId = selectedDuplicateCandidate[item.id] || desc.manual[0]?.id;
              const man = desc.manual.find((m) => m.id === chosenCandidateId) || desc.manual[0];

              return (
                <div key={item.id} className="card" style={{ marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>Possible Duplicate Expense</span>
                    {desc.differences?.length > 0 && (
                      <span style={{ fontSize: '0.75rem', color: 'var(--warning)', fontWeight: 600 }}>
                        Differs in: {desc.differences.join(', ')}
                      </span>
                    )}
                  </div>

                  {desc.manual.length > 1 && (
                    <div style={{ marginBottom: '12px' }}>
                      <label className="form-label" style={{ fontSize: '0.8rem' }}>Choose Manual Candidate</label>
                      <select
                        className="form-input"
                        value={chosenCandidateId}
                        onChange={(e) => setSelectedDuplicateCandidate({ ...selectedDuplicateCandidate, [item.id]: e.target.value })}
                      >
                        {desc.manual.map((cand, idx) => (
                          <option key={cand.id} value={cand.id}>
                            Candidate {idx + 1}: {formatPaise(cand.amount_paise ?? cand.amountPaise)} · {cand.merchant_raw || cand.brand} ({cand.date})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Side-by-side card */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                    {/* Imported */}
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', padding: '10px' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--accent-primary)', marginBottom: '4px' }}>
                        IMPORTED FROM SMS
                      </div>
                      <div style={{ fontSize: '1rem', fontWeight: 700 }}>
                        {formatPaise(imp.amount_paise ?? imp.amountPaise)}
                      </div>
                      <div style={{ fontSize: '0.8rem' }}>{formatDateDisplay(imp.date)}</div>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{imp.merchant_raw || imp.brand || 'No merchant'}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Category: {categoriesMap[imp.category_id || imp.categoryId]?.name || 'None'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Account: {accountsMap[imp.account_id || imp.accountId]?.name || 'None'}
                      </div>
                      {imp.note && <div style={{ fontSize: '0.75rem', fontStyle: 'italic', marginTop: '2px' }}>"{imp.note}"</div>}
                    </div>

                    {/* Manual */}
                    <div style={{ background: 'var(--bg-secondary)', borderRadius: '6px', padding: '10px' }}>
                      <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--success)', marginBottom: '4px' }}>
                        MANUALLY ENTERED
                      </div>
                      <div style={{ fontSize: '1rem', fontWeight: 700 }}>
                        {formatPaise(man.amount_paise ?? man.amountPaise)}
                      </div>
                      <div style={{ fontSize: '0.8rem' }}>{formatDateDisplay(man.date)}</div>
                      <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>{man.merchant_raw || man.brand || 'No merchant'}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Category: {categoriesMap[man.category_id || man.categoryId]?.name || 'None'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                        Account: {accountsMap[man.account_id || man.accountId]?.name || 'None'}
                      </div>
                      {man.note && <div style={{ fontSize: '0.75rem', fontStyle: 'italic', marginTop: '2px' }}>"{man.note}"</div>}
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => handleResolveDuplicateMerge(item, desc)}
                    >
                      Same expense - merge
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => handleResolveDuplicateKeepBoth(item)}
                    >
                      Different - keep both
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}

      {/* TAB 3: Unparsed */}
      {!loading && activeTab === 'unparsed' && (
        <div>
          {grouped.unparsed.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '24px', color: 'var(--text-secondary)' }}>
              ✓ No unparsed messages.
            </div>
          ) : (
            grouped.unparsed.map((item) => {
              const desc = describeUnparsed(item);
              const isRevealed = Boolean(revealedTexts[item.id]);

              return (
                <div key={item.id} className="card" style={{ marginBottom: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.85rem' }}>{desc.address || 'Unknown Sender'}</span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {desc.receivedAt ? formatDateDisplay(typeof desc.receivedAt === 'number' ? new Date(desc.receivedAt).toISOString() : String(desc.receivedAt)) : ''}
                    </span>
                  </div>

                  {/* Preview / Revealed text */}
                  <div style={{ background: 'var(--bg-secondary)', padding: '10px', borderRadius: '6px', marginBottom: '8px', fontSize: '0.85rem', wordBreak: 'break-word' }}>
                    {isRevealed ? revealedTexts[item.id] : desc.preview}
                  </div>

                  <div style={{ fontSize: '0.75rem', color: 'var(--warning)', marginBottom: '10px' }}>
                    ⚠️ Check names before sharing.
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                    {!isRevealed && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        style={{ fontSize: '0.8rem', padding: '6px 10px' }}
                        onClick={() => handleRevealFullText(item)}
                      >
                        Show full text
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-primary"
                      style={{ fontSize: '0.8rem', padding: '6px 10px' }}
                      onClick={() => {
                        const dateStr = item.payload?.date ? String(item.payload.date).slice(0, 10) : '';
                        onAddManually({
                          date: dateStr,
                          note: 'from SMS',
                        });
                      }}
                    >
                      Add manually
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: '0.8rem', padding: '6px 10px' }}
                      onClick={() => handleCopyMasked(desc)}
                    >
                      Copy masked text
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      style={{ fontSize: '0.8rem', padding: '6px 10px', color: 'var(--danger)' }}
                      onClick={() => handleDismissUnparsed(item)}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
