import React, { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { readSms, ExpenseNative } from '../native/expenseNative.js';
import { listSenders, sanitizeAllowlist } from '../core/ingest/senders.js';
import { scanSms, mapPermissionError } from '../native/smsScan.js';
import { scanSummaryLines } from '../core/review/viewModels.js';
import { countOpenReviewItems } from '../core/db/reviewQueue.js';
import { rowsToState } from '../core/db/index.js';
import { settings } from '../core/db/queries.js';
import { formatDateDisplay } from '../core/format/dates.js';

export default function SmsImportScreen({
  db,
  writer,
  onBack,
  onNavigateToReview,
  showToast = () => {},
  onReloadLookups = () => {},
}) {
  const [hasPermission, setHasPermission] = useState(null);
  const [permissionError, setPermissionError] = useState('');

  const [discoveredSenders, setDiscoveredSenders] = useState([]);
  const [emptySenderCount, setEmptySenderCount] = useState(0);
  const [selectedSenders, setSelectedSenders] = useState([]);
  const [senderWarning, setSenderWarning] = useState('');
  const [scanningSenders, setScanningSenders] = useState(false);

  const [ownerNamesInput, setOwnerNamesInput] = useState('');
  const [autoScan, setAutoScan] = useState(false);
  const [lastScanMs, setLastScanMs] = useState(null);

  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [scanSummary, setScanSummary] = useState(null);
  const [reviewCount, setReviewCount] = useState(0);

  const chooseSendersRef = useRef(null);

  // Load existing settings on mount
  useEffect(() => {
    let isMounted = true;

    async function loadSettings() {
      if (!db) return;
      try {
        // Permission check
        if (!Capacitor.isNativePlatform()) {
          setHasPermission(true);
        } else {
          try {
            if (ExpenseNative && typeof ExpenseNative.checkPermissions === 'function') {
              const res = await ExpenseNative.checkPermissions();
              if (res.sms === 'granted') {
                setHasPermission(true);
              } else {
                setHasPermission(false);
              }
            } else {
              setHasPermission(true);
            }
          } catch {
            setHasPermission(false);
          }
        }

        // Saved senders
        const savedSendersJson = await settings.getSetting(db, 'sms_senders');
        if (savedSendersJson && isMounted) {
          try {
            const parsed = JSON.parse(savedSendersJson);
            if (Array.isArray(parsed)) setSelectedSenders(sanitizeAllowlist(parsed));
          } catch {}
        }

        // Owner names
        const savedNamesJson = await settings.getSetting(db, 'owner_names');
        if (savedNamesJson && isMounted) {
          try {
            const parsed = JSON.parse(savedNamesJson);
            if (Array.isArray(parsed)) setOwnerNamesInput(parsed.join(', '));
          } catch {}
        }

        // Auto scan
        const savedAuto = await settings.getSetting(db, 'sms_auto_scan');
        if (isMounted) {
          setAutoScan(savedAuto === 'true' || savedAuto === '1');
        }

        // Last scan ms
        const savedLastScan = await settings.getSetting(db, 'sms_last_scan_ms');
        if (savedLastScan && isMounted) {
          setLastScanMs(Number(savedLastScan));
        }

        // Open review count
        const count = await countOpenReviewItems(db);
        if (isMounted) {
          setReviewCount(count);
        }
      } catch (err) {
        console.error('Failed to load SMS import settings:', err);
      }
    }

    loadSettings();

    return () => {
      isMounted = false;
    };
  }, [db]);

  const handleGrantPermission = async () => {
    try {
      setPermissionError('');
      if (ExpenseNative && typeof ExpenseNative.requestPermissions === 'function') {
        const res = await ExpenseNative.requestPermissions({ permissions: ['sms'] });
        if (res.sms === 'granted') {
          setHasPermission(true);
          showToast('SMS permission granted');
          return;
        }
      }
      await readSms({ limit: 1 });
      setHasPermission(true);
      showToast('SMS permission granted');
    } catch (err) {
      setHasPermission(false);
      const mapped = mapPermissionError(err);
      setPermissionError(mapped);
    }
  };

  const handleScanInboxSenders = async () => {
    try {
      setScanningSenders(true);
      setPermissionError('');
      const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
      const messages = await readSms({ sinceEpochMs: ninetyDaysAgo, limit: 2000, order: 'desc' });

      const accountsRows = await db.query('SELECT * FROM accounts;');
      const state = rowsToState({ accounts: accountsRows });
      const senders = listSenders(messages, { accounts: state.accounts });
      setDiscoveredSenders(senders);
      setEmptySenderCount(senders.emptySenderCount || 0);

      // Pre-tick saved allowlist senders or financial senders if none saved yet
      if (selectedSenders.length === 0) {
        const financialOnly = senders
          .filter((s) => (s.financial ?? s.financialCount ?? 0) > 0)
          .map((s) => s.address || s.sender);
        setSelectedSenders(sanitizeAllowlist(financialOnly));
      }
    } catch (err) {
      const mapped = mapPermissionError(err);
      setPermissionError(mapped);
    } finally {
      setScanningSenders(false);
    }
  };

  const toggleSender = (address) => {
    setSelectedSenders((prev) =>
      prev.includes(address) ? prev.filter((s) => s !== address) : [...prev, address]
    );
  };

  const handleSaveSenders = async () => {
    const sanitized = sanitizeAllowlist(selectedSenders);
    setSelectedSenders(sanitized);
    await settings.setSetting(db, 'sms_senders', JSON.stringify(sanitized));
    if (sanitized.length === 0) {
      setSenderWarning('No senders selected. SMS import will not process any messages.');
      showToast('No senders selected. SMS import will not process any messages.');
    } else {
      setSenderWarning('');
      showToast('Saved bank & card senders');
    }
  };

  const handleSaveOwnerNames = async () => {
    const list = ownerNamesInput.split(',').map((s) => s.trim()).filter(Boolean);
    await settings.setSetting(db, 'owner_names', JSON.stringify(list));
    showToast('Saved owner names');
  };

  const handleToggleAutoScan = async (checked) => {
    setAutoScan(checked);
    await settings.setSetting(db, 'sms_auto_scan', checked ? 'true' : 'false');
  };

  const handleScanNow = async ({ ignoreWatermark = false } = {}) => {
    if (isScanning) return;
    const confirmed = window.confirm('This adds expenses from your messages. It is safe to run again.');
    if (!confirmed) return;

    try {
      setIsScanning(true);
      setScanProgress('Starting scan...');
      setScanSummary(null);
      setPermissionError('');

      const getState = async () => {
        const rows = {
          expenses: await db.query('SELECT * FROM expenses;'),
          categories: await db.query('SELECT * FROM categories;'),
          accounts: await db.query('SELECT * FROM accounts;'),
          brands: await db.query('SELECT * FROM brands;'),
          rules: await db.query('SELECT * FROM rules;'),
          review_queue: await db.query('SELECT * FROM review_queue;'),
        };
        return rowsToState(rows);
      };

      const res = await scanSms({
        readSms,
        db,
        writer,
        getState,
        ignoreWatermark,
        onProgress: ({ scanned }) => {
          setScanProgress(`${scanned} messages read`);
        },
      });

      if (res.busy) {
        showToast('A scan is already in progress');
        return;
      }

      setScanSummary(res);
      const openCount = await countOpenReviewItems(db);
      setReviewCount(openCount);

      // Default auto-scan to ON after first manual scan succeeds if not explicitly set
      const savedAuto = await settings.getSetting(db, 'sms_auto_scan');
      if (savedAuto === null || savedAuto === undefined) {
        await settings.setSetting(db, 'sms_auto_scan', 'true');
        setAutoScan(true);
      }

      const lastScan = await settings.getSetting(db, 'sms_last_scan_ms');
      if (lastScan) setLastScanMs(Number(lastScan));

      if (onReloadLookups) {
        await onReloadLookups();
      }
    } catch (err) {
      setPermissionError(mapPermissionError(err));
    } finally {
      setIsScanning(false);
      setScanProgress('');
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px', gap: '8px' }}>
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          ← Back
        </button>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>SMS Import</h2>
      </div>

      {/* Permission Section */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-header">
          <span className="card-title">SMS Permission</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
          <span style={{ fontSize: '0.9rem' }}>Status:</span>
          <span
            style={{
              fontWeight: 600,
              fontSize: '0.85rem',
              color: hasPermission ? 'var(--success)' : 'var(--danger)',
            }}
          >
            {hasPermission ? '✓ Permission granted' : '✕ Permission required'}
          </span>
        </div>

        {!hasPermission && (
          <div style={{ marginTop: '8px' }}>
            {permissionError && (
              <div className="alert-banner alert-danger" style={{ marginBottom: '12px', fontSize: '0.85rem' }}>
                {permissionError}
              </div>
            )}
            <button
              type="button"
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={handleGrantPermission}
            >
              Grant Permission
            </button>
          </div>
        )}
      </div>

      {/* Choose Senders Section */}
      <div className="card" style={{ marginBottom: '16px' }} ref={chooseSendersRef}>
        <div className="card-header">
          <span className="card-title">Choose Senders</span>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
          Tick only your banks and card issuers.
        </p>

        <button
          type="button"
          className="btn btn-secondary"
          style={{ width: '100%', marginBottom: '12px' }}
          disabled={scanningSenders}
          onClick={handleScanInboxSenders}
        >
          {scanningSenders ? 'Inspecting inbox...' : 'Look at my inbox (last 90 days)'}
        </button>

        {discoveredSenders.length > 0 && (
          <div style={{ maxHeight: '240px', overflowY: 'auto', marginBottom: '12px', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px' }}>
            {discoveredSenders.map((s) => {
              const address = s.address || s.sender || '';
              const isChecked = selectedSenders.includes(address);
              const finCount = s.financial ?? s.financialCount ?? 0;
              const totCount = s.total ?? s.totalCount ?? 0;
              return (
                <label
                  key={address}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 4px',
                    borderBottom: '1px solid var(--border-color)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleSender(address)}
                    />
                    <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{address}</span>
                  </div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                    {finCount} financial of {totCount} messages
                  </span>
                </label>
              );
            })}
          </div>
        )}

        {emptySenderCount > 0 && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            {emptySenderCount} messages had no sender
          </div>
        )}

        {senderWarning && (
          <div className="alert-banner alert-warning" style={{ marginBottom: '12px', fontSize: '0.85rem' }}>
            {senderWarning}
          </div>
        )}

        <button
          type="button"
          className="btn btn-primary"
          style={{ width: '100%' }}
          onClick={handleSaveSenders}
        >
          Save Senders ({selectedSenders.length} selected)
        </button>
      </div>

      {/* Household Names Section */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-header">
          <span className="card-title">Household names (you and your wife, exactly as the bank prints them)</span>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '10px' }}>
          Used to recognise transfers to yourself.
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            className="form-input"
            value={ownerNamesInput}
            onChange={(e) => setOwnerNamesInput(e.target.value)}
            placeholder="e.g. John Doe, Jane Doe"
          />
          <button type="button" className="btn btn-secondary" onClick={handleSaveOwnerNames}>
            Save
          </button>
        </div>
      </div>

      {/* Scan SMS Now Section */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-header">
          <span className="card-title">Scan SMS</span>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
          This adds expenses from your messages. It is safe to run again.
        </p>

        {permissionError && (
          <div className="alert-banner alert-danger" style={{ marginBottom: '12px', fontSize: '0.85rem' }}>
            <div>{permissionError}</div>
            {(permissionError.includes('Choose and save your bank senders first') || permissionError.includes('Choose senders')) && (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginTop: '8px', fontSize: '0.8rem', padding: '4px 8px' }}
                onClick={() => chooseSendersRef.current?.scrollIntoView({ behavior: 'smooth' })}
              >
                Go to Choose senders
              </button>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1, padding: '12px', fontSize: '1rem', fontWeight: 700 }}
            disabled={isScanning}
            onClick={() => handleScanNow({ ignoreWatermark: false })}
          >
            {isScanning ? (scanProgress || 'Scanning...') : 'Scan SMS now'}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            style={{ padding: '12px', fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap' }}
            disabled={isScanning}
            onClick={() => handleScanNow({ ignoreWatermark: true })}
            title="Rescan ignoring previous watermark"
          >
            Rescan last 60 days
          </button>
        </div>

        {/* Scan Summary Output */}
        {scanSummary && (
          <div style={{ marginTop: '16px', background: 'var(--bg-secondary)', borderRadius: '6px', padding: '12px' }}>
            <h4 style={{ fontSize: '0.9rem', fontWeight: 700, marginBottom: '8px' }}>Scan Result</h4>
            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: '0.85rem' }}>
              {scanSummaryLines(scanSummary).map((line, idx) => (
                <li key={idx} style={{ marginBottom: '4px' }}>
                  {line}
                </li>
              ))}
            </ul>

            {reviewCount > 0 && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%', marginTop: '12px' }}
                onClick={onNavigateToReview}
              >
                Open Review ({reviewCount} items)
              </button>
            )}
          </div>
        )}
      </div>

      {/* Auto Scan & Last Scan */}
      <div className="card" style={{ marginBottom: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>Scan automatically when the app opens</div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
              Runs at most once every 15 minutes in background
            </div>
          </div>
          <input
            type="checkbox"
            checked={autoScan}
            onChange={(e) => handleToggleAutoScan(e.target.checked)}
            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
          />
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          <span>Last scan:</span>
          <span style={{ fontWeight: 600 }}>
            {lastScanMs ? `${formatDateDisplay(new Date(lastScanMs).toISOString())} ${new Date(lastScanMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Never'}
          </span>
        </div>
      </div>
    </div>
  );
}
