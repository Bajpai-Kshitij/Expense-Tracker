import { describe, it, expect, beforeEach } from 'vitest';
import { smsTemplateKey, buildTemplateIgnoreRule, buildMerchantIgnoreRule, buildAccountIgnoreRule, matchUserIgnore, applyIgnoreRule, applyIgnoreRulesToOpenItems, extractAmountHint } from './userIgnore.js';
import { planImport, applyImport } from './pipeline.js';
import { createSqljsAdapter } from '../db/testing/sqljsAdapter.js';
import { createMemoryStorage } from '../sync/testing/memoryStorage.js';
import { createWriter } from '../sync/writer.js';
import { migrate, loadStateFromDb } from '../db/index.js';
import { categorize } from '../categorize/index.js';
import '../ingest/index.js';

const unparsedBody = (amt, day) => `Dear Customer, your special wallet was debited Rs ${amt} on ${day}-Oct-26 towards plan 88${day}. Balance Rs 10,0${day}.00`;

describe('similar SMS template', () => {
  it('is the same when only numbers and dates differ', () => {
    expect(smsTemplateKey(unparsedBody('500.00', '11'))).toBe(smsTemplateKey(unparsedBody('1,250.50', '23')));
  });
  it('differs when the words differ', () => {
    expect(smsTemplateKey(unparsedBody('500.00', '11'))).not.toBe(smsTemplateKey('Dear Customer, a different notice was debited Rs 500.00'));
  });
  it('never stores message text in the rule', () => {
    const body = unparsedBody('500.00', '11');
    const rule = buildTemplateIgnoreRule({ body, address: 'BANK', rawHash: 'h1' });
    expect(JSON.stringify(rule)).not.toMatch(/wallet|Dear/);
  });
  it('finds the first rupee amount for a manual entry', () => {
    expect(extractAmountHint('debited Rs 1,250.50 on')).toBe('1250.50');
    expect(extractAmountHint('no money here')).toBe('');
  });
});

describe('matchUserIgnore', () => {
  const rules = {
    a: buildMerchantIgnoreRule({ merchant: 'Ramesh  Kumar' }),
    b: buildAccountIgnoreRule({ issuer: 'SBI', digits: '1234' }),
  };
  it('matches a payee exactly, ignoring case and spacing', () => {
    expect(matchUserIgnore({ body: 'x', status: 'parsed', txn: { merchantRaw: 'RAMESH KUMAR', accountId: 'a' }, rules })).toBeTruthy();
    expect(matchUserIgnore({ body: 'x', status: 'parsed', txn: { merchantRaw: 'RAMESH KUMAR SONS', accountId: 'a' }, rules })).toBeNull();
  });
  it('matches a held message by account', () => {
    expect(matchUserIgnore({ body: 'x', status: 'parsed', txn: { accountId: null, accountHint: { issuer: 'sbi', digits: '991234' } }, rules })).toBeTruthy();
  });
  it('skips inactive and deleted rules', () => {
    const off = { a: { ...rules.a, active: false } };
    expect(matchUserIgnore({ body: 'x', status: 'parsed', txn: { merchantRaw: 'RAMESH KUMAR' }, rules: off })).toBeNull();
  });
  it('does not take part in categorization', () => {
    const r = { id: 'x', action: 'ignore_sms', pattern: 'FOO', kind: 'transfer', active: true };
    expect(categorize({ merchantRaw: 'FOO' }, { rules: [r] }).kind).toBeNull();
  });
});

describe('ignore from Review', () => {
  let db, writer;
  beforeEach(async () => {
    db = await createSqljsAdapter();
    await migrate(db);
    writer = createWriter({ deviceId: 'dev-a', storage: createMemoryStorage(), db });
    await writer.init();
  });
  const scan = async (message) => {
    const state = await loadStateFromDb(db);
    const plan = planImport({ messages: [message], ctx: { accounts: state.accounts, brands: state.brands, rules: state.rules, ownerNames: [] }, state, seenHashes: new Set(), allowlist: ['BANK'] });
    await applyImport({ plan, writer, db });
    return plan.summary;
  };
  const open = async () => (await db.query("SELECT count(*) c FROM review_queue WHERE status='open';"))[0].c;

  it('clears every similar open item and stops future ones', async () => {
    await scan({ address: 'BANK', date: 1, body: unparsedBody('500.00', '11') });
    await scan({ address: 'BANK', date: 2, body: unparsedBody('700.00', '12') });
    expect(await open()).toBe(2);
    const body = unparsedBody('500.00', '11');
    const count = await applyIgnoreRule({ rule: buildTemplateIgnoreRule({ body, address: 'BANK', rawHash: 'h' }), writer, db });
    expect(count).toBe(2);
    expect(await open()).toBe(0);
    const next = await scan({ address: 'BANK', date: 3, body: unparsedBody('900.00', '13') });
    expect(next).toMatchObject({ unparsed: 0, ignored: 1 });
    expect(await open()).toBe(0);
  });

  it('clears items on a phone that received the rule by sync', async () => {
    await scan({ address: 'BANK', date: 1, body: unparsedBody('500.00', '11') });
    const rule = buildTemplateIgnoreRule({ body: unparsedBody('1.00', '01'), address: 'BANK', rawHash: 'h' });
    expect(await applyIgnoreRulesToOpenItems({ rules: { [rule.id]: rule }, writer, db })).toBe(1);
    expect(await open()).toBe(0);
  });
});
