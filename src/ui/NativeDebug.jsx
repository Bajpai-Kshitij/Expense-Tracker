import React, { useState, useRef, useEffect } from 'react';
import {
  pickFolder,
  checkFolder,
  listFiles,
  writeFile,
  appendLine,
  readFile,
  readSms,
} from '../native/expenseNative.js';
import { initRuntime } from '../native/syncRuntime.js';
import { createEvent, serializeEvent } from '../core/events/event.js';
import { expenseIdFromDedupeKey } from '../core/events/id.js';
import { listExpenses, totals, settings } from '../core/db/queries.js';
import { parseSms } from '../core/ingest/index.js';
import { maskForSharing } from '../core/ingest/mask.js';

export default function NativeDebug() {
  const [folderUri, setFolderUri] = useState(
    () => localStorage.getItem('debug_folder_uri') || ''
  );
  const [ownerNamesInput, setOwnerNamesInput] = useState('');
  const [isSavingOwnerNames, setIsSavingOwnerNames] = useState(false);
  const [maskedUnparsedList, setMaskedUnparsedList] = useState(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [output, setOutput] = useState('Native Debug Output will appear here...');
  const runtimeRef = useRef(null);

  useEffect(() => {
    async function loadOwnerNames() {
      try {
        if (!folderUri) return;
        const rt = runtimeRef.current || (await getRuntime());
        if (rt?.db) {
          const val = await settings.getSetting(rt.db, 'owner_names');
          if (val) setOwnerNamesInput(val);
        }
      } catch (e) {}
    }
    loadOwnerNames();
  }, [folderUri]);

  const handleSaveOwnerNames = async () => {
    try {
      setIsSavingOwnerNames(true);
      const rt = await getRuntime();
      await settings.setSetting(rt.db, 'owner_names', ownerNamesInput.trim());
      log(`Saved owner_names setting: "${ownerNamesInput.trim()}"`);
    } catch (err) {
      log(`Failed to save owner names: ${err.message}`);
    } finally {
      setIsSavingOwnerNames(false);
    }
  };

  const log = (msg) => {
    const formatted = typeof msg === 'object' ? JSON.stringify(msg, null, 2) : String(msg);
    setOutput((prev) => `${new Date().toLocaleTimeString()} - ${formatted}\n\n${prev}`);
  };

  const getRuntime = async () => {
    if (!folderUri) {
      throw new Error('Pick a folder first!');
    }
    if (!runtimeRef.current) {
      runtimeRef.current = await initRuntime({ folderUri });
    }
    return runtimeRef.current;
  };

  const handlePickFolder = async () => {
    try {
      const res = await pickFolder();
      setFolderUri(res.uri);
      localStorage.setItem('debug_folder_uri', res.uri);
      runtimeRef.current = null;
      log(`Picked folder: ${res.name}\nURI: ${res.uri}`);
    } catch (err) {
      log(`pickFolder failed: ${err.message} (${err.code || 'UNKNOWN'})`);
    }
  };

  const handleCheckFolder = async () => {
    try {
      if (!folderUri) {
        log('Error: No folder URI selected yet. Pick a folder first or set debug_folder_uri in localStorage.');
        return;
      }
      const res = await checkFolder({ uri: folderUri });
      log(`checkFolder: ok=${res.ok}, canRead=${res.canRead}, canWrite=${res.canWrite}`);
    } catch (err) {
      log(`checkFolder failed: ${err.message} (${err.code || 'UNKNOWN'})`);
    }
  };

  const handleListFiles = async () => {
    try {
      if (!folderUri) {
        log('Error: Pick folder first.');
        return;
      }
      const files = await listFiles({ uri: folderUri, prefix: 'events-' });
      log(files);
    } catch (err) {
      log(`listFiles failed: ${err.message} (${err.code || 'UNKNOWN'})`);
    }
  };

  const handleWriteTest = async () => {
    try {
      if (!folderUri) {
        log('Error: Pick folder first.');
        return;
      }
      const res = await writeFile({
        uri: folderUri,
        name: 'test.txt',
        text: `Test file created at ${new Date().toISOString()}\n`,
      });
      log(`writeFile (test.txt): wrote ${res.bytes} bytes`);
    } catch (err) {
      log(`writeFile failed: ${err.message} (${err.code || 'UNKNOWN'})`);
    }
  };

  const handleAppendLines = async () => {
    try {
      if (!folderUri) {
        log('Error: Pick folder first.');
        return;
      }
      const results = [];
      for (let i = 1; i <= 3; i++) {
        const line = `{"event":"test_line_${i}","ts":"${new Date().toISOString()}"}\n`;
        const res = await appendLine({
          uri: folderUri,
          name: 'events-test.jsonl',
          line,
        });
        results.push(`Line ${i}: mode=${res.mode}, bytes=${res.bytes}`);
      }
      log(`appendLine results:\n${results.join('\n')}`);
    } catch (err) {
      log(`appendLine failed: ${err.message} (${err.code || 'UNKNOWN'})`);
    }
  };

  const handleReadFile = async () => {
    try {
      if (!folderUri) {
        log('Error: Pick folder first.');
        return;
      }
      const res = await readFile({
        uri: folderUri,
        name: 'events-test.jsonl',
      });
      log(`readFile (events-test.jsonl):\n${res.text}`);
    } catch (err) {
      log(`readFile failed: ${err.message} (${err.code || 'UNKNOWN'})`);
    }
  };

  const handleReadSms = async () => {
    try {
      const messages = await readSms({ limit: 20 });
      const summary = messages.map((m) => ({
        id: m.id,
        address: m.address,
        bodyPreview: m.body.slice(0, 40),
        date: new Date(m.date).toLocaleString(),
      }));
      log(summary);
    } catch (err) {
      log(`readSms failed: ${err.message} (${err.code || 'UNKNOWN'})`);
    }
  };

  const handleParseLast100Sms = async () => {
    try {
      const messages = await readSms({ limit: 100 });
      let accounts = [];
      let ownerNames = [];
      try {
        if (runtimeRef.current?.db) {
          const rows = await runtimeRef.current.db.query('SELECT * FROM accounts;');
          accounts = rows.map((r) => (r.extras ? { ...JSON.parse(r.extras), id: r.id } : r));

          const savedNames = await settings.getSetting(runtimeRef.current.db, 'owner_names');
          if (savedNames) {
            ownerNames = savedNames.split(',').map((s) => s.trim()).filter(Boolean);
          }
        }
      } catch (e) {}

      if (ownerNames.length === 0 && ownerNamesInput.trim()) {
        ownerNames = ownerNamesInput.split(',').map((s) => s.trim()).filter(Boolean);
      }

      const counts = { parsed: 0, ignored: 0, unparsed: 0, unknown: 0 };
      const issuerCounts = {};
      const lines = [];

      for (const msg of messages) {
        const res = parseSms(msg, { accounts, ownerNames });
        counts[res.status] = (counts[res.status] || 0) + 1;

        if (res.txn?.issuer) {
          issuerCounts[res.txn.issuer] = (issuerCounts[res.txn.issuer] || 0) + 1;
        }

        const amtStr =
          res.txn?.amountPaise !== undefined ? `Rs ${(res.txn.amountPaise / 100).toFixed(2)}` : '—';
        const kindStr = res.txn?.kind || '—';
        let accountName = 'unknown account';
        if (res.txn?.accountId) {
          const acc = accounts.find((a) => a.id === res.txn.accountId);
          accountName = acc?.name || res.txn.accountId;
        }
        const dateStr = res.txn?.date || (msg.date ? new Date(msg.date).toISOString().slice(0, 10) : '—');
        const reasonStr = res.reason ? ` reason=${res.reason}` : '';

        lines.push(
          `status=${res.status} kind=${kindStr} amount=${amtStr} account=${accountName} date=${dateStr}${reasonStr}`
        );
      }

      const issuerSummary =
        Object.keys(issuerCounts).length > 0
          ? Object.entries(issuerCounts)
              .map(([iss, cnt]) => `${iss}=${cnt}`)
              .join(', ')
          : 'none';

      const summary =
        `SMS Dry Run (last ${messages.length} messages):\n` +
        `Counts: parsed=${counts.parsed}, ignored=${counts.ignored}, unparsed=${counts.unparsed}, unknown=${counts.unknown}\n` +
        `Issuer counts: ${issuerSummary}\n\n` +
        lines.join('\n');

      log(summary);
    } catch (err) {
      log(`Parse SMS dry run failed: ${err.message} (${err.code || 'UNKNOWN'})`);
    }
  };

  const handleShowMaskedUnparsed = async () => {
    try {
      const messages = await readSms({ limit: 300 });
      let accounts = [];
      let ownerNames = [];
      try {
        if (runtimeRef.current?.db) {
          const rows = await runtimeRef.current.db.query('SELECT * FROM accounts;');
          accounts = rows.map((r) => (r.extras ? { ...JSON.parse(r.extras), id: r.id } : r));

          const savedNames = await settings.getSetting(runtimeRef.current.db, 'owner_names');
          if (savedNames) {
            ownerNames = savedNames.split(',').map((s) => s.trim()).filter(Boolean);
          }
        }
      } catch (e) {}

      if (ownerNames.length === 0 && ownerNamesInput.trim()) {
        ownerNames = ownerNamesInput.split(',').map((s) => s.trim()).filter(Boolean);
      }

      const unparsedMasked = [];
      for (const msg of messages) {
        const res = parseSms(msg, { accounts, ownerNames });
        if (res.status === 'unparsed') {
          unparsedMasked.push(maskForSharing(msg.body || ''));
        }
      }

      setMaskedUnparsedList(unparsedMasked);
    } catch (err) {
      // Screen only: do not log, store, or send
    }
  };

  const handleCopyMessage = async (text) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopyStatus('Copied!');
        setTimeout(() => setCopyStatus(''), 2000);
      }
    } catch (e) {}
  };

  const handleCopyAll = async () => {
    try {
      if (navigator?.clipboard?.writeText && maskedUnparsedList?.length) {
        await navigator.clipboard.writeText(maskedUnparsedList.join('\n\n---\n\n'));
        setCopyStatus('Copied all!');
        setTimeout(() => setCopyStatus(''), 2000);
      }
    } catch (e) {}
  };

  // Phase P4 Sync Debug Handlers
  const handleInitDevice = async () => {
    try {
      const runtime = await getRuntime();
      log(`Init device successful:\nDevice ID: ${runtime.deviceId}\nLabel: ${runtime.deviceLabel}`);
    } catch (err) {
      log(`Init device failed: ${err.message}`);
    }
  };

  const handleWriteTestExpense = async () => {
    try {
      const runtime = await getRuntime();
      const randomAmount = Math.floor(Math.random() * 50000) + 1000;
      const dedupeKey = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const expenseId = expenseIdFromDedupeKey(dedupeKey);
      const today = new Date().toISOString().slice(0, 10);
      const nowIso = new Date().toISOString();

      const ev = await runtime.writer.write('expense.created', {
        expenseId,
        amount_paise: randomAmount,
        date: today,
        txn_ts: nowIso,
        direction: 'debit',
        kind: 'spend',
        merchant_raw: 'Test Merchant',
        brand: 'Test Brand',
        dedupe_key: dedupeKey,
        status: 'active',
      });

      const list = await listExpenses(runtime.db);
      log(`Wrote test expense event:\nID: ${ev.id}\nAmount: ${randomAmount} paise\nSeq: ${ev.seq}\nTotal expenses in DB: ${list.length}`);
    } catch (err) {
      log(`Write test expense failed: ${err.message}`);
    }
  };

  const handleSyncNow = async () => {
    try {
      const runtime = await getRuntime();
      const res = await runtime.sync();
      log({ syncNow: res });
    } catch (err) {
      log(`Sync now failed: ${err.message}`);
    }
  };

  const handleRebuildFromLogs = async () => {
    try {
      const runtime = await getRuntime();
      const res = await runtime.rebuild();
      log({ rebuildFromLogs: res });
    } catch (err) {
      log(`Rebuild from logs failed: ${err.message}`);
    }
  };

  const handleWriteFakeOtherDeviceFile = async () => {
    try {
      const runtime = await getRuntime();
      const nowIso = new Date().toISOString();
      const today = nowIso.slice(0, 10);

      const dedupe1 = `fake01-tx-${Date.now()}-1`;
      const id1 = expenseIdFromDedupeKey(dedupe1);
      const ev1 = createEvent({
        type: 'expense.created',
        dev: 'dev-fake01',
        seq: 1,
        ts: nowIso,
        data: {
          expenseId: id1,
          amount_paise: 25000,
          date: today,
          txn_ts: nowIso,
          direction: 'debit',
          kind: 'spend',
          merchant_raw: 'Fake Store Alpha',
          dedupe_key: dedupe1,
          status: 'active',
        },
      });

      const dedupe2 = `fake01-tx-${Date.now()}-2`;
      const id2 = expenseIdFromDedupeKey(dedupe2);
      const ev2 = createEvent({
        type: 'expense.created',
        dev: 'dev-fake01',
        seq: 2,
        ts: nowIso,
        data: {
          expenseId: id2,
          amount_paise: 42000,
          date: today,
          txn_ts: nowIso,
          direction: 'debit',
          kind: 'spend',
          merchant_raw: 'Fake Store Beta',
          dedupe_key: dedupe2,
          status: 'active',
        },
      });

      const content = serializeEvent(ev1) + serializeEvent(ev2);
      await runtime.storage.writeFile('events-dev-fake01.jsonl', content);
      log(`Wrote fake other-device file: events-dev-fake01.jsonl with 2 valid expense events:\n1) ${id1} (25000 paise)\n2) ${id2} (42000 paise)`);
    } catch (err) {
      log(`Write fake other-device file failed: ${err.message}`);
    }
  };

  const handleShowExpenseCountAndTotal = async () => {
    try {
      const runtime = await getRuntime();
      const list = await listExpenses(runtime.db);
      const tot = await totals(runtime.db);
      log({
        expenseCount: list.length,
        spendPaise: tot.spendPaise,
        spendRupees: (tot.spendPaise / 100).toFixed(2),
        refundPaise: tot.refundPaise,
        netPaise: tot.netPaise,
      });
    } catch (err) {
      log(`Show expense count and total failed: ${err.message}`);
    }
  };

  return (
    <div className="card" style={{ marginTop: '16px' }}>
      <h2>Native & Sync Debug (P3/P4)</h2>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
        Current Folder URI: {folderUri ? folderUri.slice(0, 40) + '...' : '(none)'}
      </p>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Owner names (comma separated)"
          value={ownerNamesInput}
          onChange={(e) => setOwnerNamesInput(e.target.value)}
          style={{
            flex: 1,
            padding: '8px 12px',
            borderRadius: '6px',
            border: '1px solid var(--border-color, #334155)',
            background: 'var(--bg-input, #0f172a)',
            color: 'var(--text-primary, #f8fafc)',
            fontSize: '0.875rem',
          }}
        />
        <button
          type="button"
          onClick={handleSaveOwnerNames}
          disabled={isSavingOwnerNames}
          style={{ whiteSpace: 'nowrap' }}
        >
          {isSavingOwnerNames ? 'Saving...' : 'Save'}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
        <button type="button" onClick={handlePickFolder}>Pick folder</button>
        <button type="button" onClick={handleCheckFolder}>Check folder</button>
        <button type="button" onClick={handleListFiles}>List files</button>
        <button type="button" onClick={handleWriteTest}>Write test.txt</button>
        <button type="button" onClick={handleAppendLines}>Append 3 lines</button>
        <button type="button" onClick={handleReadFile}>Read events-test.jsonl</button>
        <button type="button" style={{ gridColumn: 'span 2' }} onClick={handleReadSms}>
          Read last 20 SMS (sender + 40 chars)
        </button>
        <button type="button" style={{ gridColumn: 'span 2' }} onClick={handleParseLast100Sms}>
          Parse last 100 SMS (dry run)
        </button>
        <button type="button" style={{ gridColumn: 'span 2' }} onClick={handleShowMaskedUnparsed}>
          Show masked unparsed messages (screen only)
        </button>

        {/* Phase P4 Sync Controls */}
        <button type="button" onClick={handleInitDevice}>Init device</button>
        <button type="button" onClick={handleWriteTestExpense}>Write test expense event</button>
        <button type="button" onClick={handleSyncNow}>Sync now</button>
        <button type="button" onClick={handleRebuildFromLogs}>Rebuild from logs</button>
        <button type="button" onClick={handleWriteFakeOtherDeviceFile}>Write fake other-device file</button>
        <button type="button" onClick={handleShowExpenseCountAndTotal}>Show expense count and total</button>
      </div>

      {maskedUnparsedList !== null && (
        <div style={{ marginBottom: '12px', border: '1px solid var(--border-color, #334155)', borderRadius: '8px', padding: '12px', background: '#090d16' }}>
          <div style={{ color: '#ef4444', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '8px' }}>
            Check names before sharing.
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
              Unparsed count: {maskedUnparsedList.length}
            </span>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {copyStatus && <span style={{ fontSize: '0.75rem', color: '#22c55e' }}>{copyStatus}</span>}
              {maskedUnparsedList.length > 0 && (
                <button type="button" onClick={handleCopyAll} style={{ fontSize: '0.75rem', padding: '4px 8px' }}>
                  Copy all
                </button>
              )}
              <button
                type="button"
                onClick={() => setMaskedUnparsedList(null)}
                style={{ fontSize: '0.75rem', padding: '4px 8px' }}
              >
                Close
              </button>
            </div>
          </div>

          {maskedUnparsedList.length === 0 ? (
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>No unparsed messages found in last 300 SMS.</p>
          ) : (
            <div style={{ maxHeight: '250px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {maskedUnparsedList.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    background: '#0f172a',
                    border: '1px solid #1e293b',
                    borderRadius: '6px',
                    padding: '8px',
                    fontSize: '0.75rem',
                    color: '#f8fafc',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
                    <button
                      type="button"
                      onClick={() => handleCopyMessage(item)}
                      style={{ fontSize: '0.7rem', padding: '2px 6px' }}
                    >
                      Copy
                    </button>
                  </div>
                  <div>{item}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <pre
        style={{
          background: '#090d16',
          padding: '10px',
          borderRadius: '8px',
          maxHeight: '200px',
          overflowY: 'auto',
          fontSize: '0.75rem',
          color: '#38bdf8',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}
      >
        {output}
      </pre>
    </div>
  );
}
