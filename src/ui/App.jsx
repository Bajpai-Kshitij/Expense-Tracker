import React, { useState, useEffect, useRef, useCallback } from 'react';
import './styles.css';

import { createCapacitorSqliteAdapter } from '../native/sqlite.js';
import { checkFolder } from '../native/expenseNative.js';
import { initRuntime } from '../native/syncRuntime.js';
import { withTimeout } from '../native/timeout.js';
import { logStepStart, logStepFinish } from '../native/onboardingProgress.js';
import { migrate, settings } from '../core/db/index.js';
import { seedIfEmpty } from '../core/seed/seed.js';
import { seedBrandsIfEmpty } from '../core/seed/brandSeed.js';

import Onboarding from './Onboarding.jsx';
import HomeTab from './HomeTab.jsx';
import ExpensesTab from './ExpensesTab.jsx';
import ReportsTab from './reports/ReportsTab.jsx';
import SettingsTab from './SettingsTab.jsx';
import ExpenseModal from './ExpenseModal.jsx';
import UncategorizedInbox from './UncategorizedInbox.jsx';
import RulesBrandsScreen from './RulesBrandsScreen.jsx';
import SmsImportScreen from './SmsImportScreen.jsx';
import ReviewScreen from './ReviewScreen.jsx';
import AccountsScreen from './AccountsScreen.jsx';
import StatementImport from './StatementImport.jsx';
import { countOpenReviewItems } from '../core/db/reviewQueue.js';
import { scanSms } from '../native/smsScan.js';
import { readSms } from '../native/expenseNative.js';
import { rowsToState } from '../core/db/index.js';

