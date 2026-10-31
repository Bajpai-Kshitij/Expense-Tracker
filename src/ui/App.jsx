import React, { useState, useEffect, useRef, useCallback } from 'react';
import './styles.css';

import { createCapacitorSqliteAdapter } from '../native/sqlite.js';
import { checkFolder } from '../native/expenseNative.js';
import { initRuntime } from '../native/syncRuntime.js';
import { migrate, settings } from '../core/db/index.js';
import { seedIfEmpty } from '../core/seed/seed.js';

import Onboarding from './Onboarding.jsx';
import HomeTab from './HomeTab.jsx';
import ExpensesTab from './ExpensesTab.jsx';
import SettingsTab from './SettingsTab.jsx';
import ExpenseModal from './ExpenseModal.jsx';

export default function App() {
  const [appState, setAppState] = useState('loading'); // 'loading' | 'onboarding' | 'repick' | 'ready'
  const [runtime, setRuntime] = useState(null);
  const [db, setDb] = useState(null);
  const [folderUri, setFolderUri] = useState('');
  const [folderStatus, setFolderStatus] = useState({ ok: true });
  const [deviceId, setDeviceId] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('Me');

  const [activeTab, setActiveTab] = useState('home'); // 'home' | 'expenses' | 'settings'
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [devices, setDevices] = useState([]);
  const [includeFixed, setIncludeFixed] = useState(false);

  const [expenseFiltersOverride, setExpenseFiltersOverride] = useState({});
  const [showModal, setShowModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);

  const [toastMessage, setToastMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [lastSyncIssuesCount, setLastSyncIssuesCount] = useState(0);

  const isSyncingRef = useRef(false);
  const refreshKeyRef = useRef(0);
  const [refreshTick, setRefreshTick] = useState(0);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  const loadLookups = async (database, currentRuntime) => {
    if (!database) return;
    try {
      const cats = await database.query('SELECT * FROM categories ORDER BY name ASC;');
      setCategories(cats);

      const accs = await database.query('SELECT * FROM accounts ORDER BY name ASC;');
      setAccounts(accs);

      if (currentRuntime?.listDevices) {
        const devs = await currentRuntime.listDevices();
        setDevices(devs);
      }
    } catch (e) {
      console.error('Failed to load lookups:', e);
    }
  };

  const triggerSync = useCallback(async (currentRuntime = runtime, database = db) => {
    if (!currentRuntime || isSyncingRef.current) return;
    try {
      isSyncingRef.current = true;
      const summary = await currentRuntime.sync();
      setLastSyncTime(new Date());
      setLastSyncIssuesCount(summary.issues?.length || 0);

      // Reload lookups & trigger tab refresh
      await loadLookups(database || currentRuntime.db, currentRuntime);
      setRefreshTick((prev) => prev + 1);
      return summary;
    } catch (err) {
      console.error('Sync failed:', err);
      setErrorMessage(`Sync failed: ${err.message}`);
    } finally {
      isSyncingRef.current = false;
    }
  }, [runtime, db]);

  // Initial App Startup
  useEffect(() => {
    let isMounted = true;

    async function startup() {
      try {
        const database = await createCapacitorSqliteAdapter('expense_tracker');
        await migrate(database);

        if (!isMounted) return;
        setDb(database);

        const savedUri = await settings.getSetting(database, 'folderUri');
        const savedLabel = await settings.getSetting(database, 'deviceLabel');

        if (!savedUri) {
          setAppState('onboarding');
          return;
        }

        // Validate folder permission
        let status = { ok: true };
        try {
          status = await checkFolder({ uri: savedUri });
        } catch (e) {
          status = { ok: false };
        }

        if (!status?.ok) {
          setFolderUri(savedUri);
          setFolderStatus(status);
          setAppState('repick');
          return;
        }

        setFolderUri(savedUri);
        setFolderStatus(status);
        if (savedLabel) setDeviceLabel(savedLabel);

        const rt = await initRuntime({ folderUri: savedUri });
        if (!isMounted) return;
        setRuntime(rt);
        setDeviceId(rt.deviceId);
        if (rt.deviceLabel) setDeviceLabel(rt.deviceLabel);

        // Run initial sync and seed
        await rt.sync();
        await seedIfEmpty({ writer: rt.writer, db: database, settings });
        await loadLookups(database, rt);

        setLastSyncTime(new Date());
        setAppState('ready');
      } catch (err) {
        console.error('Startup error:', err);
        setErrorMessage(`Startup error: ${err.message}`);
        setAppState('onboarding');
      }
    }

    startup();

    return () => {
      isMounted = false;
    };
  }, []);

  // Periodic and Visibility Change Sync Triggers
  useEffect(() => {
    if (appState !== 'ready' || !runtime) return;

    // Trigger sync on visibility change
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        triggerSync(runtime, db);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // 60-second periodic background sync while visible
    const timer = setInterval(() => {
      if (!document.hidden) {
        triggerSync(runtime, db);
      }
    }, 60000);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(timer);
    };
  }, [appState, runtime, db, triggerSync]);

  const handleOnboardingComplete = async ({ folderUri: newUri, label: newLabel }) => {
    try {
      if (!db) return;
      await settings.setSetting(db, 'folderUri', newUri);
      await settings.setSetting(db, 'deviceLabel', newLabel);

      setFolderUri(newUri);
      setDeviceLabel(newLabel);
      setFolderStatus({ ok: true });

      const rt = await initRuntime({ folderUri: newUri });
      setRuntime(rt);
      setDeviceId(rt.deviceId);

      await rt.sync();
      await seedIfEmpty({ writer: rt.writer, db, settings });
      await loadLookups(db, rt);

      setLastSyncTime(new Date());
      setAppState('ready');
      showToast('Setup complete');
    } catch (err) {
      console.error('Failed to complete setup:', err);
      setErrorMessage(`Setup failed: ${err.message}`);
    }
  };

  const handleManualSync = async () => {
    const summary = await triggerSync();
    if (summary) {
      showToast(`Synced: ${summary.newEvents} new events applied`);
    }
  };

  const handleRebuildFromLogs = async () => {
    if (!runtime) return;
    try {
      const summary = await runtime.rebuild();
      await loadLookups(db, runtime);
      setRefreshTick((prev) => prev + 1);
      showToast(`Rebuild complete: ${summary.totalEvents} events processed`);
    } catch (err) {
      setErrorMessage(`Rebuild failed: ${err.message}`);
    }
  };

  const handleUpdateDeviceLabel = async (newLabel) => {
    if (!runtime || !db) return;
    try {
      await settings.setSetting(db, 'deviceLabel', newLabel);
      setDeviceLabel(newLabel);

      // Re-write device-<id>.json
      const meta = {
        deviceId: runtime.deviceId,
        label: newLabel,
        createdAt: new Date().toISOString(),
      };
      await runtime.storage.writeFile(`device-${runtime.deviceId}.json`, JSON.stringify(meta, null, 2) + '\n');
      await loadLookups(db, runtime);
      showToast('Device label updated');
    } catch (err) {
      setErrorMessage(`Failed to update device label: ${err.message}`);
    }
  };

  const categoriesMap = categories.reduce((acc, c) => {
    acc[c.id] = c;
    return acc;
  }, {});

  const accountsMap = accounts.reduce((acc, a) => {
    acc[a.id] = a;
    return acc;
  }, {});

  if (appState === 'loading') {
    return (
      <div className="app-shell" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <p style={{ color: 'var(--text-secondary)' }}>Loading Expense Tracker...</p>
      </div>
    );
  }

  if (appState === 'onboarding') {
    return <Onboarding onComplete={handleOnboardingComplete} isRepickMode={false} currentLabel={deviceLabel} />;
  }

  if (appState === 'repick') {
    return <Onboarding onComplete={handleOnboardingComplete} isRepickMode={true} currentLabel={deviceLabel} />;
  }

  return (
    <div className="app-shell">
      {/* Top Header */}
      <header className="app-header">
        <div className="app-title-group">
          <h1>Expense Tracker</h1>
          <span className="app-subtitle">{deviceLabel} &bull; Offline-First</span>
        </div>
        <button
          type="button"
          className="sync-button-header"
          onClick={handleManualSync}
        >
          🔄 Sync
        </button>
      </header>

      {/* Dismissible Error Banner */}
      {errorMessage && (
        <div className="alert-banner alert-danger" style={{ margin: '8px 16px 0 16px' }}>
          <span>{errorMessage}</span>
          <button type="button" className="alert-close" onClick={() => setErrorMessage('')}>✕</button>
        </div>
      )}

      {/* Tab Content */}
      <main className="app-content" key={refreshTick}>
        {activeTab === 'home' && (
          <HomeTab
            db={db}
            categoriesMap={categoriesMap}
            accountsMap={accountsMap}
            includeFixed={includeFixed}
            setIncludeFixed={setIncludeFixed}
            onNavigateToExpenses={(filters) => {
              setExpenseFiltersOverride(filters);
              setActiveTab('expenses');
            }}
            onSelectExpense={(exp) => {
              setEditingExpense(exp);
              setShowModal(true);
            }}
          />
        )}

        {activeTab === 'expenses' && (
          <ExpensesTab
            db={db}
            categories={categories}
            accounts={accounts}
            devices={devices}
            categoriesMap={categoriesMap}
            accountsMap={accountsMap}
            initialFilters={expenseFiltersOverride}
            onSelectExpense={(exp) => {
              setEditingExpense(exp);
              setShowModal(true);
            }}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            folderUri={folderUri}
            folderStatus={folderStatus}
            deviceId={deviceId}
            deviceLabel={deviceLabel}
            devices={devices}
            lastSyncTime={lastSyncTime}
            lastSyncIssuesCount={lastSyncIssuesCount}
            onSyncNow={handleManualSync}
            onRebuildFromLogs={handleRebuildFromLogs}
            onChangeFolder={() => setAppState('onboarding')}
            onUpdateDeviceLabel={handleUpdateDeviceLabel}
          />
        )}
      </main>

      {/* Floating Action Button (FAB) */}
      <button
        type="button"
        className="fab-add"
        aria-label="Add Expense"
        onClick={() => {
          setEditingExpense(null);
          setShowModal(true);
        }}
      >
        +
      </button>

      {/* Bottom Tab Bar */}
      <nav className="tab-bar">
        <button
          type="button"
          className={`tab-btn ${activeTab === 'home' ? 'active' : ''}`}
          onClick={() => {
            setExpenseFiltersOverride({});
            setActiveTab('home');
          }}
        >
          <span className="tab-icon">🏠</span>
          <span>Home</span>
        </button>

        <button
          type="button"
          className={`tab-btn ${activeTab === 'expenses' ? 'active' : ''}`}
          onClick={() => {
            setExpenseFiltersOverride({});
            setActiveTab('expenses');
          }}
        >
          <span className="tab-icon">📋</span>
          <span>Expenses</span>
        </button>

        <button
          type="button"
          className={`tab-btn ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          <span className="tab-icon">⚙️</span>
          <span>Settings</span>
        </button>
      </nav>

      {/* Add / Edit Expense Modal */}
      {showModal && (
        <ExpenseModal
          expense={editingExpense}
          categories={categories}
          accounts={accounts}
          writer={runtime?.writer}
          deviceId={deviceId}
          onClose={() => {
            setShowModal(false);
            setEditingExpense(null);
          }}
          onSuccess={async (msg) => {
            setShowModal(false);
            setEditingExpense(null);
            showToast(msg);
            await loadLookups(db, runtime);
            setRefreshTick((prev) => prev + 1);
          }}
        />
      )}

      {/* Toast Banner */}
      {toastMessage && (
        <div className="toast-banner">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
