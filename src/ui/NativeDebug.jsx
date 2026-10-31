import React, { useState, useRef } from 'react';
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
import { listExpenses, totals } from '../core/db/queries.js';

export default function NativeDebug() {
  const [folderUri, setFolderUri] = useState(
    () => localStorage.getItem('debug_folder_uri') || ''
  );
  const [output, setOutput] = useState('Native Debug Output will appear here...');
  const runtimeRef = useRef(null);

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

        {/* Phase P4 Sync Controls */}
        <button type="button" onClick={handleInitDevice}>Init device</button>
        <button type="button" onClick={handleWriteTestExpense}>Write test expense event</button>
        <button type="button" onClick={handleSyncNow}>Sync now</button>
        <button type="button" onClick={handleRebuildFromLogs}>Rebuild from logs</button>
        <button type="button" onClick={handleWriteFakeOtherDeviceFile}>Write fake other-device file</button>
        <button type="button" onClick={handleShowExpenseCountAndTotal}>Show expense count and total</button>
      </div>

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
