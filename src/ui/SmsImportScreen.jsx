import React, { useState, useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { readSms, ExpenseNative } from '../native/expenseNative.js';
import { listSenders, sanitizeAllowlist } from '../core/ingest/senders.js';
import { scanSms, mapPermissionError } from '../native/smsScan.js';
import { scanSummaryLines } from '../core/review/viewModels.js';
import { countOpenReviewItems } from '../core/db/reviewQueue.js';
import { rowsToState, loadStateFromDb } from '../core/db/index.js';
import { listIgnoreRules } from '../core/ingest/userIgnore.js';
import { maskForSharing } from '../core/ingest/mask.js';
import { settings } from '../core/db/queries.js';
import { formatDateDisplay } from '../core/format/dates.js';
import {
  findLikelyBankSenderAddresses,
  removeReviewItemsFromDisallowedSenders,
} from '../core/review/sendersCleanup.js';
import { parseHouseholdNames } from '../core/review/household.js';

export default function SmsImportScreen({
  db,
  writer,
  onBack,
  onNavigateToReview,
  showToast = () => {},
  onReloadLookups = () => {},
}) {
  const [ignoreRules, setIgnoreRules] = useState([]);
  const [hasPermission, setHasPermission] = useState(null);
  const [permissionError, setPermissionError] = useState('');

  const [discoveredSenders, setDiscoveredSenders] = useState([]);
  const [cachedInboxMessages, setCachedInboxMessages] = useState([]);
  const [senderSearch, setSenderSearch] = useState('');
  const [emptySenderCount, setEmptySenderCount] = useState(0);
  const [selectedSenders, setSelectedSenders] = useState([]);
  const [senderWarning, setSenderWarning] = useState('');
  const [scanningSenders, setScanningSenders] = useState(false);
  const [removingDisallowed, setRemovingDisallowed] = useState(false);

  const [ownerNamesList, setOwnerNamesList] = useState([]);
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
            if (Array.isArray(parsed)) {
              setOwnerNamesList(parseHouseholdNames(parsed));
            } else if (typeof parsed === 'string') {
              setOwnerNamesList(parseHouseholdNames(parsed));
            }
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

  const loadIgnoreRules = async () => {
    const { rules } = await loadStateFromDb(db);
    const list = [];
    for (const rule of listIgnoreRules(rules)) {
      let label = rule.merchantName || `${String(rule.issuer || '').toUpperCase()} ${rule.digits || ''}`;
      if (rule.matchType === 'template') {
        const rows = rule.sampleHash
          ? await db.query('SELECT body FROM raw_messages WHERE hash = ? LIMIT 1;', [rule.sampleHash])
          : [];
        // The wording stays on the phone that received it; the other phone shows the sender only.
        label = rows[0]?.body ? maskForSharing(rows[0].body) : `Messages from ${rule.sender || 'a sender'}`;
      }
      list.push({ id: rule.id, type: rule.matchType, label });
    }
    setIgnoreRules(list);
  };

  useEffect(() => {
    if (db) loadIgnoreRules().catch(() => {});
  }, [db]);

  const handleRemoveIgnoreRule = async (id) => {
    try {
      await writer.write('rule.deleted', { id });
      showToast('Removed. New messages like this will be read again.');
      await loadIgnoreRules();
      await onReloadLookups();
    } catch (err) {
      showToast(`Failed: ${err.message}`);
    }
  };

  const handleScanInboxSenders = async () => {
    try {
      setScanningSenders(true);
      setPermissionError('');
      const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
      const messages = await readSms({ sinceEpochMs: ninetyDaysAgo, limit: 2000, order: 'desc' });
      setCachedInboxMessages(messages);

      const accountsRows = await db.query('SELECT * FROM accounts;');
      const state = rowsToState({ accounts: accountsRows });
      const senders = listSenders(messages, { accounts: state.accounts });
      setDiscoveredSenders(senders);
      setEmptySenderCount(senders.emptySenderCount || 0);

      // Nothing is ticked by default unless already in saved allowlist
    } catch (err) {
      const mapped = mapPermissionError(err);
      setPermissionError(mapped);
    } finally {
      setScanningSenders(false);
    }
  };

  const handleSelectLikelyBanks = () => {
    const likelyAddrs = findLikelyBankSenderAddresses(cachedInboxMessages);
    const matched = discoveredSenders
      .filter((s) => {
        const addr = s.address || s.sender || '';
        return likelyAddrs.has(addr) || /(?:axis|icici|hdfc|idfc)/i.test(addr);
      })
      .map((s) => s.address || s.sender);

    const sanitized = sanitizeAllowlist(matched);
    setSelectedSenders(sanitized);
    showToast(`Selected ${sanitized.length} likely bank senders`);
  };

  const handleClearAllSenders = () => {
    setSelectedSenders([]);
  };

  const toggleSender = (address) => {
    setSelectedSenders((prev) =>
      prev.includes(address) ? prev.filter((s) => s !== address) : [...prev, address]
    );
  };

  const handleSaveSenders = async () => {
    const sanitized = sanitizeAllowlist(selectedSenders);
    if (sanitized.length > 25) {
      const confirmed = window.confirm('Banks usually have 3 to 8 senders. Save anyway?');
      if (!confirmed) return;
    }
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

  const handleRemoveDisallowedReviewItems = async () => {
    try {
      setRemovingDisallowed(true);
      const res = await removeReviewItemsFromDisallowedSenders({
        db,
        writer,
        allowlist: selectedSenders,
      });
      showToast(`Removed ${res.count} review ${res.count === 1 ? 'item' : 'items'}`);
      const count = await countOpenReviewItems(db);
      setReviewCount(count);
      if (onReloadLookups) await onReloadLookups();
    } catch (err) {
      showToast(`Failed: ${err.message}`);
    } finally {
      setRemovingDisallowed(false);
    }
  };

  const handleAddOwnerNames = async () => {
    const parsed = parseHouseholdNames(ownerNamesInput);
    if (parsed.length === 0) return;
    const combined = parseHouseholdNames([...ownerNamesList, ...parsed]);
    setOwnerNamesList(combined);
    setOwnerNamesInput('');
    await settings.setSetting(db, 'owner_names', JSON.stringify(combined));
    showToast(`Saved ${combined.length} household names`);
  };

  const handleRemoveOwnerName = async (nameToRemove) => {
    const remaining = ownerNamesList.filter((n) => n.toLowerCase() !== nameToRemove.toLowerCase());
    setOwnerNamesList(remaining);
    await settings.setSetting(db, 'owner_names', JSON.stringify(remaining));
    showToast(`Removed ${nameToRemove}`);
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

      const getState = () => loadStateFromDb(db);

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

  const filteredSenders = discoveredSenders.filter((s) => {
    if (!senderSearch.trim()) return true;
    const q = senderSearch.trim().toLowerCase();
    const addr = (s.address || s.sender || '').toLowerCase();
    return addr.includes(q);
  });

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
          <div style={{ marginBottom: '12px' }}>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
              <input
                type="text"
                className="form-input"
                placeholder="Search senders..."
                value={senderSearch}
                onChange={(e) => setSenderSearch(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleSelectLikelyBanks}
                title="Select likely banks"
              >
                Select likely banks
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleClearAllSenders}
                title="Clear all"
              >
                Clear all
              </button>
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>
              Showing {filteredSenders.length} of {discoveredSenders.length} senders ({selectedSenders.length} selected)
            </div>

            <div style={{ maxHeight: '240px', overflowY: 'auto', marginBottom: '12px', border: '1px solid var(--border-color)', borderRadius: '6px', padding: '8px' }}>
              {filteredSenders.map((s) => {
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
              {filteredSenders.length === 0 && (
                <div style={{ padding: '8px', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  No senders matching &quot;{senderSearch}&quot;
                </div>
              )}
            </div>
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
          style={{ width: '100%', marginBottom: '8px' }}
          onClick={handleSaveSenders}
        >
          Save Senders ({selectedSenders.length} selected)
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          style={{ width: '100%', fontSize: '0.8rem' }}
          disabled={removingDisallowed}
          onClick={handleRemoveDisallowedReviewItems}
        >
          {removingDisallowed
            ? 'Removing review items...'
            : 'Remove review items from senders that are not on the list'}
        </button>
      </div>

      {/* Household Names Section */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="card-header">
          <span className="card-title">Household names (you and your wife, exactly as the bank prints them)</span>
        </div>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>
          Used to recognise transfers to yourself.
        </p>

        {ownerNamesList.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
            {ownerNamesList.map((name) => (
              <span
                key={name}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  background: 'var(--chip-bg, #e2e8f0)',
                  color: 'var(--chip-text, #1e293b)',
                  borderRadius: '16px',
                  padding: '4px 10px',
                  fontSize: '0.85rem',
                  fontWeight: 500,
                }}
              >
                {name}
                <button
                  type="button"
                  onClick={() => handleRemoveOwnerName(name)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: 0,
                    marginLeft: '2px',
                    fontSize: '0.9rem',
                    lineHeight: 1,
                    color: 'var(--text-secondary)',
                  }}
                  title={`Remove ${name}`}
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '8px' }}>
          <textarea
            className="form-input"
            rows={2}
            value={ownerNamesInput}
            onChange={(e) => setOwnerNamesInput(e.target.value)}
            placeholder="Add names separated by commas or new lines, e.g. John Doe, Jane Doe"
            style={{ resize: 'vertical' }}
          />
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleAddOwnerNames}
            disabled={!ownerNamesInput.trim()}
          >
            Add name(s)
          </button>
        </div>

        <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', margin: 0 }}>
          💡 Add your wife&apos;s name too (used to recognise self-transfers between household accounts)
        </p>
      </div>

      {/* Ignored SMS */}
      {ignoreRules.length > 0 && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div className="card-header">
            <span className="card-title">Ignored messages ({ignoreRules.length})</span>
          </div>
          {ignoreRules.map((r) => (
            <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
              <span style={{ fontSize: '0.8rem', wordBreak: 'break-word' }}>{r.label}</span>
              <button type="button" className="btn btn-secondary" style={{ fontSize: '0.75rem', padding: '4px 8px', flexShrink: 0 }} onClick={() => handleRemoveIgnoreRule(r.id)}>
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

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
