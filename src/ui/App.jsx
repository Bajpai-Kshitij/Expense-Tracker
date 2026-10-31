import React, { useState } from 'react';
import { formatPaise, addPaise, subtractPaise } from '../core/money.js';
import { isNativePlatform, getPlatform } from '../native/index.js';
import NativeDebug from './NativeDebug.jsx';
import './App.css';

export default function App() {
  const [paise, setPaise] = useState(1250); // Initial 1250 paise = ₹12.50

  const handleAdd = (amount) => {
    setPaise((prev) => addPaise(prev, amount));
  };

  const handleSubtract = (amount) => {
    setPaise((prev) => {
      const next = subtractPaise(prev, amount);
      return next >= 0 ? next : 0;
    });
  };

  return (
    <div className="app-container">
      <header>
        <span className="badge">Phase P0 &bull; Scaffold</span>
        <h1>Expense Tracker</h1>
        <p className="subtitle">Offline-First &bull; Android &bull; Event Log</p>
      </header>

      <main>
        <div className="card">
          <h2>Hello from Android!</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '12px' }}>
            The app shell is running smoothly on your device with Vite, React, and Capacitor.
          </p>
          <div className="status-row">
            <span className="status-label">Platform</span>
            <span className="status-value">{getPlatform()} ({isNativePlatform() ? 'Native' : 'Web'})</span>
          </div>
          <div className="status-row">
            <span className="status-label">Storage Engine</span>
            <span className="status-value">Local-First (SQLite + JSONL)</span>
          </div>
          <div className="status-row">
            <span className="status-label">Core Business Logic</span>
            <span className="status-value">Pure JS / Integer Paise</span>
          </div>
        </div>

        <div className="card">
          <h2>Integer Paise Demo</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            All monetary values are stored strictly as integer paise to eliminate floating point rounding errors.
          </p>

          <div className="highlight-box">
            <div className="highlight-paise">{formatPaise(paise)}</div>
            <div className="highlight-sub">{paise} integer paise</div>
          </div>

          <div className="interactive-box">
            <button type="button" onClick={() => handleAdd(100)}>+ ₹1.00</button>
            <button type="button" onClick={() => handleAdd(500)}>+ ₹5.00</button>
            <button type="button" className="secondary" onClick={() => handleSubtract(100)}>- ₹1.00</button>
          </div>
        </div>

        <div className="card">
          <h2>Architecture Layout</h2>
          <div className="status-row">
            <span className="status-label">src/core/</span>
            <span className="status-value">Pure functions + Vitest</span>
          </div>
          <div className="status-row">
            <span className="status-label">src/ui/</span>
            <span className="status-value">React UI Shell</span>
          </div>
          <div className="status-row">
            <span className="status-label">src/native/</span>
            <span className="status-value">Capacitor Bridge</span>
          </div>
          <div className="status-row">
            <span className="status-label">android/</span>
            <span className="status-value">Native Android Gradle Project</span>
          </div>
        </div>

        <NativeDebug />
      </main>

      <footer>
        Expense Tracker &bull; Phase P0 Scaffold Ready
      </footer>
    </div>
  );
}

