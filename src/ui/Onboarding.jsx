import React, { useState } from 'react';
import { pickFolder } from '../native/expenseNative.js';

export default function Onboarding({ onComplete, isRepickMode = false, currentLabel = 'Me' }) {
  const [folderUri, setFolderUri] = useState('');
  const [folderName, setFolderName] = useState('');
  const [label, setLabel] = useState(currentLabel);
  const [customLabel, setCustomLabel] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handlePick = async () => {
    try {
      setError('');
      const res = await pickFolder();
      setFolderUri(res.uri);
      setFolderName(res.name || 'ExpenseSync');
    } catch (err) {
      setError(`Failed to pick folder: ${err.message}`);
    }
  };

  const handleFinish = async () => {
    if (!folderUri) {
      setError('Please pick a folder to continue');
      return;
    }
    const finalLabel = isCustom ? (customLabel.trim() || 'Me') : label;
    try {
      setIsSubmitting(true);
      setError('');
      await onComplete({ folderUri, label: finalLabel });
    } catch (err) {
      setError(`Setup failed: ${err.message}`);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="app-shell" style={{ justifyContent: 'center', padding: '24px' }}>
      <div className="card" style={{ padding: '24px' }}>
        <h1 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: '8px' }}>
          {isRepickMode ? 'Folder Access Lost' : 'Welcome to Expense Tracker'}
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '20px' }}>
          {isRepickMode
            ? 'The app lost permission to access the shared sync folder. Re-pick the folder to resume offline sync.'
            : 'Local-first, offline-ready expense tracking synchronized via a shared folder.'}
        </p>

        {error && (
          <div className="alert-banner alert-danger">
            <span>{error}</span>
          </div>
        )}

        {/* Step 1: Folder Picker */}
        <div style={{ marginBottom: '20px' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '6px' }}>
            {isRepickMode ? 'Step 1: Re-select Folder' : 'Step 1: Choose Shared Sync Folder'}
          </h2>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            Pick Documents/ExpenseSync on this phone, not a Google Drive location.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ width: '100%', marginBottom: '8px' }}
            onClick={handlePick}
          >
            📁 {folderUri ? `Picked: ${folderName}` : 'Pick Shared Folder'}
          </button>
          {folderUri && (
            <p style={{ fontSize: '0.75rem', color: 'var(--success)' }}>
              ✓ Folder selected: {folderName}
            </p>
          )}
        </div>

        {/* Step 2: Device Label (only if not re-pick) */}
        {!isRepickMode && (
          <div style={{ marginBottom: '24px' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '6px' }}>
              Step 2: Who uses this device?
            </h2>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <button
                type="button"
                className={`btn ${!isCustom && label === 'Me' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1 }}
                onClick={() => { setIsCustom(false); setLabel('Me'); }}
              >
                Me
              </button>
              <button
                type="button"
                className={`btn ${!isCustom && label === 'Wife' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1 }}
                onClick={() => { setIsCustom(false); setLabel('Wife'); }}
              >
                Wife
              </button>
              <button
                type="button"
                className={`btn ${isCustom ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1 }}
                onClick={() => setIsCustom(true)}
              >
                Custom
              </button>
            </div>
            {isCustom && (
              <input
                type="text"
                className="form-input"
                placeholder="Enter device label (e.g. Work, Tablet)"
                value={customLabel}
                onChange={(e) => setCustomLabel(e.target.value)}
                maxLength={30}
              />
            )}
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary"
          style={{ width: '100%', padding: '14px' }}
          disabled={!folderUri || isSubmitting}
          onClick={handleFinish}
        >
          {isSubmitting ? 'Configuring...' : (isRepickMode ? 'Restore Folder Access' : 'Get Started')}
        </button>
      </div>
    </div>
  );
}

