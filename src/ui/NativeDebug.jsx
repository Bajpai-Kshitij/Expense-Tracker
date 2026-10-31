import React, { useState } from 'react';
import {
  pickFolder,
  checkFolder,
  listFiles,
  writeFile,
  appendLine,
  readFile,
  readSms,
} from '../native/expenseNative.js';

export default function NativeDebug() {
  const [folderUri, setFolderUri] = useState(
    () => localStorage.getItem('debug_folder_uri') || ''
  );
  const [output, setOutput] = useState('Native Debug Output will appear here...');

  const log = (msg) => {
    const formatted = typeof msg === 'object' ? JSON.stringify(msg, null, 2) : String(msg);
    setOutput((prev) => `${new Date().toLocaleTimeString()} - ${formatted}\n\n${prev}`);
  };

  const handlePickFolder = async () => {
    try {
      const res = await pickFolder();
      setFolderUri(res.uri);
      localStorage.setItem('debug_folder_uri', res.uri);
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

  return (
    <div className="card" style={{ marginTop: '16px' }}>
      <h2>Native Debug (P3)</h2>
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