export default function App() {
  const [appState, setAppState] = useState('loading'); // 'loading' | 'onboarding' | 'repick' | 'ready' | 'startup_error'
  const [startupError, setStartupError] = useState(null); // { step: string, message: string } | null
  const [retryCount, setRetryCount] = useState(0);
  const [runtime, setRuntime] = useState(null);
  const [db, setDb] = useState(null);
  const [folderUri, setFolderUri] = useState('');
  const [folderStatus, setFolderStatus] = useState({ ok: true });
  const [deviceId, setDeviceId] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('Me');

  const [activeTab, setActiveTab] = useState('home'); // 'home' | 'expenses' | 'settings' | 'uncategorized' | 'rules_brands' | 'sms_import' | 'review' | 'accounts'
  const [categories, setCategories] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [brands, setBrands] = useState([]);
  const [rules, setRules] = useState([]);
  const [devices, setDevices] = useState([]);
  const [includeFixed, setIncludeFixed] = useState(false);
  const [openReviewCount, setOpenReviewCount] = useState(0);

  const [expenseFiltersOverride, setExpenseFiltersOverride] = useState({});
  const [reportsMonth, setReportsMonth] = useState(null);
  const [reportsIncludeFixed, setReportsIncludeFixed] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState(null);
  const [modalInitialValues, setModalInitialValues] = useState({});

  const [toastMessage, setToastMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [lastSyncIssuesCount, setLastSyncIssuesCount] = useState(0);

  const isSyncingRef = useRef(false);
  const isScanningRef = useRef(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const refreshKeyRef = useRef(0);
  const [refreshTick, setRefreshTick] = useState(0);

  const showToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  const loadLookups = async (database, currentRuntime) => {
    if (!database) return;
    try {
      const catRows = await database.query('SELECT * FROM categories ORDER BY name ASC;');
      const parsedCats = catRows.map((c) => {
        if (c.extras) {
          try {
            return { ...JSON.parse(c.extras), id: c.id };
          } catch (e) {}
        }
        return c;
      });
      setCategories(parsedCats);

      const accRows = await database.query('SELECT * FROM accounts ORDER BY name ASC;');
      const parsedAccs = accRows.map((a) => {
        if (a.extras) {
          try {
            return { ...JSON.parse(a.extras), id: a.id };
          } catch (e) {}
        }
        return a;
      });
      setAccounts(parsedAccs);

      const brandRows = await database.query('SELECT * FROM brands;');
      const parsedBrands = brandRows.map((b) => {
        if (b.extras) {
          try {
            return { ...JSON.parse(b.extras), id: b.id };
          } catch (e) {}
        }
        return { id: b.id, name: b.name, categoryId: b.default_category_id };
      });
      setBrands(parsedBrands);

      const ruleRows = await database.query('SELECT * FROM rules;');
      const parsedRules = ruleRows.map((r) => {
        if (r.extras) {
          try {
            return { ...JSON.parse(r.extras), id: r.id };
          } catch (e) {}
        }
        return { id: r.id, pattern: r.pattern, categoryId: r.category_id, accountId: r.account_id };
      });
      setRules(parsedRules);

      if (currentRuntime?.listDevices) {
        const devs = await currentRuntime.listDevices();
        setDevices(devs);
      }

      const revCount = await countOpenReviewItems(database);
      setOpenReviewCount(revCount);
    } catch (e) {
      console.error('Failed to load lookups:', e);
    }
  };

  const triggerSync = useCallback(async (currentRuntime = runtime, database = db) => {
    if (!currentRuntime || isSyncingRef.current) return;
    try {
      isSyncingRef.current = true;
      setIsSyncing(true);
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
      setIsSyncing(false);
    }
  }, [runtime, db]);

  // Initial App Startup
  useEffect(() => {
    let isMounted = true;

    async function startup() {
      let currentStep = 'Opening database';
      try {
        currentStep = 'Opening database';
        const database = await withTimeout(createCapacitorSqliteAdapter('expense_tracker'), 15000, 'Opening database');
        await withTimeout(migrate(database), 15000, 'Opening database');

        if (!isMounted) return;
        setDb(database);

        currentStep = 'Reading settings';
        const savedUri = await settings.getSetting(database, 'folderUri');
        const savedLabel = await settings.getSetting(database, 'deviceLabel');

        if (!savedUri) {
          setAppState('onboarding');
          return;
        }

        // Validate folder permission
        currentStep = 'Checking folder';
        let status = { ok: true };
        try {
          status = await withTimeout(checkFolder({ uri: savedUri }), 15000, 'Checking folder');
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

        currentStep = 'Initializing sync';
        const rt = await initRuntime({ folderUri: savedUri });
        if (!isMounted) return;
        setRuntime(rt);
        setDeviceId(rt.deviceId);
        if (rt.deviceLabel) setDeviceLabel(rt.deviceLabel);

        // Run initial sync and seed
        currentStep = 'First sync';
        await withTimeout(rt.sync(), 15000, 'First sync');

        currentStep = 'Seeding';
        await withTimeout(seedIfEmpty({ writer: rt.writer, db: database, settings }), 15000, 'Seeding');
        await withTimeout(seedBrandsIfEmpty({ writer: rt.writer, db: database, settings }), 15000, 'Seeding');
        await loadLookups(database, rt);

        setLastSyncTime(new Date());
        setAppState('ready');

        // Check for 15-minute background auto-scan on app open
        try {
          const autoScanVal = await settings.getSetting(database, 'sms_auto_scan');
          if (autoScanVal === 'true' || autoScanVal === '1') {
            const lastScanMsStr = await settings.getSetting(database, 'sms_last_scan_ms');
            const lastScanMs = lastScanMsStr ? Number(lastScanMsStr) : 0;
            const nowMs = Date.now();
            if (!lastScanMs || (nowMs - lastScanMs >= 15 * 60 * 1000)) {
              if (!isSyncingRef.current && !isScanningRef.current) {
                isScanningRef.current = true;
                const getState = async () => {
                  const rows = {
                    expenses: await database.query('SELECT * FROM expenses;'),
                    categories: await database.query('SELECT * FROM categories;'),
                    accounts: await database.query('SELECT * FROM accounts;'),
                    brands: await database.query('SELECT * FROM brands;'),
                    rules: await database.query('SELECT * FROM rules;'),
                    review_queue: await database.query('SELECT * FROM review_queue;'),
                  };
                  return rowsToState(rows);
                };

                scanSms({
                  readSms,
                  db: database,
                  writer: rt.writer,
                  getState,
                })
                  .then(async (summary) => {
                    if (summary && summary.created > 0) {
                      showToast(`${summary.created} new expenses from SMS`);
                      await loadLookups(database, rt);
                      setRefreshTick((prev) => prev + 1);
                    }
                  })
                  .catch(() => {})
                  .finally(() => {
                    isScanningRef.current = false;
                  });
              }
            }
          }
        } catch (e) {}
      } catch (err) {
        console.error(`Startup error during step "${currentStep}":`, err);
        if (!isMounted) return;
        setStartupError({ step: currentStep, message: err.message || String(err) });
        setAppState('startup_error');
      }
    }

    startup();

    return () => {
      isMounted = false;
    };
  }, [retryCount]);

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
    let database = db;
    if (!database) {
      logStepStart('Opening database');
      database = await withTimeout(createCapacitorSqliteAdapter('expense_tracker'), 15000, 'Opening database');
      await withTimeout(migrate(database), 15000, 'Opening database');
      setDb(database);
      logStepFinish('Opening database');
    }

    await settings.setSetting(database, 'folderUri', newUri);
    await settings.setSetting(database, 'deviceLabel', newLabel);

    setFolderUri(newUri);
    setDeviceLabel(newLabel);
    setFolderStatus({ ok: true });

    const rt = await initRuntime({ folderUri: newUri });
    setRuntime(rt);
    setDeviceId(rt.deviceId);

    await rt.sync();
    await seedIfEmpty({ writer: rt.writer, db: database, settings });
    await seedBrandsIfEmpty({ writer: rt.writer, db: database, settings });
    await loadLookups(database, rt);

    setLastSyncTime(new Date());
    setAppState('ready');
    showToast('Setup complete');
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

  if (appState === 'startup_error' || startupError) {
    return (
      <div className="app-shell" style={{ justifyContent: 'center', alignItems: 'center', padding: '24px' }}>
        <div className="card" style={{ padding: '24px', width: '100%', maxWidth: '420px' }}>
          <h1 style={{ fontSize: '1.2rem', fontWeight: 700, marginBottom: '12px' }}>Startup Failed</h1>
          <div className="alert-banner alert-danger" style={{ marginBottom: '16px' }}>
            <span>Step "{startupError?.step || 'Startup'}" failed: {startupError?.message || 'Unknown error'}</span>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            style={{ width: '100%', padding: '12px' }}
            onClick={() => {
              setStartupError(null);
              setAppState('loading');
              setRetryCount((c) => c + 1);
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

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
          <span className="app-subtitle">
            {deviceLabel} &bull; Offline-First
            {isSyncing && <span style={{ marginLeft: '8px', fontSize: '0.75rem', color: '#38bdf8' }}>⟳ Syncing...</span>}
          </span>
        </div>
        <button
          type="button"
          className="sync-button-header"
          disabled={isSyncing}
          onClick={handleManualSync}
        >
          {isSyncing ? '⏳ Syncing' : '🔄 Sync'}
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
      <main className="app-content">
        {activeTab === 'home' && (
          <HomeTab
            db={db}
            categoriesMap={categoriesMap}
            accountsMap={accountsMap}
            includeFixed={includeFixed}
            setIncludeFixed={setIncludeFixed}
            refreshTick={refreshTick}
            onNavigateToExpenses={(filters) => {
              setExpenseFiltersOverride(filters);
              setActiveTab('expenses');
            }}
            onNavigateToUncategorized={() => setActiveTab('uncategorized')}
            onNavigateToReview={() => setActiveTab('review')}
            onNavigateToSmsImport={() => setActiveTab('sms_import')}
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
            refreshTick={refreshTick}
            onSelectExpense={(exp) => {
              setEditingExpense(exp);
              setShowModal(true);
            }}
            onNavigateToUncategorized={() => setActiveTab('uncategorized')}
          />
        )}

        {activeTab === 'reports' && (
          <ReportsTab
            db={db}
            categories={categories}
            accounts={accounts}
            devices={devices}
            initialMonth={reportsMonth}
            onMonthChange={setReportsMonth}
            initialIncludeFixed={reportsIncludeFixed}
            onIncludeFixedChange={setReportsIncludeFixed}
            onNavigateToExpenses={(filters) => {
              setExpenseFiltersOverride(filters);
              setActiveTab('expenses');
            }}
            onNavigateToUncategorized={() => setActiveTab('uncategorized')}
            refreshTick={refreshTick}
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
            openReviewCount={openReviewCount}
            onSyncNow={handleManualSync}
            onRebuildFromLogs={handleRebuildFromLogs}
            onChangeFolder={() => setAppState('onboarding')}
            onUpdateDeviceLabel={handleUpdateDeviceLabel}
            onNavigateToRulesBrands={() => setActiveTab('rules_brands')}
            onNavigateToSmsImport={() => setActiveTab('sms_import')}
            onNavigateToStatementImport={() => setActiveTab('statement_import')}
            onNavigateToAccounts={() => setActiveTab('accounts')}
            onNavigateToReview={() => setActiveTab('review')}
          />
        )}

        {activeTab === 'uncategorized' && (
          <UncategorizedInbox
            db={db}
            writer={runtime?.writer}
            brands={brands}
            rules={rules}
            categories={categories}
            accounts={accounts}
            onBack={() => setActiveTab('home')}
            showToast={showToast}
            onRefreshLookups={async () => {
              await loadLookups(db, runtime);
              setRefreshTick((prev) => prev + 1);
            }}
          />
        )}

        {activeTab === 'rules_brands' && (
          <RulesBrandsScreen
            db={db}
            writer={runtime?.writer}
            brands={brands}
            rules={rules}
            categories={categories}
            accounts={accounts}
            onBack={() => setActiveTab('settings')}
            showToast={showToast}
            onReloadLookups={async () => {
              await loadLookups(db, runtime);
              setRefreshTick((prev) => prev + 1);
            }}
          />
        )}

        {activeTab === 'sms_import' && (
          <SmsImportScreen
            db={db}
            writer={runtime?.writer}
            onBack={() => setActiveTab('settings')}
            onNavigateToReview={() => setActiveTab('review')}
            showToast={showToast}
            onReloadLookups={async () => {
              await loadLookups(db, runtime);
              setRefreshTick((prev) => prev + 1);
            }}
          />
        )}

        {activeTab === 'statement_import' && (
          <StatementImport
            db={db}
            writer={runtime?.writer}
            accounts={accounts}
            onBack={() => setActiveTab('settings')}
            onNavigateToReview={() => setActiveTab('review')}
            showToast={showToast}
          />
        )}

        {activeTab === 'review' && (
          <ReviewScreen
            db={db}
            writer={runtime?.writer}
            accounts={accounts}
            categoriesMap={categoriesMap}
            accountsMap={accountsMap}
            onBack={() => setActiveTab('settings')}
            onAddManually={(prefill) => {
              setModalInitialValues(prefill);
              setEditingExpense(null);
              setShowModal(true);
            }}
            showToast={showToast}
            onReloadLookups={async () => {
              await loadLookups(db, runtime);
              setRefreshTick((prev) => prev + 1);
            }}
          />
        )}

        {activeTab === 'accounts' && (
          <AccountsScreen
            accounts={accounts}
            writer={runtime?.writer}
            onBack={() => setActiveTab('settings')}
            showToast={showToast}
            onReloadLookups={async () => {
              await loadLookups(db, runtime);
              setRefreshTick((prev) => prev + 1);
            }}
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
          className={`tab-btn ${activeTab === 'reports' ? 'active' : ''}`}
          onClick={() => setActiveTab('reports')}
        >
          <span className="tab-icon">📊</span>
          <span>Reports</span>
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
          initialValues={modalInitialValues}
          categories={categories}
          accounts={accounts}
          brands={brands}
          rules={rules}
          writer={runtime?.writer}
          deviceId={deviceId}
          onClose={() => {
            setShowModal(false);
            setEditingExpense(null);
            setModalInitialValues({});
          }}
          onSuccess={async (msg) => {
            setShowModal(false);
            setEditingExpense(null);
            setModalInitialValues({});
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
