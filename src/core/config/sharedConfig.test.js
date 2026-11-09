import { describe, it, expect, beforeEach } from 'vitest';
import { CONFIG_FILE, readConfig, cleanAliases, prepareConfigSync, finishConfigSync, startFresh } from './sharedConfig.js';
import { createSqljsAdapter } from '../db/testing/sqljsAdapter.js';
import { createMemoryStorage } from '../sync/testing/memoryStorage.js';
import { createWriter } from '../sync/writer.js';
import { syncNow } from '../sync/engine.js';
import { migrate, loadStateFromDb } from '../db/index.js';
import { seedIfEmpty } from '../seed/seed.js';

const setSetting = (db, k, v) => db.exec('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);', [k, v]);
const getSetting = async (db, k) => (await db.query('SELECT value FROM settings WHERE key = ?;', [k]))[0]?.value ?? null;
const count = async (db, t) => (await db.query(`SELECT count(*) c FROM ${t};`))[0].c;
const exp = (id) => ({ expenseId: id, amountPaise: 100, date: '2026-11-01', direction: 'debit', kind: 'spend', source: 'manual' });

async function phone(storage, dev) {
  const db = await createSqljsAdapter();
  await migrate(db);
  const writer = createWriter({ deviceId: dev, storage, db });
  await writer.init();
  const cycle = async () => {
    const before = await prepareConfigSync({ storage, db });
    await syncNow({ storage, db, deviceId: dev });
    await finishConfigSync({ storage, db, writer, config: before.config, invalid: before.invalid });
    return before;
  };
  return { db, writer, cycle };
}

describe('cleanAliases', () => {
  const accounts = [
    { id: 'card', issuer: 'HDFC', lastDigits: '3726', aliases: [{ issuer: 'hdfc', digits: '1819' }] },
    { id: 'savings', issuer: 'HDFC', lastDigits: '819', aliases: [] },
    { id: 'axis', issuer: 'Axis', lastDigits: '3765', aliases: [{ issuer: 'sbimf', digits: '2368' }] },
    { id: 'amazon', issuer: 'ICICI', lastDigits: '6017', aliases: [{ issuer: 'icici', digits: '7922' }] },
  ];
  const out = Object.fromEntries(cleanAliases(accounts).map((a) => [a.id, a.aliases]));
  it('drops an alias that belongs to another account of that bank', () => expect(out.card).toEqual([]));
  it('drops an alias from a different bank', () => expect(out.axis).toEqual([]));
  it('keeps a genuine alias', () => expect(out.amazon).toEqual([{ issuer: 'icici', digits: '7922' }]));
});

describe('shared config file', () => {
  let storage;
  beforeEach(() => { storage = createMemoryStorage(); });

  it('is written with configuration only, no expenses or internal fields', async () => {
    const a = await phone(storage, 'dev-a');
    await seedIfEmpty({ writer: a.writer, db: a.db });
    await a.writer.write('expense.created', exp('e1'));
    await setSetting(a.db, 'owner_names', JSON.stringify(['Test Owner']));
    await setSetting(a.db, 'sms_senders', JSON.stringify(['BANKA']));
    await a.cycle();
    const text = storage.getRawContent(CONFIG_FILE);
    const file = JSON.parse(text);
    expect(file.accounts.length).toBeGreaterThan(0);
    expect(file.settings).toMatchObject({ householdNames: ['Test Owner'], smsSenders: ['BANKA'] });
    expect(text).not.toMatch(/_lww|"seed"|amountPaise|e1/);
  });

  it('gives a new phone the accounts, rules and settings, without its built-in seed', async () => {
    const a = await phone(storage, 'dev-a');
    await a.writer.write('account.upserted', { id: 'acc_x', name: 'Only', issuer: 'X', lastDigits: '111' });
    await a.writer.write('rule.upserted', { id: 'r1', pattern: 'Z', kind: 'transfer', active: true });
    await setSetting(a.db, 'owner_names', JSON.stringify(['Test Owner']));
    await a.cycle();

    const empty = createMemoryStorage();
    await empty.writeFile(CONFIG_FILE, storage.getRawContent(CONFIG_FILE));
    const b = await phone(empty, 'dev-b');
    await b.cycle();
    await seedIfEmpty({ writer: b.writer, db: b.db });
    const state = await loadStateFromDb(b.db);
    expect(Object.keys(state.accounts)).toEqual(['acc_x']);
    expect(state.rules.r1.pattern).toBe('Z');
    expect(JSON.parse(await getSetting(b.db, 'owner_names'))).toEqual(['Test Owner']);
  });

  it('combines both phones the first time they share, then a later edit wins', async () => {
    const a = await phone(storage, 'dev-a');
    await a.writer.write('account.upserted', { id: 'acc_x', name: 'A', issuer: 'X', lastDigits: '111' });
    await setSetting(a.db, 'sms_senders', JSON.stringify(['BANKA']));
    await a.cycle();
    const b = await phone(storage, 'dev-b');
    await setSetting(b.db, 'sms_senders', JSON.stringify(['BANKB']));
    await b.cycle();
    expect(JSON.parse(await getSetting(b.db, 'sms_senders')).sort()).toEqual(['BANKA', 'BANKB']);
    await a.cycle();
    expect(JSON.parse(await getSetting(a.db, 'sms_senders')).sort()).toEqual(['BANKA', 'BANKB']);

    await new Promise((r) => setTimeout(r, 5));
    await setSetting(a.db, 'sms_senders', JSON.stringify(['BANKA']));
    await a.cycle();
    await b.cycle();
    expect(JSON.parse(await getSetting(b.db, 'sms_senders'))).toEqual(['BANKA']);
  });

  it('does not bring back a rule deleted on this phone', async () => {
    const a = await phone(storage, 'dev-a');
    await a.writer.write('account.upserted', { id: 'acc_x', name: 'A', issuer: 'X', lastDigits: '111' });
    await a.writer.write('rule.upserted', { id: 'r1', pattern: 'Z', kind: 'transfer', active: true });
    await a.cycle();
    await a.writer.write('rule.deleted', { id: 'r1' });
    await a.cycle();
    expect((await loadStateFromDb(a.db)).rules.r1._deleted).toBe(true);
    expect(JSON.parse(storage.getRawContent(CONFIG_FILE)).rules).toEqual([]);
  });

  it('leaves a damaged file alone', async () => {
    const a = await phone(storage, 'dev-a');
    await a.writer.write('account.upserted', { id: 'acc_x', name: 'A', issuer: 'X', lastDigits: '111' });
    await storage.writeFile(CONFIG_FILE, '{ not json');
    await a.cycle();
    expect(storage.getRawContent(CONFIG_FILE)).toBe('{ not json');
    await expect(readConfig(storage)).rejects.toThrow();
  });
});

