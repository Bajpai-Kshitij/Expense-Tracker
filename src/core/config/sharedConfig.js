import { loadStateFromDb } from '../db/sync.js';

/**
 * config.json lives in the shared folder and holds everything except transactions:
 * accounts, categories, brands, rules, household names and senders. Both phones read and
 * write it. Accounts and the like still sync as events; the file is what a phone is rebuilt
 * from after a fresh start. "epoch" marks the last fresh start: a phone that has not applied
 * it wipes its data, and events older than it are ignored.
 */
export const CONFIG_FILE = 'config.json';

const LOCAL_TABLES = [
  'expenses', 'categories', 'brands', 'rules', 'accounts', 'review_queue',
  'raw_messages', 'applied_events', 'pending_events', 'expense_keys', 'sync_state',
];
const SCAN_STATE_KEYS = ['sms_last_scan_ms', 'sms_last_scan_read_count', 'last_redact_ms'];
const SEED_FLAGS = ['seeded', 'seeded_brands', 'seeded_cat_fees'];

const norm = (v) => String(v || '').trim().toLowerCase();
const idOf = (e) => e.id || e.accountId || e.categoryId || e.brandId || e.ruleId || e.name;

async function getSetting(db, key) {
  return (await db.query('SELECT value FROM settings WHERE key = ?;', [key]))[0]?.value ?? null;
}
function setSetting(db, key, value) {
  return db.exec('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);', [key, value]);
}

function parseList(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Older installs stored comma-separated text.
  }
  return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

const sortedUnion = (a, b) => [...new Set([...a, ...b])].sort();

async function readLocalSettings(db) {
  return {
    householdNames: parseList(await getSetting(db, 'owner_names')).sort(),
    smsSenders: parseList(await getSetting(db, 'sms_senders')).sort(),
    smsAutoScan: await getSetting(db, 'sms_auto_scan'),
  };
}

async function writeLocalSettings(db, s) {
  await setSetting(db, 'owner_names', JSON.stringify(s.householdNames || []));
  await setSetting(db, 'sms_senders', JSON.stringify(s.smsSenders || []));
  if (s.smsAutoScan !== null && s.smsAutoScan !== undefined) {
    await setSetting(db, 'sms_auto_scan', s.smsAutoScan);
  }
}

const sameSettings = (a, b) =>
  JSON.stringify([a.householdNames, a.smsSenders, a.smsAutoScan ?? null]) ===
  JSON.stringify([b.householdNames, b.smsSenders, b.smsAutoScan ?? null]);

function entitiesFrom(collection) {
  return Object.values(collection || {})
    .filter((e) => e && !e._deleted)
    .map(({ _lww, seed, ...rest }) => rest)
    .sort((a, b) => String(idOf(a)).localeCompare(String(idOf(b))));
}

function buildConfig({ state, epoch, settings }) {
  return {
    version: 1,
    epoch: epoch || null,
    settings,
    accounts: entitiesFrom(state.accounts),
    categories: entitiesFrom(state.categories),
    brands: entitiesFrom(state.brands),
    rules: entitiesFrom(state.rules),
  };
}

const serialize = (config) => `${JSON.stringify(config, null, 2)}\n`;

/**
 * Removes aliases that cannot be right: one from a different bank, or one equal to another
 * account's own number at that bank.
 */
export function cleanAliases(accounts = []) {
  const ownSuffix = (a) => String(a.lastDigits || a.digits || '').slice(-3);
  return accounts.map((acc) => ({
    ...acc,
    aliases: (acc.aliases || []).filter((alias) => {
      if (acc.issuer && norm(alias.issuer) !== norm(acc.issuer)) return false;
      const suffix = String(alias.digits || '').slice(-3);
      return !accounts.some((o) => o !== acc && norm(o.issuer) === norm(alias.issuer) && ownSuffix(o) && ownSuffix(o) === suffix);
    }),
  }));
}

/** Returns the parsed file, null if absent. A damaged file throws, so it is never overwritten. */
export async function readConfig(storage) {
  const text = await storage.readFile(CONFIG_FILE);
  return text ? JSON.parse(text) : null;
}

async function resetLocalData(db, epoch) {
  await db.transaction(async (tx) => {
    for (const table of LOCAL_TABLES) {
      await tx.exec(`DELETE FROM ${table};`);
    }
    for (const key of SCAN_STATE_KEYS) {
      await tx.exec('DELETE FROM settings WHERE key = ?;', [key]);
    }
    await tx.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('data_epoch', ?);", [epoch]);
  });
}

/**
 * Runs before reading events: applies a fresh start made on the other phone.
 * @returns {Promise<{ config: object|null, reset: boolean, invalid: boolean }>}
 */
