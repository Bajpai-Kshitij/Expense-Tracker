import React, { useState } from 'react';
import NativeDebug from './NativeDebug.jsx';
import { restoreDefaultCategories } from '../core/health/categories.js';

export default function SettingsTab({
  folderUri,
  folderStatus = { ok: true },
  deviceId,
  deviceLabel,
  devices = [],
  lastSyncTime,
  lastSyncIssuesCount = 0,
  onSyncNow,
  onRebuildFromLogs,
  onChangeFolder,
  onUpdateDeviceLabel,
  onMergeDevice,
  onStartFresh,
  onNavigateToRulesBrands,
  onNavigateToSmsImport,
  onNavigateToStatementImport,
  onNavigateToAccounts,
  onNavigateToReview,
  onNavigateToEmi,
  openReviewCount = 0,
  categories = [],
  writer,
  db,
  runtime,
  onReloadLookups = () => {},
}) {
  const [labelInput, setLabelInput] = useState(deviceLabel || '');
  const [isUpdatingLabel, setIsUpdatingLabel] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [rebuildLoading, setRebuildLoading] = useState(false);
  const [healthStatus, setHealthStatus] = useState('');
  const [restoringCategories, setRestoringCategories] = useState(false);
  const [mergeTargets, setMergeTargets] = useState({});

  const handleRestoreDefaultCategories = async () => {
    try {
      setRestoringCategories(true);
      setHealthStatus('');
      const activeWriter = writer || runtime?.writer;
      const activeDb = db || runtime?.db;
      if (!activeWriter) {
        setHealthStatus('LogWriter not ready. Please sync or connect folder first.');
        return;
      }
      const res = await restoreDefaultCategories({
        writer: activeWriter,
        db: activeDb,
        categories,
      });
      setHealthStatus(`Restored ${res.restoredCount} default ${res.restoredCount === 1 ? 'category' : 'categories'}.`);
      if (onReloadLookups) {
        await onReloadLookups();
      }
    } catch (err) {
      setHealthStatus(`Restore failed: ${err.message}`);
    } finally {
      setRestoringCategories(false);
    }
  };

  const handleSaveLabel = async () => {
    const trimmed = labelInput.trim();
    if (!trimmed || trimmed === deviceLabel) return;
    try {
      setIsUpdatingLabel(true);
      await onUpdateDeviceLabel(trimmed);
    } finally {
      setIsUpdatingLabel(false);
    }
  };

  const handleSync = async () => {
    try {
      setSyncLoading(true);
      await onSyncNow();
    } finally {
      setSyncLoading(false);
    }
  };

  const handleRebuild = async () => {
    const confirmed = window.confirm(
      'Rebuilding from logs will re-evaluate all historical events and regenerate the local SQLite database. Continue?'
    );
    if (!confirmed) return;

    try {
      setRebuildLoading(true);
      await onRebuildFromLogs();
    } finally {
      setRebuildLoading(false);
    }
  };

  const handleStartFreshClick = () => {
    const confirmed = window.confirm(
      'Delete all expenses and stored messages on BOTH phones? Accounts, categories, rules, household names and senders are kept. A backup file stays in the shared folder.'
    );
    if (confirmed) onStartFresh();
  };

  const handleChangeFolderClick = () => {
    const confirmed = window.confirm(
      'Warning: Changing the shared sync folder will disconnect the current directory. You will need to select a new folder. Proceed?'
    );
    if (confirmed) {
      onChangeFolder();
    }
  };

  return (
    <div>
      {/* Synchronization Section */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Sync Status</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '0.9rem' }}>
          <span>Last Synced:</span>
          <span style={{ fontWeight: 600 }}>
            {lastSyncTime ? new Date(lastSyncTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never'}
          </span>
        </div>
        {lastSyncIssuesCount > 0 && (
          <div style={{ fontSize: '0.8rem', color: 'var(--warning)', marginBottom: '12px' }}>
            ⚠️ {lastSyncIssuesCount} sync {lastSyncIssuesCount === 1 ? 'issue' : 'issues'} reported in logs.
          </div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={syncLoading}
            onClick={handleSync}
          >
            {syncLoading ? 'Syncing...' : '🔄 Sync Now'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={rebuildLoading}
            onClick={handleRebuild}
          >
            {rebuildLoading ? 'Rebuilding...' : '🔨 Rebuild'}
          </button>
        </div>
      </div>

      {/* Rules, Brands & Categories Management */}
      <div
        className="card"
        onClick={onNavigateToRulesBrands}
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '2px' }}>
            🏷️ Rules, Brands & Categories
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Configure auto-categorization rules, brand aliases, and category labels
          </p>
        </div>
        <span style={{ fontSize: '1.2rem', color: 'var(--text-secondary)', marginLeft: '12px' }}>➔</span>
      </div>

      {/* SMS Import */}
      <div
        className="card"
        onClick={onNavigateToSmsImport}
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '2px' }}>
            💬 SMS Import
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Configure senders, scan inbox, and auto-import bank SMS
          </p>
        </div>
        <span style={{ fontSize: '1.2rem', color: 'var(--text-secondary)', marginLeft: '12px' }}>➔</span>
      </div>

      {/* Statement Import */}
      <div
        className="card"
        onClick={onNavigateToStatementImport}
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '2px' }}>
            📄 Import statement
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Import credit card statements with automatic reconciliation and deduplication
          </p>
        </div>
        <span style={{ fontSize: '1.2rem', color: 'var(--text-secondary)', marginLeft: '12px' }}>➔</span>
      </div>

      {/* Accounts Screen */}
      <div
        className="card"
        onClick={onNavigateToAccounts}
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '2px' }}>
            💳 Accounts
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Manage bank accounts, credit cards, and cash wallets
          </p>
        </div>
        <span style={{ fontSize: '1.2rem', color: 'var(--text-secondary)', marginLeft: '12px' }}>➔</span>
      </div>

      {/* Loans & EMIs Screen */}
      <div
        className="card"
        onClick={onNavigateToEmi}
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '2px' }}>
            📊 Loans & EMIs
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Track active EMI plans, monthly commitments, and outstanding balances
          </p>
        </div>
        <span style={{ fontSize: '1.2rem', color: 'var(--text-secondary)', marginLeft: '12px' }}>➔</span>
      </div>

      {/* Review Queue */}
      <div
        className="card"
        onClick={onNavigateToReview}
        style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div>
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, marginBottom: '2px' }}>
            📋 Review Queue {openReviewCount > 0 ? `(${openReviewCount})` : ''}
          </h3>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            Resolve unknown accounts, duplicate transactions, and unparsed SMS
          </p>
        </div>
        <span style={{ fontSize: '1.2rem', color: 'var(--text-secondary)', marginLeft: '12px' }}>➔</span>
      </div>

      {/* Shared Folder Section */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Shared Sync Folder</span>
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px', wordBreak: 'break-all' }}>
          {folderUri ? folderUri : '(No folder connected)'}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
          <span style={{ fontSize: '0.85rem' }}>Folder Status:</span>
          <span style={{ fontSize: '0.85rem', color: folderStatus?.ok ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
            {folderStatus?.ok ? '✓ Connected & Active' : '✕ Permission Required'}
          </span>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          style={{ width: '100%' }}
          onClick={handleChangeFolderClick}
        >
          Change Shared Folder
        </button>
      </div>

      {/* Device Info Section */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">This Device</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', fontSize: '0.85rem' }}>
          <span style={{ color: 'var(--text-secondary)' }}>Device ID:</span>
          <code style={{ background: 'var(--bg-secondary)', padding: '2px 6px', borderRadius: '4px' }}>
            {deviceId || 'Loading...'}
          </code>
        </div>
        <div className="form-group" style={{ marginBottom: '8px' }}>
          <label className="form-label">Device Label (Owner)</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              className="form-input"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              placeholder="e.g. Me, Wife"
            />
            <button
              type="button"
              className="btn btn-primary"
              disabled={isUpdatingLabel || !labelInput.trim() || labelInput.trim() === deviceLabel}
              onClick={handleSaveLabel}
            >
              Save
            </button>
          </div>
        </div>
      </div>

      {/* Known Devices List */}
      <div className="card">
        <div className="card-header">
          <span className="card-title">Connected Devices ({devices.length})</span>
        </div>
        {devices.length === 0 ? (
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>No devices discovered yet.</p>
        ) : (
          <div>
            {devices.map((d) => (
              <div
                key={d.deviceId}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border-color)',
                  fontSize: '0.85rem',
                }}
              >
                <div>
                  <span style={{ fontWeight: 600 }}>{d.label}</span>
                  {d.deviceId === deviceId && (
                    <span style={{ marginLeft: '6px', fontSize: '0.7rem', color: 'var(--accent-primary)' }}>(This device)</span>
                  )}
                </div>
                <code style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{d.deviceId}</code>
                {d.deviceId !== deviceId && (
                  <div style={{ display: 'flex', gap: '6px', width: '100%', marginTop: '6px' }}>
                    <select
                      className="form-select"
                      style={{ flex: 1 }}
                      value={mergeTargets[d.deviceId] || ''}
                      onChange={(e) => setMergeTargets((prev) => ({ ...prev, [d.deviceId]: e.target.value }))}
                    >
                      <option value="">Whose expenses are these?</option>
                      {devices.filter((o) => o.deviceId !== d.deviceId).map((o) => (
                        <option key={o.deviceId} value={o.deviceId}>{o.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      disabled={!mergeTargets[d.deviceId]}
                      onClick={() => onMergeDevice(d.deviceId, mergeTargets[d.deviceId])}
                    >
                      Remove
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Privacy & Retention */}
      <div style={{ textAlign: 'center', padding: '8px 16px', marginBottom: '16px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
        Raw message text is purged after 60 days
      </div>

      {/* Data Health Section */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-header">
          <span className="card-title">🩺 Data health</span>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
          Check and repair internal data integrity or restore seed categories.
        </p>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={restoringCategories}
          onClick={handleRestoreDefaultCategories}
        >
          {restoringCategories ? 'Restoring...' : 'Restore default categories'}
        </button>
        {healthStatus && (
          <div style={{ marginTop: '10px', fontSize: '0.8rem', color: healthStatus.includes('failed') ? 'var(--danger)' : 'var(--success)' }}>
            {healthStatus}
          </div>
        )}
      </div>

      {/* Start fresh */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-header">
          <span className="card-title">Start fresh</span>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
          Removes all expenses on both phones and keeps your configuration.
        </p>
        <button type="button" className="btn btn-danger" onClick={handleStartFreshClick}>
          Start fresh
        </button>
      </div>

      {/* Developer Tools (Collapsed) */}
      <details className="card" style={{ cursor: 'pointer' }}>
        <summary style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          Developer Tools (P3 Debug Interface)
        </summary>
        <div style={{ marginTop: '14px' }}>
          <NativeDebug
            db={db}
            writer={writer}
            runtime={runtime}
            categories={categories}
            folderUri={folderUri}
            onReloadLookups={onReloadLookups}
          />
        </div>
      </details>
    </div>
  );
}