describe('start fresh', () => {
  let storage, a, b;
  beforeEach(async () => {
    storage = createMemoryStorage();
    a = await phone(storage, 'dev-a');
    b = await phone(storage, 'dev-b');
    await a.writer.write('account.upserted', { id: 'acc_x', name: 'A', issuer: 'X', lastDigits: '111', aliases: [{ issuer: 'other', digits: '999' }] });
    await a.writer.write('category.upserted', { id: 'cat_x', name: 'Mine' });
    await a.writer.write('expense.created', exp('e1'));
    await b.writer.write('expense.created', exp('e2'));
    await setSetting(a.db, 'owner_names', JSON.stringify(['Test Owner']));
    await setSetting(a.db, 'sms_last_scan_ms', '123');
    await a.db.exec("INSERT INTO raw_messages (hash, kind, body) VALUES ('h', 'parsed', 'x');");
    await storage.writeFile('device-dev-old.json', JSON.stringify({ deviceId: 'dev-old', label: 'Me', mergedInto: 'dev-a' }));
    await storage.writeFile('device-dev-a.json', JSON.stringify({ deviceId: 'dev-a', label: 'Me' }));
    await storage.writeFile('events-dev-old.jsonl', '');
    await a.cycle();
    await b.cycle();
  });

  it('backs up every event before deleting them', async () => {
    const before = storage.getRawContent('events-dev-a.jsonl') + storage.getRawContent('events-dev-b.jsonl');
    const { backupName } = await startFresh({ storage, db: a.db });
    const backup = storage.getRawContent(backupName);
    for (const line of before.trim().split('\n')) expect(backup).toContain(line);
    expect(backupName.startsWith('events-')).toBe(false);
  });

  it('removes expenses, messages and old devices, and keeps configuration', async () => {
    await startFresh({ storage, db: a.db });
    await a.cycle();
    expect(await count(a.db, 'expenses')).toBe(0);
    expect(await count(a.db, 'raw_messages')).toBe(0);
    expect(await getSetting(a.db, 'sms_last_scan_ms')).toBeNull();
    expect(await getSetting(a.db, 'owner_names')).toBe(JSON.stringify(['Test Owner']));
    const state = await loadStateFromDb(a.db);
    expect(state.accounts.acc_x.name).toBe('A');
    expect(state.accounts.acc_x.aliases).toEqual([]);
    expect(state.categories.cat_x.name).toBe('Mine');
    expect(storage.getRawContent('device-dev-old.json')).toBeNull();
    expect(storage.getRawContent('device-dev-a.json')).not.toBeNull();
    expect(storage.getRawContent('events-dev-b.jsonl')).toBeNull();
  });

  it('wipes the other phone on its next sync, once', async () => {
    await startFresh({ storage, db: a.db });
    expect((await b.cycle()).reset).toBe(true);
    expect(await count(b.db, 'expenses')).toBe(0);
    await b.writer.write('expense.created', exp('new-after'));
    expect((await b.cycle()).reset).toBe(false);
    expect(await count(b.db, 'expenses')).toBe(1);
  });

  it('old events cannot return if the folder delivers them late', async () => {
    const oldLog = storage.getRawContent('events-dev-b.jsonl');
    await startFresh({ storage, db: a.db });
    await storage.writeFile('events-dev-b.jsonl', oldLog);
    await a.cycle();
    await b.cycle();
    expect(await count(a.db, 'expenses')).toBe(0);
    expect(await count(b.db, 'expenses')).toBe(0);
  });

  it('new expenses sync normally afterwards', async () => {
    await startFresh({ storage, db: a.db });
    await a.cycle();
    await b.cycle();
    await a.writer.write('expense.created', exp('fresh'));
    await b.cycle();
    expect((await b.db.query('SELECT id FROM expenses;')).map((r) => r.id)).toEqual(['fresh']);
  });
});
