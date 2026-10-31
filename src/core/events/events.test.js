import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  canonicalJson,
  crc32,
  calculateEventCrc,
  expenseIdFromDedupeKey,
  generateManualExpenseId,
  generateEventId,
  createEvent,
  compareEvents,
  serializeEvent,
  parseLine,
  createEmptyState,
  applyEvents,
  isFieldUpdateWinning,
} from './index.js';

describe('PHASE P1 - Event Core', () => {
  describe('Canonical JSON and CRC32', () => {
    it('Canonical JSON and CRC are stable across key order', () => {
      const obj1 = {
        z: 'last',
        a: 100,
        nested: { b: 2, a: 1 },
        arr: [{ y: 2, x: 1 }, 'item'],
      };

      const obj2 = {
        nested: { a: 1, b: 2 },
        a: 100,
        arr: [{ x: 1, y: 2 }, 'item'],
        z: 'last',
      };

      const canon1 = canonicalJson(obj1);
      const canon2 = canonicalJson(obj2);

      expect(canon1).toBe(canon2);
      expect(canon1).toBe('{"a":100,"arr":[{"x":1,"y":2},"item"],"nested":{"a":1,"b":2},"z":"last"}');
      expect(crc32(canon1)).toBe(crc32(canon2));
    });

    it('CRC32 matches standard test vectors', () => {
      expect(crc32('')).toBe('00000000');
      expect(crc32('123456789')).toBe('cbf43926');
    });

    it('calculateEventCrc ignores existing crc property on the event', () => {
      const eventWithCrc = {
        v: 1,
        id: 'ev_test123',
        dev: 'dev-1',
        seq: 1,
        ts: '2026-10-30T10:00:00.000Z',
        type: 'expense.created',
        crc: 'bad_crc_should_be_ignored',
        data: { amountPaise: 5000 },
      };

      const computed = calculateEventCrc(eventWithCrc);
      expect(computed).toHaveLength(8);
      expect(/^[0-9a-f]{8}$/.test(computed)).toBe(true);

      const { crc: _, ...withoutCrc } = eventWithCrc;
      expect(computed).toBe(calculateEventCrc(withoutCrc));
    });
  });

  describe('ID generation & deduplication', () => {
    it('Deterministic expense id: expenseIdFromDedupeKey(key) = "e_" + first 16 hex chars of SHA-256(key)', () => {
      const key = 'fp:acc_axis_myzone|125000|202610301015|swiggy';
      const id = expenseIdFromDedupeKey(key);
      expect(id).toMatch(/^e_[0-9a-f]{16}$/);

      // Verify idempotency
      expect(expenseIdFromDedupeKey(key)).toBe(id);

      // Verify known SHA-256 prefix for "test"
      // SHA-256("test") = 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
      expect(expenseIdFromDedupeKey('test')).toBe('e_9f86d081884c7d65');
    });

    it('The same dedupeKey on two devices produces the same expenseId and a single expense', () => {
      const dedupeKey = 'fp:acc_axis_myzone|125000|202610301015|swiggy';
      const idA = expenseIdFromDedupeKey(dedupeKey);
      const idB = expenseIdFromDedupeKey(dedupeKey);

      expect(idA).toBe(idB);

      const ev1 = createEvent({
        type: 'expense.created',
        dev: 'dev-phone-1',
        seq: 1,
        ts: '2026-10-30T10:15:22.000Z',
        data: {
          expenseId: idA,
          amountPaise: 125000,
          dedupeKey,
          brand: 'Swiggy',
        },
      });

      const ev2 = createEvent({
        type: 'expense.created',
        dev: 'dev-phone-2',
        seq: 1,
        ts: '2026-10-30T10:15:25.000Z',
        data: {
          expenseId: idB,
          amountPaise: 125000,
          dedupeKey,
          brand: 'Swiggy Food',
        },
      });

      const state = applyEvents(createEmptyState(), [ev1, ev2]);
      expect(Object.keys(state.expenses)).toHaveLength(1);
      expect(state.expenses[idA].id).toBe(idA);
      // Later timestamp from dev-phone-2 wins brand field
      expect(state.expenses[idA].brand).toBe('Swiggy Food');
    });

    it('Manual expenses get random ids via a separate function', () => {
      const mockRandom = () => 0.5; // 0.5 * 16 = 8 -> '8'
      const id1 = generateManualExpenseId(mockRandom);
      expect(id1).toBe('e_8888888888888888');

      const id2 = generateManualExpenseId();
      expect(id2).toMatch(/^e_[0-9a-f]{16}$/);
    });

    it('Event ids look like "ev_" + a sortable time part + random part', () => {
      const id = generateEventId(1730370000000, () => 0.1);
      expect(id.startsWith('ev_')).toBe(true);
      expect(id.length).toBeGreaterThan(12);
    });
  });

  describe('Line format & parsing', () => {
    it('serializeEvent(event) returns one line ending in "\\n"', () => {
      const ev = createEvent({
        type: 'expense.created',
        dev: 'dev-a',
        seq: 1,
        ts: '2026-10-30T10:00:00.000Z',
        data: { amountPaise: 1000 },
      });

      const line = serializeEvent(ev);
      expect(line.endsWith('\n')).toBe(true);
      expect(line.indexOf('\n')).toBe(line.length - 1); // exactly one newline at the end

      const parsed = parseLine(line);
      expect(parsed.ok).toBe(true);
      expect(parsed.event).toEqual(ev);
    });

    it('Corrupted line: bad CRC, bad JSON, truncated line, and no trailing newline each return ok:false without throwing', () => {
      const validEvent = createEvent({
        type: 'expense.created',
        dev: 'dev-a',
        seq: 1,
        ts: '2026-10-30T10:00:00.000Z',
        data: { amountPaise: 1000 },
      });
      const validLine = serializeEvent(validEvent);

      // 1. Bad CRC
      const badCrcObj = { ...validEvent, crc: '00000000' };
      const badCrcLine = canonicalJson(badCrcObj) + '\n';
      const resBadCrc = parseLine(badCrcLine);
      expect(resBadCrc.ok).toBe(false);
      expect(resBadCrc.reason).toContain('CRC mismatch');

      // 2. Bad JSON
      const badJsonLine = '{"v":1,"id":"ev_123",badjson\n';
      const resBadJson = parseLine(badJsonLine);
      expect(resBadJson.ok).toBe(false);
      expect(resBadJson.reason).toContain('Invalid JSON');

      // 3. Truncated line (missing closing braces & newline)
      const truncatedLine = '{"v":1,"id":"ev_123","dev":"dev-a"';
      const resTruncated = parseLine(truncatedLine);
      expect(resTruncated.ok).toBe(false);
      expect(resTruncated.reason).toContain('Missing trailing newline');

      // 4. Valid JSON but no trailing newline
      const noNewline = validLine.slice(0, -1);
      const resNoNewline = parseLine(noNewline);
      expect(resNoNewline.ok).toBe(false);
      expect(resNoNewline.reason).toContain('Missing trailing newline');

      // None of them must throw
      expect(() => parseLine(null)).not.toThrow();
      expect(() => parseLine(undefined)).not.toThrow();
      expect(() => parseLine('')).not.toThrow();
    });
  });

  describe('compareEvents ordering', () => {
    it('orders by ts (epoch ms), then dev, then seq deterministically and totally', () => {
      const e1 = { id: 'ev_1', ts: '2026-10-30T10:00:00.000Z', dev: 'dev-a', seq: 1 };
      const e2 = { id: 'ev_2', ts: '2026-10-30T10:00:01.000Z', dev: 'dev-a', seq: 1 };
      const e3 = { id: 'ev_3', ts: '2026-10-30T10:00:01.000Z', dev: 'dev-b', seq: 1 };
      const e4 = { id: 'ev_4', ts: '2026-10-30T10:00:01.000Z', dev: 'dev-b', seq: 2 };

      expect(compareEvents(e1, e2)).toBeLessThan(0);
      expect(compareEvents(e2, e1)).toBeGreaterThan(0);
      expect(compareEvents(e2, e3)).toBeLessThan(0);
      expect(compareEvents(e3, e4)).toBeLessThan(0);
      expect(compareEvents(e1, e1)).toBe(0);
    });
  });

  describe('applyEvents reducer rules', () => {
    it('Same event delivered twice is applied once', () => {
      const ev = createEvent({
        id: 'ev_unique_1',
        type: 'expense.created',
        dev: 'dev-a',
        seq: 1,
        ts: '2026-10-30T10:00:00.000Z',
        data: { expenseId: 'e_test_1', amountPaise: 5000 },
      });

      const state1 = applyEvents(createEmptyState(), [ev]);
      expect(state1.appliedEventIds.has('ev_unique_1')).toBe(true);

      const state2 = applyEvents(state1, [ev]);
      expect(Object.keys(state2.expenses)).toHaveLength(1);
      expect(state2.appliedEventIds.size).toBe(1);
    });

    it('Two devices edit different fields of one expense: both edits survive', () => {
      const createEv = createEvent({
        id: 'ev_create',
        type: 'expense.created',
        dev: 'dev-base',
        seq: 1,
        ts: '2026-10-30T10:00:00.000Z',
        data: {
          expenseId: 'e_shared_1',
          amountPaise: 10000,
          note: 'initial note',
          categoryId: 'cat_groceries',
        },
      });

      const updateDevA = createEvent({
        id: 'ev_up_a',
        type: 'expense.updated',
        dev: 'dev-a',
        seq: 2,
        ts: '2026-10-30T10:05:00.000Z',
        data: {
          expenseId: 'e_shared_1',
          patch: { note: 'updated note by dev A' },
        },
      });

      const updateDevB = createEvent({
        id: 'ev_up_b',
        type: 'expense.updated',
        dev: 'dev-b',
        seq: 2,
        ts: '2026-10-30T10:06:00.000Z',
        data: {
          expenseId: 'e_shared_1',
          patch: { categoryId: 'cat_dining' },
        },
      });

      const state = applyEvents(createEmptyState(), [createEv, updateDevA, updateDevB]);
      const exp = state.expenses['e_shared_1'];

      expect(exp.amountPaise).toBe(10000);
      expect(exp.note).toBe('updated note by dev A');
      expect(exp.categoryId).toBe('cat_dining');
    });

    it('Two devices edit the same field: the later timestamp wins; equal timestamps are broken by dev id', () => {
      const createEv = createEvent({
        id: 'ev_create_2',
        type: 'expense.created',
        dev: 'dev-base',
        seq: 1,
        ts: '2026-10-30T10:00:00.000Z',
        data: { expenseId: 'e_shared_2', note: 'original' },
      });

      // 1. Later timestamp wins
      const updateEarlier = createEvent({
        id: 'ev_earlier',
        type: 'expense.updated',
        dev: 'dev-z',
        seq: 2,
        ts: '2026-10-30T10:05:00.000Z',
        data: { expenseId: 'e_shared_2', patch: { note: 'from dev-z earlier' } },
      });

      const updateLater = createEvent({
        id: 'ev_later',
        type: 'expense.updated',
        dev: 'dev-a',
        seq: 2,
        ts: '2026-10-30T10:06:00.000Z',
        data: { expenseId: 'e_shared_2', patch: { note: 'from dev-a later' } },
      });

      const state1 = applyEvents(createEmptyState(), [createEv, updateEarlier, updateLater]);
      expect(state1.expenses['e_shared_2'].note).toBe('from dev-a later');

      // 2. Equal timestamps broken by dev id (dev-b > dev-a)
      const updateTieA = createEvent({
        id: 'ev_tie_a',
        type: 'expense.updated',
        dev: 'dev-a',
        seq: 3,
        ts: '2026-10-30T10:10:00.000Z',
        data: { expenseId: 'e_shared_2', patch: { note: 'from A tie' } },
      });

      const updateTieB = createEvent({
        id: 'ev_tie_b',
        type: 'expense.updated',
        dev: 'dev-b',
        seq: 3,
        ts: '2026-10-30T10:10:00.000Z',
        data: { expenseId: 'e_shared_2', patch: { note: 'from B tie' } },
      });

      const state2 = applyEvents(createEmptyState(), [createEv, updateTieA, updateTieB]);
      expect(state2.expenses['e_shared_2'].note).toBe('from B tie');
    });

    it('Delete, then a later update: the update is ignored', () => {
      const createEv = createEvent({
        id: 'ev_create_3',
        type: 'expense.created',
        dev: 'dev-a',
        seq: 1,
        ts: '2026-10-30T10:00:00.000Z',
        data: { expenseId: 'e_del_1', amountPaise: 4000, note: 'to delete' },
      });

      const deleteEv = createEvent({
        id: 'ev_del_1',
        type: 'expense.deleted',
        dev: 'dev-a',
        seq: 2,
        ts: '2026-10-30T10:02:00.000Z',
        data: { expenseId: 'e_del_1' },
      });

      const laterUpdateEv = createEvent({
        id: 'ev_later_up',
        type: 'expense.updated',
        dev: 'dev-b',
        seq: 2,
        ts: '2026-10-30T10:05:00.000Z',
        data: { expenseId: 'e_del_1', patch: { note: 'revived note' } },
      });

      const state = applyEvents(createEmptyState(), [createEv, deleteEv, laterUpdateEv]);
      const exp = state.expenses['e_del_1'];

      expect(exp.deleted).toBe(true);
      expect(exp.note).toBe('to delete'); // later update was ignored
      expect(state.appliedEventIds.has(laterUpdateEv.id)).toBe(true);
    });

    it('Update arrives before its create: parked, then applied after the create', () => {
      const updateEv = createEvent({
        id: 'ev_orphan_up',
        type: 'expense.updated',
        dev: 'dev-a',
        seq: 2,
        ts: '2026-10-30T10:05:00.000Z',
        data: { expenseId: 'e_orphan_1', patch: { note: 'patch for orphan' } },
      });

      const createEv = createEvent({
        id: 'ev_orphan_create',
        type: 'expense.created',
        dev: 'dev-b',
        seq: 1,
        ts: '2026-10-30T10:00:00.000Z',
        data: { expenseId: 'e_orphan_1', amountPaise: 9900, note: 'original orphan' },
      });

      // Batch 1: Only update arrives
      const state1 = applyEvents(createEmptyState(), [updateEv]);
      expect(state1.expenses['e_orphan_1']).toBeUndefined();
      expect(state1.parkedEvents).toHaveLength(1);
      expect(state1.parkedEvents[0].id).toBe(updateEv.id);
      expect(state1.appliedEventIds.has(updateEv.id)).toBe(false);

      // Batch 2: Create arrives
      const state2 = applyEvents(state1, [createEv]);
      expect(state2.parkedEvents).toHaveLength(0);
      expect(state2.appliedEventIds.has(updateEv.id)).toBe(true);
      expect(state2.appliedEventIds.has(createEv.id)).toBe(true);
      expect(state2.expenses['e_orphan_1'].amountPaise).toBe(9900);
      expect(state2.expenses['e_orphan_1'].note).toBe('patch for orphan');
    });

    it('Events arrive in any order: the final state is identical for every permutation of a small set', () => {
      // Helper to generate all permutations
      function getPermutations(arr) {
        if (arr.length <= 1) return [arr];
        const result = [];
        for (let i = 0; i < arr.length; i++) {
          const current = arr[i];
          const remaining = [...arr.slice(0, i), ...arr.slice(i + 1)];
          const remainingPerms = getPermutations(remaining);
          for (const perm of remainingPerms) {
            result.push([current, ...perm]);
          }
        }
        return result;
      }

      const e1 = createEvent({
        id: 'ev_perm_1',
        type: 'expense.created',
        dev: 'dev-1',
        seq: 1,
        ts: '2026-10-30T10:00:00.000Z',
        data: { expenseId: 'e_perm_1', amountPaise: 1500, note: 'init' },
      });

      const e2 = createEvent({
        id: 'ev_perm_2',
        type: 'expense.updated',
        dev: 'dev-1',
        seq: 2,
        ts: '2026-10-30T10:01:00.000Z',
        data: { expenseId: 'e_perm_1', patch: { note: 'step 2 note' } },
      });

      const e3 = createEvent({
        id: 'ev_perm_3',
        type: 'category.upserted',
        dev: 'dev-2',
        seq: 1,
        ts: '2026-10-30T10:02:00.000Z',
        data: { categoryId: 'cat_food', name: 'Food & Dining' },
      });

      const e4 = createEvent({
        id: 'ev_perm_4',
        type: 'expense.updated',
        dev: 'dev-2',
        seq: 2,
        ts: '2026-10-30T10:03:00.000Z',
        data: { expenseId: 'e_perm_1', patch: { categoryId: 'cat_food' } },
      });

      const set = [e1, e2, e3, e4];
      const perms = getPermutations(set);
      expect(perms).toHaveLength(24);

      // Baseline state from the first permutation
      const baselineState = applyEvents(createEmptyState(), perms[0]);

      // All 24 permutations must produce the exact same final state
      for (let i = 1; i < perms.length; i++) {
        const state = applyEvents(createEmptyState(), perms[i]);
        expect(state.expenses).toEqual(baselineState.expenses);
        expect(state.categories).toEqual(baselineState.categories);
        expect(state.parkedEvents).toEqual(baselineState.parkedEvents);
        expect([...state.appliedEventIds].sort()).toEqual([...baselineState.appliedEventIds].sort());
      }
    });

    it('expense.merged marks dropId deleted and records mergedInto keepId', () => {
      const eKeep = createEvent({
        id: 'ev_keep',
        type: 'expense.created',
        dev: 'dev-a',
        seq: 1,
        ts: '2026-10-30T10:00:00.000Z',
        data: { expenseId: 'e_keep_1', amountPaise: 5000 },
      });

      const eDrop = createEvent({
        id: 'ev_drop',
        type: 'expense.created',
        dev: 'dev-b',
        seq: 1,
        ts: '2026-10-30T10:01:00.000Z',
        data: { expenseId: 'e_drop_1', amountPaise: 5000 },
      });

      const eMerge = createEvent({
        id: 'ev_merge',
        type: 'expense.merged',
        dev: 'dev-a',
        seq: 2,
        ts: '2026-10-30T10:05:00.000Z',
        data: { keepId: 'e_keep_1', dropId: 'e_drop_1' },
      });

      const state = applyEvents(createEmptyState(), [eKeep, eDrop, eMerge]);
      expect(state.expenses['e_drop_1'].deleted).toBe(true);
      expect(state.expenses['e_drop_1'].mergedInto).toBe('e_keep_1');
      expect(state.expenses['e_keep_1'].deleted).toBe(false);
    });

    it('An unknown event type is skipped and reported', () => {
      const unknownEv = {
        v: 1,
        id: 'ev_unknown_1',
        dev: 'dev-future',
        seq: 1,
        ts: '2026-10-30T10:00:00.000Z',
        type: 'future.unsupported.action',
        crc: '12345678',
        data: { foo: 'bar' },
      };

      const state = applyEvents(createEmptyState(), [unknownEv]);
      expect(state.warnings).toHaveLength(1);
      expect(state.warnings[0].eventId).toBe('ev_unknown_1');
      expect(state.warnings[0].reason).toContain('Unknown event type');
      expect(state.appliedEventIds.has('ev_unknown_1')).toBe(true);
    });

    it('upserted categories, brands, rules, accounts and rule.deleted work as expected', () => {
      const eCat = createEvent({
        type: 'category.upserted',
        dev: 'dev-a',
        seq: 1,
        ts: '2026-10-30T10:00:00.000Z',
        data: { categoryId: 'cat_groceries', name: 'Groceries' },
      });

      const eBrand = createEvent({
        type: 'brand.upserted',
        dev: 'dev-a',
        seq: 2,
        ts: '2026-10-30T10:01:00.000Z',
        data: { brandId: 'brand_amazon', name: 'Amazon' },
      });

      const eAccount = createEvent({
        type: 'account.upserted',
        dev: 'dev-a',
        seq: 3,
        ts: '2026-10-30T10:02:00.000Z',
        data: { accountId: 'acc_hdfc', name: 'HDFC Bank' },
      });

      const eRuleUpsert = createEvent({
        type: 'rule.upserted',
        dev: 'dev-a',
        seq: 4,
        ts: '2026-10-30T10:03:00.000Z',
        data: { ruleId: 'rule_swiggy', pattern: 'SWIGGY', categoryId: 'cat_food' },
      });

      const state1 = applyEvents(createEmptyState(), [eCat, eBrand, eAccount, eRuleUpsert]);
      expect(state1.categories['cat_groceries'].name).toBe('Groceries');
      expect(state1.brands['brand_amazon'].name).toBe('Amazon');
      expect(state1.accounts['acc_hdfc'].name).toBe('HDFC Bank');
      expect(state1.rules['rule_swiggy'].pattern).toBe('SWIGGY');

      const eRuleDelete = createEvent({
        type: 'rule.deleted',
        dev: 'dev-a',
        seq: 5,
        ts: '2026-10-30T10:04:00.000Z',
        data: { ruleId: 'rule_swiggy' },
      });

      const state2 = applyEvents(state1, [eRuleDelete]);
      expect(state2.rules['rule_swiggy']).toBeUndefined();
    });
  });

  describe('Isolation check', () => {
    it('nothing in src/core/events imports React, Capacitor or SQLite', () => {
      const eventsDir = resolve(process.cwd(), 'src/core/events');
      const files = readdirSync(eventsDir).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));

      for (const file of files) {
        const content = readFileSync(resolve(eventsDir, file), 'utf8');
        expect(content).not.toMatch(/from\s+['"]react['"]/);
        expect(content).not.toMatch(/from\s+['"]react-dom/);
        expect(content).not.toMatch(/from\s+['"]@capacitor/);
        expect(content).not.toMatch(/from\s+['"]@capacitor-community\/sqlite/);
        expect(content).not.toMatch(/import\s+.*['"]sqlite/i);
      }
    });
  });
});

