import React, { useState, useEffect, useRef } from 'react';
import { extractPdfText } from '../native/pdfText.js';
import {
  reconstructLines,
  maskStatementText,
  summarizeStructure,
  pickProbeSample,
  formatProbeReport,
} from '../core/statements/index.js';
import { settings } from '../core/db/queries.js';
import { createCapacitorSqliteAdapter } from '../native/sqlite.js';

export default function StatementProbe({ onBack, initialOwnerNames = '' }) {
  const [file, setFile] = useState(null);
  const [ownerNamesInput, setOwnerNamesInput] = useState(initialOwnerNames);
  const [password, setPassword] = useState('');
  const [showPasswordField, setShowPasswordField] = useState(false);
  const [keepAmounts, setKeepAmounts] = useState(false);

  const [isRunning, setIsRunning] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [summary, setSummary] = useState(null);
  const [report, setReport] = useState('');
  const [copyStatus, setCopyStatus] = useState('');

  const fileInputRef = useRef(null);

  // Load owner_names from settings if not pre-provided
  useEffect(() => {
    let isMounted = true;
    async function loadSettings() {
      if (initialOwnerNames) {
        setOwnerNamesInput(initialOwnerNames);
        return;
      }
      try {
        const adapter = await createCapacitorSqliteAdapter();
        const val = await settings.getSetting(adapter, 'owner_names');
        if (val && isMounted) {
          try {
            const parsed = JSON.parse(val);
            if (Array.isArray(parsed)) {
              setOwnerNamesInput(parsed.join(', '));
            } else {
              setOwnerNamesInput(val);
            }
          } catch {
            setOwnerNamesInput(val);
          }
        }
      } catch {}
    }
    loadSettings();
    return () => {
      isMounted = false;
    };
  }, [initialOwnerNames]);

  const handleFileChange = (e) => {
    const selected = e.target.files?.[0] || null;
    setFile(selected);
    setErrorMessage('');
    setSummary(null);
    setReport('');
    setShowPasswordField(false);
    setPassword('');
  };

  const handleRun = async () => {
    if (!file) {
      setErrorMessage('Please pick a PDF file first.');
      return;
    }

    try {
      setIsRunning(true);
      setErrorMessage('');
      setCopyStatus('');

      const buffer = await file.arrayBuffer();
      const res = await extractPdfText(buffer, {
        password: password ? password.trim() : undefined,
      });

      if (!res.ok) {
        if (res.code === 'NEEDS_PASSWORD') {
          setShowPasswordField(true);
          setErrorMessage('This statement is password protected. Please enter the password.');
        } else if (res.code === 'WRONG_PASSWORD') {
          setShowPasswordField(true);
          setErrorMessage('Incorrect password. Please re-enter the password.');
        } else if (res.code === 'NO_TEXT') {
          setErrorMessage("This PDF has no text, probably a scan. Try the PDF from the bank's email or app instead.");
        } else if (res.code === 'NOT_A_PDF') {
          setErrorMessage('The selected file is not a valid PDF document.');
        } else if (res.code === 'TOO_LARGE') {
          setErrorMessage('The file is too large (maximum allowed size is 15 MB).');
        } else {
          setErrorMessage('Failed to read PDF statement. Please try another file.');
        }
        return;
      }

      // Successful extraction: reconstruct lines, mask, summarize, sample, and report
      const ownerNames = ownerNamesInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      const lines = reconstructLines(res.items);
      const maskedLines = maskStatementText(lines, {
        ownerNames,
        level: keepAmounts ? 'amounts_kept' : 'layout',
      });

      const stmtSummary = summarizeStructure(maskedLines);
      const sample = pickProbeSample(maskedLines, stmtSummary);
      const reportText = formatProbeReport(stmtSummary, sample);

      setSummary(stmtSummary);
      setReport(reportText);
      // Clear password field after successful run
      setPassword('');
    } catch (err) {
      setErrorMessage(err?.message || 'An unexpected error occurred.');
    } finally {
      setIsRunning(false);
    }
  };

  const handleCopyReport = async () => {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report);
      setCopyStatus('Copied report to clipboard!');
      setTimeout(() => setCopyStatus(''), 3000);
    } catch {
      setCopyStatus('Failed to copy');
      setTimeout(() => setCopyStatus(''), 2000);
    }
  };

  const handleClear = () => {
    setFile(null);
    setPassword('');
    setShowPasswordField(false);
    setSummary(null);
    setReport('');
    setErrorMessage('');
    setCopyStatus('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div style={{ padding: '4px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px', gap: '8px' }}>
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          ← Back
        </button>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>Statement Probe</h2>
      </div>

      {/* Warning banner */}
      <div className="alert-banner alert-warning" style={{ marginBottom: '16px', fontSize: '0.85rem' }}>
        ⚠️ Nothing is saved. Check the masked text carefully before sharing it.
      </div>

      {/* Error banner */}
      {errorMessage && (
        <div className="alert-banner alert-danger" style={{ marginBottom: '16px', fontSize: '0.85rem' }}>
          {errorMessage}
        </div>
      )}

      {/* Controls Card */}
      <div className="card" style={{ marginBottom: '16px' }}>
        <div className="form-group" style={{ marginBottom: '12px' }}>
          <label className="form-label" style={{ fontWeight: 600 }}>PDF Statement File</label>
          <input
            type="file"
            ref={fileInputRef}
            accept="application/pdf"
            className="form-input"
            onChange={handleFileChange}
          />
        </div>

        <div className="form-group" style={{ marginBottom: '12px' }}>
          <label className="form-label" style={{ fontWeight: 600 }}>Owner names (comma separated)</label>
          <input
            type="text"
            className="form-input"
            value={ownerNamesInput}
            onChange={(e) => setOwnerNamesInput(e.target.value)}
            placeholder="e.g. Kshitij Bajpai, Jane Doe"
          />
        </div>

        {showPasswordField && (
          <div className="form-group" style={{ marginBottom: '12px' }}>
            <label className="form-label" style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>
              Statement Password
            </label>
            <input
              type="password"
              className="form-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password (e.g. DOB, PAN)"
              autoComplete="off"
            />
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <input
            type="checkbox"
            id="keepAmountsToggle"
            checked={keepAmounts}
            onChange={(e) => setKeepAmounts(e.target.checked)}
            style={{ width: '18px', height: '18px', cursor: 'pointer' }}
          />
          <label htmlFor="keepAmountsToggle" style={{ fontSize: '0.85rem', cursor: 'pointer' }}>
            Keep amounts (do not mask)
          </label>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          style={{ width: '100%', padding: '10px', fontWeight: 700 }}
          disabled={isRunning || !file}
          onClick={handleRun}
        >
          {isRunning ? 'Extracting & Probing...' : 'Run'}
        </button>
      </div>

      {/* Results Section */}
      {summary && (
        <div className="card" style={{ marginBottom: '16px' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '12px', color: 'var(--text-primary)' }}>
            Pages: {summary.pageCount}, lines: {summary.lineCount}, issuer guess: {summary.issuerGuess}, scanned image: {summary.hasText ? 'no' : 'yes'}
          </div>

          <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ padding: '6px 12px', fontSize: '0.85rem' }}
              onClick={handleCopyReport}
            >
              Copy report
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ padding: '6px 12px', fontSize: '0.85rem' }}
              onClick={handleClear}
            >
              Clear
            </button>
            {copyStatus && (
              <span style={{ fontSize: '0.8rem', color: 'var(--success)', fontWeight: 600 }}>
                {copyStatus}
              </span>
            )}
          </div>

          <pre
            style={{
              background: '#090d16',
              color: '#f8fafc',
              padding: '12px',
              borderRadius: '6px',
              maxHeight: '450px',
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              fontFamily: 'monospace',
              fontSize: '0.75rem',
              lineHeight: 1.4,
              border: '1px solid var(--border-color)',
            }}
          >
            {report}
          </pre>
        </div>
      )}
    </div>
  );
}

