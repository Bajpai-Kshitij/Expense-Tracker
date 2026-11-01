import React, { useState } from 'react';
import NativeDebug from './NativeDebug.jsx';

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
  onNavigateToRulesBrands,
}) {
  const [labelInput, setLabelInput] = useState(deviceLabel || '');
  const [isUpdatingLabel, setIsUpdatingLabel] = useState(false);
  const [syncLoading, setSyncLoading] = useState(false);
  const [rebuildLoading, setRebuildLoading] = useState(false);

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
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Privacy & Retention */}
      <div style={{ textAlign: 'center', padding: '8px 16px', marginBottom: '16px', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
        Raw message text is purged after 60 days
      </div>

      {/* Developer Tools (Collapsed) */}
      <details className="card" style={{ cursor: 'pointer' }}>
        <summary style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
          Developer Tools (P3 Debug Interface)
        </summary>
        <div style={{ marginTop: '14px' }}>
          <NativeDebug />
        </div>
      </details>
    </div>
  );
}

