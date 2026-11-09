import React, { useState, useEffect, useRef } from 'react';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { extractPdfText } from '../native/pdfText.js';
import { reconstructLines } from '../core/statements/reconstruct.js';
import {
  parseStatement,
  registerStatementParser,
} from '../core/statements/parsers/registry.js';
import { testBankParser } from '../core/statements/parsers/testbank.js';
import { checkTotals, isNeedsAttention } from '../core/statements/import/reconcile.js';
import { planStatementImport } from '../core/statements/import/plan.js';
import { applyStatementImport, undoStatementImport } from '../core/statements/import/apply.js';
import { accountHasEnding, addAccountAlias, suggestStatementAccount } from '../core/statements/import/accountSuggest.js';
import { loadStateFromDb } from '../core/db/index.js';
import { formatPaise } from '../core/format/money.js';

export default function StatementImport({
  db,
  writer,
  accounts = [],
  onBack,
  onNavigateToReview,
  showToast = () => {},
  onReloadLookups = () => {},
  autoLoadSample = false,
}) {
  const [file, setFile] = useState(null);
  const [password, setPassword] = useState('');
  const [showPasswordField, setShowPasswordField] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const [parseResult, setParseResult] = useState(null);
  const [fileHash, setFileHash] = useState(null);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [plan, setPlan] = useState(null);
  const [isDuplicateFile, setIsDuplicateFile] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [isApplying, setIsApplying] = useState(false);
  const [saveAlias, setSaveAlias] = useState(true);

  const fileInputRef = useRef(null);
  const isMountedRef = useRef(true);

  // Normalize accounts list
  const accountList = Array.isArray(accounts)
    ? accounts
    : accounts && typeof accounts === 'object'
    ? Object.values(accounts)
    : [];

  useEffect(() => {
    isMountedRef.current = true;
    if (autoLoadSample) {
      handleLoadSampleStatement();
    }
    return () => {
      isMountedRef.current = false;
      // Clear sensitive data from memory on leaving screen
      setFile(null);
      setPassword('');
      setParseResult(null);
      setPlan(null);
    };
  }, [autoLoadSample]);

  const handleFileChange = (e) => {
    const selected = e.target.files?.[0] || null;
    setFile(selected);
    setErrorMessage('');
    setParseResult(null);
    setPlan(null);
    setImportResult(null);
    setShowPasswordField(false);
    setPassword('');
    setIsDuplicateFile(false);
  };

  const processStatementBuffer = async (buffer, customHash = null, customLines = null) => {
    try {
      setIsProcessing(true);
      setErrorMessage('');

      let lines = customLines;
      let computedHash = customHash;

      if (!lines) {
        if (!computedHash) {
          const hashBytes = sha256(new Uint8Array(buffer));
          computedHash = bytesToHex(hashBytes);
        }

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

        lines = reconstructLines(res.items);
      }

      setFileHash(computedHash);

      const parsed = parseStatement(lines);
      if (!parsed.ok) {
        if (parsed.reason === 'no_parser') {
          setErrorMessage('This statement layout is not supported yet');
        } else {
          setErrorMessage(`Statement parse error: ${parsed.reason}`);
        }
        return;
      }

      setParseResult(parsed);

      // Only an exact issuer and card-ending match is selected; otherwise the user chooses.
      const matchedAccountId = suggestStatementAccount(
        { issuer: parsed.issuer, digits: parsed.account?.digits },
        accountList
      ).accountId || '';
      setSelectedAccountId(matchedAccountId);

      // Check if file was previously imported
      let isDup = false;
      if (db && computedHash) {
        try {
          const existing = await db.query(
            "SELECT 1 FROM raw_messages WHERE hash = ? AND kind = 'pdf_file' LIMIT 1;",
            [computedHash]
          );
          if (existing && existing.length > 0) {
            isDup = true;
          }
        } catch {}
      }
      setIsDuplicateFile(isDup);

      // Read current state to build preview plan
      const currentState = db ? await loadStateFromDb(db) : {};

      const generatedPlan = planStatementImport({
        result: parsed,
        fileHash: computedHash,
        accountId: matchedAccountId,
        state: currentState,
        isDuplicateFile: isDup,
      });

      setPlan(generatedPlan);
      setPassword('');
    } catch (err) {
      setErrorMessage(err?.message || 'An unexpected error occurred while processing statement.');
    } finally {
      if (isMountedRef.current) {
        setIsProcessing(false);
      }
    }
  };

  const handleRunExtract = async () => {
    if (!file) {
      setErrorMessage('Please select a PDF statement file first.');
      return;
    }
    const buffer = await file.arrayBuffer();
    await processStatementBuffer(buffer);
  };

  const handleAccountChange = async (newAccId) => {
    setSelectedAccountId(newAccId);
    if (!parseResult || !fileHash || !db) return;

    const currentState = await loadStateFromDb(db);

    const updatedPlan = planStatementImport({
      result: parseResult,
      fileHash,
      accountId: newAccId,
      state: currentState,
      isDuplicateFile,
    });
    setPlan(updatedPlan);
  };

  const handleConfirmImport = async (forceAnyway = false) => {
    if (!plan) return;
    if (!selectedAccountId) {
      setErrorMessage('Choose the account this statement belongs to.');
      return;
    }
    if (mismatch && !window.confirm(`This is a ${parseResult.issuer} statement, but the chosen account is from another bank. Import anyway?`)) {
      return;
    }
    try {
      setIsApplying(true);
      setErrorMessage('');

      let planToApply = plan;
      if (forceAnyway && isDuplicateFile) {
        // User explicitly chose "Import again anyway"
        const currentState = db ? await loadStateFromDb(db) : {};
        planToApply = planStatementImport({
          result: parseResult,
          fileHash,
          accountId: selectedAccountId,
          state: currentState,
          isDuplicateFile: false,
        });
        setPlan(planToApply);
      }

      await applyStatementImport({ plan: planToApply, writer, db });
      if (saveAlias && selectedAccount && parseResult?.account?.digits) {
        const withAlias = addAccountAlias(selectedAccount, { issuer: parseResult.issuer, digits: parseResult.account.digits });
        if (withAlias) await writer.write('account.upserted', withAlias);
      }
      await onReloadLookups();
      setImportResult(planToApply.summary);
      showToast('Statement imported successfully');
    } catch (err) {
      setErrorMessage(`Failed to apply import: ${err?.message || err}`);
    } finally {
      if (isMountedRef.current) {
        setIsApplying(false);
      }
    }
  };

  const handleUndoImport = async () => {
    if (!fileHash || !window.confirm('Remove the expenses this statement created?')) return;
    try {
      setIsApplying(true);
      const removed = await undoStatementImport({ fileHash, writer, db });
      showToast(`Removed ${removed} ${removed === 1 ? 'expense' : 'expenses'}`);
      await onReloadLookups();
      onBack();
    } catch (err) {
      setErrorMessage(`Failed to undo import: ${err?.message || err}`);
      if (isMountedRef.current) setIsApplying(false);
    }
  };

  const handleLoadSampleStatement = async () => {
    registerStatementParser(testBankParser);
    const sampleTextLines = [
      { page: 1, lineNo: 1, text: 'TESTBANK Card ending 1234' },
      { page: 1, lineNo: 2, text: '01/11/2026 | SWIGGY | 450.00 | Dr' },
      { page: 1, lineNo: 3, text: '02/11/2026 | AMAZON INDIA | 1,299.00 | Dr' },
      { page: 1, lineNo: 4, text: '03/11/2026 | PAYMENT RECEIVED | 5,000.00 | Cr' },
      { page: 1, lineNo: 5, text: 'TOTAL PURCHASES 1,749.00' },
      { page: 1, lineNo: 6, text: 'TOTAL PAYMENTS 5,000.00' },
    ];
    setFile({ name: 'sample_testbank_statement.pdf' });
    await processStatementBuffer(new ArrayBuffer(16), 'sample_testbank_hash_1', sampleTextLines);
  };

  const selectedAccount = accountList.find((a) => (a.id || a.accountId) === selectedAccountId) || null;
  const detected = { issuer: parseResult?.issuer, digits: parseResult?.account?.digits };
  const suggestion = suggestStatementAccount(detected, accountList, selectedAccountId);
  const mismatch = suggestion.issuerMismatch;
  const offerAlias = Boolean(selectedAccount && detected.digits && !mismatch && !accountHasEnding(selectedAccount, detected));
  const accountOptions = [
    ...suggestion.candidates,
    ...accountList.filter((a) => !suggestion.candidates.includes(a)),
  ];

  const getStatusChip = (status) => {
    switch (status) {
      case 'new':
        return <span style={{ background: 'var(--success-bg, #e6f4ea)', color: 'var(--success, #137333)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>New</span>;
      case 'linked_sms':
        return <span style={{ background: 'var(--info-bg, #e8f0fe)', color: 'var(--info, #1a73e8)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>Linked to SMS</span>;
      case 'already_imported':
        return <span style={{ background: 'var(--bg-secondary, #f1f3f4)', color: 'var(--text-secondary, #5f6368)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>Already imported</span>;
      case 'payment':
      case 'payment_linked':
        return <span style={{ background: 'var(--purple-bg, #f3e8fd)', color: 'var(--purple, #9334e6)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>Payment</span>;
      case 'possible_duplicate':
        return <span style={{ background: 'var(--warning-bg, #fef7e0)', color: 'var(--warning, #b06000)', padding: '2px 8px', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600 }}>Needs review</span>;
      default:
        return null;
    }
  };

  return (
    <div style={{ paddingBottom: '32px' }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '16px', gap: '8px' }}>
        <button type="button" className="btn btn-secondary" onClick={onBack}>
          ← Back
        </button>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
          📄 Import Statement
        </h2>
      </div>

      {/* Completion View */}
      {importResult && (
        <div className="card" style={{ textAlign: 'center', padding: '24px 16px' }}>
          <div style={{ fontSize: '2.5rem', marginBottom: '12px' }}>✅</div>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: '8px' }}>
            Import Complete
          </h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '16px' }}>
            {importResult.created} new expenses created, {importResult.linkedToSms} linked to SMS, {importResult.alreadyImported} already imported{importResult.repaired > 0 ? `, ${importResult.repaired} corrected` : ''}.
          </p>

          <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
            {importResult.possibleDuplicates > 0 && onNavigateToReview && (
              <button
                type="button"
                className="btn btn-primary"
                onClick={onNavigateToReview}
              >
                📋 Open Review ({importResult.possibleDuplicates})
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              style={{ color: 'var(--danger)' }}
              disabled={isApplying}
              onClick={handleUndoImport}
            >
              Undo this import
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onBack}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Step 1: File Selection & Options */}
      {!importResult && !plan && (
        <div className="card">
          <div className="card-header">
            <span className="card-title">Choose Statement PDF</span>
          </div>

          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '16px' }}>
            Select your monthly credit card statement PDF. Password and statement text are processed strictly on device and never logged or sent to servers.
          </p>

          <div className="form-group" style={{ marginBottom: '16px' }}>
            <input
              type="file"
              ref={fileInputRef}
              accept="application/pdf"
              onChange={handleFileChange}
              style={{ fontSize: '0.9rem' }}
            />
          </div>

          {showPasswordField && (
            <div className="form-group" style={{ marginBottom: '16px' }}>
              <label className="form-label">PDF Password</label>
              <input
                type="password"
                className="form-input"
                placeholder="Enter statement password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}

          {errorMessage && (
            <div
              style={{
                color: 'var(--danger, #d93025)',
                background: 'var(--danger-bg, #fce8e6)',
                padding: '8px 12px',
                borderRadius: '6px',
                fontSize: '0.85rem',
                marginBottom: '16px',
              }}
            >
              {errorMessage}
            </div>
          )}

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!file || isProcessing}
              onClick={handleRunExtract}
            >
              {isProcessing ? 'Reading Statement...' : 'Read Statement'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleLoadSampleStatement}
            >
              🧪 Load sample (testbank)
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Preview & Reconciliation */}
      {!importResult && plan && (
        <div>
          {/* Duplicate File Notice */}
          {isDuplicateFile && (
            <div
              className="card"
              style={{
                background: 'var(--warning-bg, #fef7e0)',
                borderLeft: '4px solid var(--warning, #f2994a)',
                marginBottom: '16px',
              }}
            >
              <h4 style={{ margin: '0 0 6px 0', fontSize: '0.95rem', fontWeight: 700 }}>
                ⚠️ Statement File Already Imported
              </h4>
              <p style={{ margin: '0 0 12px 0', fontSize: '0.85rem' }}>
                This statement was already imported earlier. All lines are safe against double counting. Importing again adds missed lines and corrects EMI and fee lines; your own edits are kept.
              </p>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={isApplying || !selectedAccountId}
                  onClick={() => handleConfirmImport(true)}
                >
                  Import again and correct
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ color: 'var(--danger)' }}
                  disabled={isApplying}
                  onClick={handleUndoImport}
                >
                  Undo earlier import
                </button>
              </div>
            </div>
          )}

          {/* Needs Attention Warning */}
          {plan.summary.needsAttention && !isDuplicateFile && (
            <div
              className="card"
              style={{
                background: 'var(--warning-bg, #fef7e0)',
                borderLeft: '4px solid var(--danger, #eb5757)',
                marginBottom: '16px',
              }}
            >
              <h4 style={{ margin: '0 0 6px 0', fontSize: '0.95rem', fontWeight: 700 }}>
                ⚠️ Attention Required Before Import
              </h4>
              <p style={{ margin: '0 0 8px 0', fontSize: '0.85rem' }}>
                Declared statement totals do not match the parsed lines, or some lines could not be read completely.
              </p>
              {parseResult.unparsedLines?.length > 0 && (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>
                  • {parseResult.unparsedLines.length} transaction {parseResult.unparsedLines.length === 1 ? 'line' : 'lines'} could not be parsed.
                </div>
              )}
            </div>
          )}

          {/* Account Selection */}
          <div className="card" style={{ marginBottom: '16px' }}>
            <div className="card-header">
              <span className="card-title">Statement Info & Account</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '8px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Issuer:</span>
              <span style={{ fontWeight: 600 }}>{parseResult.issuer}</span>
            </div>
            {parseResult.account?.digits && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', marginBottom: '8px' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Detected Card Ending:</span>
                <span style={{ fontWeight: 600 }}>•••• {parseResult.account.digits}</span>
              </div>
            )}
            <div className="form-group" style={{ marginTop: '12px' }}>
              <label className="form-label">Assign to Account</label>
              <select
                className="form-select"
                value={selectedAccountId}
                onChange={(e) => handleAccountChange(e.target.value)}
              >
                <option value="">Choose account…</option>
                {accountOptions.map((acc) => (
                  <option key={acc.id || acc.accountId} value={acc.id || acc.accountId}>
                    {acc.name} ({acc.type || 'account'})
                  </option>
                ))}
              </select>
            </div>
            {!selectedAccountId && (
              <div style={{ fontSize: '0.8rem', color: 'var(--warning)' }}>
                No account has this card ending yet. Choose the right one.
              </div>
            )}
            {mismatch && (
              <div style={{ fontSize: '0.8rem', color: 'var(--danger)' }}>
                ⚠️ This statement is from {parseResult.issuer}, but this account is from another bank.
              </div>
            )}
            {offerAlias && (
              <label style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.8rem', marginTop: '8px' }}>
                <input type="checkbox" checked={saveAlias} onChange={(e) => setSaveAlias(e.target.checked)} />
                Remember card ending {detected.digits} for this account
              </label>
            )}
          </div>

          {/* Summary Metric Chips */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))',
              gap: '8px',
              marginBottom: '16px',
            }}
          >
            <div className="card" style={{ textAlign: 'center', padding: '12px 8px' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{plan.summary.lines}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Total Lines</div>
            </div>
            <div className="card" style={{ textAlign: 'center', padding: '12px 8px' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--success, #137333)' }}>{plan.summary.created}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>New</div>
            </div>
            <div className="card" style={{ textAlign: 'center', padding: '12px 8px' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--info, #1a73e8)' }}>{plan.summary.linkedToSms}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Linked to SMS</div>
            </div>
            <div className="card" style={{ textAlign: 'center', padding: '12px 8px' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--purple, #9334e6)' }}>{plan.summary.payments}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Payments</div>
            </div>
            <div className="card" style={{ textAlign: 'center', padding: '12px 8px' }}>
              <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-secondary)' }}>{plan.summary.alreadyImported}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>Already Imported</div>
            </div>
          </div>

          {/* Preview of Lines */}
          <div className="card" style={{ marginBottom: '16px' }}>
            <div className="card-header">
              <span className="card-title">Statement Lines Preview</span>
            </div>

            <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
              {plan.plannedLines.map((pl, idx) => (
                <div
                  key={idx}
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
                    <div style={{ fontWeight: 600 }}>{pl.line.merchantRaw}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                      {pl.line.date} • {pl.line.direction.toUpperCase()}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700 }}>
                      {formatPaise(pl.line.amountPaise)}
                    </div>
                    <div style={{ marginTop: '2px' }}>
                      {getStatusChip(pl.status)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '8px' }}>
            {plan.summary.needsAttention ? (
              <button
                type="button"
                className="btn btn-secondary"
                style={{ borderColor: 'var(--warning)', color: 'var(--warning)', flex: 1 }}
                disabled={isApplying || !selectedAccountId}
                onClick={() => handleConfirmImport(false)}
              >
                {isApplying ? 'Importing...' : '⚠️ Import anyway'}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={isApplying || isDuplicateFile || !selectedAccountId}
                onClick={() => handleConfirmImport(false)}
              >
                {isApplying ? 'Importing...' : 'Confirm Import'}
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setPlan(null);
                setParseResult(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