export async function prepareConfigSync({ storage, db }) {
  let config;
  try {
    config = await readConfig(storage);
  } catch {
    return { config: null, reset: false, invalid: true };
  }

  const localEpoch = await getSetting(db, 'data_epoch');
  if (config?.epoch && (!localEpoch || config.epoch > localEpoch)) {
    await resetLocalData(db, config.epoch);
    return { config, reset: true, invalid: false };
  }
  return { config, reset: false, invalid: false };
}

/**
 * Runs after reading events: adds configuration this phone lacks, reconciles settings,
 * and updates the file if this phone knows more than it does.
 * @returns {Promise<{ added: number }>}
 */
export async function finishConfigSync({ storage, db, writer, config, invalid = false, now = () => Date.now() }) {
  if (invalid) return { added: 0 };

  let added = 0;
  if (config) {
    const state = await loadStateFromDb(db);
    const missing = (type, list, existing) =>
      (list || []).filter((e) => !existing?.[idOf(e)]).map((e) => ({ type, data: { ...e, seed: true } }));
    const events = [
      ...missing('category.upserted', config.categories, state.categories),
      ...missing('account.upserted', config.accounts, state.accounts),
      ...missing('brand.upserted', config.brands, state.brands),
      ...missing('rule.upserted', config.rules, state.rules),
    ];
    if (events.length > 0) {
      await writer.writeMany(events);
      added = events.length;
    }
    // The file replaces the built-in seed lists.
    for (const flag of SEED_FLAGS) {
      await setSetting(db, flag, '1');
    }
  }

  const stamp = await getSetting(db, 'config_settings_ts');
  const local = await readLocalSettings(db);
  const fileSettings = config?.settings;
  let settings = fileSettings || null;
  const nowIso = new Date(now()).toISOString();

  if (!fileSettings) {
    settings = { ...local, updatedAt: nowIso };
    await setSetting(db, 'config_settings_ts', nowIso);
  } else if (!stamp) {
    // First contact: keep what each phone already had.
    const merged = {
      householdNames: sortedUnion(local.householdNames, fileSettings.householdNames || []),
      smsSenders: sortedUnion(local.smsSenders, fileSettings.smsSenders || []),
      smsAutoScan: fileSettings.smsAutoScan ?? local.smsAutoScan,
    };
    await writeLocalSettings(db, merged);
    const updatedAt = sameSettings(merged, fileSettings) ? fileSettings.updatedAt : nowIso;
    settings = { ...merged, updatedAt };
    await setSetting(db, 'config_settings_ts', updatedAt);
  } else if (fileSettings.updatedAt > stamp) {
    await writeLocalSettings(db, fileSettings);
    await setSetting(db, 'config_settings_ts', fileSettings.updatedAt);
  } else if (!sameSettings(local, fileSettings)) {
    settings = { ...local, updatedAt: nowIso };
    await setSetting(db, 'config_settings_ts', nowIso);
  }

  const state = await loadStateFromDb(db);
  if (Object.keys(state.accounts).length === 0) return { added };

  const next = serialize(buildConfig({ state, epoch: config?.epoch, settings }));
  if (!config || next !== serialize(config)) {
    await storage.writeFile(CONFIG_FILE, next);
  }
  return { added };
}

/**
 * Starts over on this phone and, through the file, on the other one: backs up the events,
 * writes the configuration with a new epoch, wipes local data, and removes old logs.
 *
 * @returns {Promise<{ epoch: string, backupName: string|null, removed: number }>}
 */
export async function startFresh({ storage, db, now = () => Date.now() }) {
  const epoch = new Date(now()).toISOString();
  const state = await loadStateFromDb(db);

  const eventFiles = (await storage.listFiles('events-')).filter((f) => f.name.endsWith('.jsonl'));
  let backup = '';
  for (const f of eventFiles) {
    backup += (await storage.readFile(f.name)) || '';
  }
  let backupName = null;
  if (backup) {
    backupName = `backup-${epoch.replace(/[:.]/g, '-')}.jsonl`;
    await storage.writeFile(backupName, backup);
  }

  const settings = { ...(await readLocalSettings(db)), updatedAt: epoch };
  const cleaned = { ...state, accounts: Object.fromEntries(cleanAliases(Object.values(state.accounts)).map((a) => [idOf(a), a])) };
  await storage.writeFile(CONFIG_FILE, serialize(buildConfig({ state: cleaned, epoch, settings })));

  await resetLocalData(db, epoch);
  await setSetting(db, 'config_settings_ts', epoch);

  let removed = 0;
  const remove = async (name) => {
    await storage.deleteFile(name);
    removed += 1;
  };
  for (const f of eventFiles) {
    await remove(f.name);
  }
  for (const f of await storage.listFiles('device-')) {
    const content = f.name.includes('.sync-conflict-') ? null : await storage.readFile(f.name);
    let retired = !content;
    try {
      retired = retired || Boolean(JSON.parse(content).mergedInto);
    } catch {
      retired = true;
    }
    if (retired) await remove(f.name);
  }

  return { epoch, backupName, removed };
}
