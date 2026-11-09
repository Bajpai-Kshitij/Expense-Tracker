import { describe, it, expect } from 'vitest';
import { createMemoryStorage } from './testing/memoryStorage.js';
import { listDevices, mergeDevice, buildDeviceGroups, scopeFilter, jointAccountIds } from './device.js';
import { readAllEvents } from './reader.js';
import { createSqljsAdapter } from '../db/testing/sqljsAdapter.js';
import { migrate } from '../db/index.js';
import { createWriter } from './writer.js';
import { totals, uncategorizedInbox, listExpenses } from '../db/queries.js';

const file = (id, label, extra = {}) => JSON.stringify({ deviceId: id, label, createdAt: 'x', ...extra });

describe('devices', () => {
  it('does not list Syncthing conflict copies as devices', async () => {
    const s = createMemoryStorage();
    await s.writeFile('device-dev-a.json', file('dev-a', 'One'));
    await s.writeFile('device-dev-a.sync-conflict-20261109-101010-ABCDEFG.json', file('dev-a', 'Stale'));
    expect((await listDevices(s)).map((d) => d.label)).toEqual(['One']);
  });

  it('reports Syncthing event conflict copies as issues but still reads them', async () => {
    const s = createMemoryStorage();
    await s.writeFile('events-dev-a.sync-conflict-20261109-101010-ABCDEFG.jsonl', '');
    const { issues } = await readAllEvents({ storage: s });
    expect(issues[0].reason).toMatch(/conflict/i);
  });

  it('merging keeps the event history and hides the device', async () => {
    const s = createMemoryStorage();
    await s.writeFile('device-dev-old.json', file('dev-old', 'Me'));
    await s.writeFile('events-dev-old.jsonl', 'kept\n');
    await mergeDevice({ storage: s, deviceId: 'dev-old', intoId: 'dev-new' });
    expect(await s.readFile('events-dev-old.jsonl')).toBe('kept\n');
    expect((await listDevices(s))[0]).toMatchObject({ deviceId: 'dev-old', label: 'Me', mergedInto: 'dev-new' });
  });

  it('refuses to merge a device into itself', async () => {
    await expect(mergeDevice({ storage: createMemoryStorage(), deviceId: 'a', intoId: 'a' })).rejects.toThrow();
  });
});

describe('device groups', () => {
  const devices = [
    { deviceId: 'old1', label: 'Me', mergedInto: 'old2' },
    { deviceId: 'old2', label: 'Me', mergedInto: 'me' },
    { deviceId: 'me', label: 'Husband' },
    { deviceId: 'her', label: 'Wife' },
  ];

  it('groups merged installs under their final device, following chains', () => {
    const g = buildDeviceGroups(devices, 'me');
    expect(g.groups.map((x) => x.label)).toEqual(['Husband', 'Wife']);
    expect(g.mine.memberIds.sort()).toEqual(['me', 'old1', 'old2']);
    expect(g.others.map((x) => x.memberIds)).toEqual([['her']]);
  });

  it('survives a merge loop', () => {
    const g = buildDeviceGroups([{ deviceId: 'a', label: 'A', mergedInto: 'b' }, { deviceId: 'b', label: 'B', mergedInto: 'a' }], 'a');
    expect(g.groups.length).toBeGreaterThan(0);
  });

  it('builds filters: individual scopes, and none for overall', () => {
    const g = buildDeviceGroups(devices, 'me');
    expect(scopeFilter(g, 'mine')).toEqual({ createdByDev: expect.stringContaining('old1') });
    expect(scopeFilter(g, 'her')).toEqual({ createdByDev: 'her' });
    expect(scopeFilter(g, 'all')).toEqual({});
  });
});

describe('expenses by person', () => {
  it('finds joint accounts by owner', () => {
    expect(jointAccountIds([{ id: 'a', owner: 'Joint' }, { id: 'b', owner: 'Me' }, { id: 'c' }, { id: 'd', owner: 'joint' }])).toEqual(['a', 'd']);
  });

  it('keeps joint-account expenses out of a person, and in Overall only', async () => {
    const db = await createSqljsAdapter();
    await migrate(db);
    const w = createWriter({ deviceId: 'me', storage: createMemoryStorage(), db });
    await w.init();
    const add = (id, paise, accountId) => w.write('expense.created', { expenseId: id, amountPaise: paise, date: '2026-11-01', direction: 'debit', kind: 'spend', source: 'manual', accountId });
    await add('own', 100, 'card');
    await add('shared', 200, 'joint');
    await add('cash', 400, undefined);
    const groups = buildDeviceGroups([{ deviceId: 'me', label: 'Me' }, { deviceId: 'her', label: 'Wife' }], 'me');
    const mine = scopeFilter(groups, 'mine', ['joint']);
    expect(mine).toEqual({ createdByDev: 'me', excludeAccountIds: ['joint'] });
    expect((await totals(db, mine)).netPaise).toBe(500);
    expect((await listExpenses(db, mine)).map((e) => e.id).sort()).toEqual(['cash', 'own']);
    expect((await uncategorizedInbox(db, mine)).length).toBe(2);
    const overall = scopeFilter(groups, 'all', ['joint']);
    expect(overall).toEqual({});
    expect((await totals(db, overall)).netPaise).toBe(700);
  });

  it('totals, inbox and lists respect the scope', async () => {
    const db = await createSqljsAdapter();
    await migrate(db);
    const storage = createMemoryStorage();
    const write = async (dev, id, paise) => {
      const w = createWriter({ deviceId: dev, storage, db });
      await w.init();
      await w.write('expense.created', { expenseId: id, amountPaise: paise, date: '2026-11-01', direction: 'debit', kind: 'spend', source: 'manual', categoryId: null });
    };
    await write('old', 'e1', 100);
    await write('me', 'e2', 200);
    await write('her', 'e3', 400);
    const mine = { createdByDev: 'old,me' };
    expect((await totals(db, mine)).netPaise).toBe(300);
    expect((await totals(db, { createdByDev: 'her' })).netPaise).toBe(400);
    expect((await totals(db, {})).netPaise).toBe(700);
    expect((await uncategorizedInbox(db, mine)).length).toBe(2);
    expect((await uncategorizedInbox(db)).length).toBe(3);
    expect((await listExpenses(db, mine)).map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });
});
