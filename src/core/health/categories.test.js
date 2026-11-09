import { describe, it, expect } from 'vitest';
import {
  categoryLabel,
  buildFullCategory,
  restoreDefaultCategories,
  getCategoriesDump,
  getCategoriesDumpFromLogs,
  getCategoryEventCounts,
} from './categories.js';
import { SEED_CATEGORIES } from '../seed/seed.js';
import { createEmptyState, applyEvents } from '../events/reducer.js';

describe('Category Health & Integrity', () => {
  describe('categoryLabel', () => {
    const categories = [
      { id: 'cat_food', name: 'Food', color: '#f97316', icon: '🍽', archived: false },
      { id: 'cat_travel', name: 'Travel', color: '#3b82f6', icon: '✈️', archived: true },
    ];

    it('returns "Uncategorized" ONLY when id is null, undefined, or empty string', () => {
      expect(categoryLabel(null, categories)).toBe('Uncategorized');
      expect(categoryLabel(undefined, categories)).toBe('Uncategorized');
      expect(categoryLabel('', categories)).toBe('Uncategorized');
    });

    it('returns real name for active category', () => {
      expect(categoryLabel('cat_food', categories)).toBe('Food');
    });

    it('archived categories still resolve by name: returns real name with " (archived)"', () => {
      expect(categoryLabel('cat_travel', categories)).toBe('Travel (archived)');
    });

    it('returns "Unknown category" for ids that do not exist', () => {
      expect(categoryLabel('cat_nonexistent_xyz', categories)).toBe('Unknown category');
    });

    it('handles categories map object as well as array', () => {
      const map = {
        cat_food: { id: 'cat_food', name: 'Food', archived: false },
        cat_travel: { id: 'cat_travel', name: 'Travel', archived: true },
      };
      expect(categoryLabel('cat_food', map)).toBe('Food');
      expect(categoryLabel('cat_travel', map)).toBe('Travel (archived)');
      expect(categoryLabel('cat_random', map)).toBe('Unknown category');
    });
  });

  describe('archiving writes the FULL category object', () => {
    it('archive keeps the name and colour', () => {
      const activeCat = { id: 'cat_food', name: 'Food', color: '#f97316', icon: '🍽', archived: false };
      const toggled = buildFullCategory({ ...activeCat, archived: true });

      expect(toggled.id).toBe('cat_food');
      expect(toggled.name).toBe('Food');
      expect(toggled.color).toBe('#f97316');
      expect(toggled.icon).toBe('🍽');
      expect(toggled.archived).toBe(true);
    });

    it('falls back to seed defaults if incoming category had partial fields', () => {
      const partialCat = { id: 'cat_fuel', archived: true };
      const full = buildFullCategory(partialCat);

      expect(full.id).toBe('cat_fuel');
      expect(full.name).toBe('Fuel');
      expect(full.icon).toBe('⛽');
      expect(full.color).toBe('#eab308');
      expect(full.archived).toBe(true);
    });
  });

  describe('rebuild from logs equals incremental state', () => {
    it('rebuilding category state from log events equals step-by-step state', () => {
      const events = [
        {
          v: 1,
          id: 'ev_1',
          type: 'category.upserted',
          dev: 'devA',
          seq: 1,
          ts: '2026-02-01T10:00:00.000+05:30',
          data: { id: 'cat_food', name: 'Food', color: '#f97316', icon: '🍽', archived: false },
        },
        {
          v: 1,
          id: 'ev_2',
          type: 'category.upserted',
          dev: 'devA',
          seq: 2,
          ts: '2026-02-02T10:00:00.000+05:30',
          data: { id: 'cat_fuel', name: 'Fuel', color: '#eab308', icon: '⛽', archived: false },
        },
        {
          v: 1,
          id: 'ev_3',
          type: 'category.upserted',
          dev: 'devB',
          seq: 1,
          ts: '2026-02-03T10:00:00.000+05:30',
          data: { id: 'cat_food', name: 'Food & Dining', color: '#f97316', icon: '🍽', archived: false },
        },
      ];

      // Incremental state
      let stateInc = createEmptyState();
      for (const ev of events) {
        stateInc = applyEvents(stateInc, [ev]);
      }

      // Recomputed all-at-once
      const stateAll = applyEvents(createEmptyState(), events);

      expect(stateInc.categories).toEqual(stateAll.categories);
      expect(stateAll.categories.cat_food.name).toBe('Food & Dining');
      expect(stateAll.categories.cat_fuel.name).toBe('Fuel');
    });
  });

  describe('restoreDefaultCategories', () => {
    it('restore is idempotent: active categories are untouched, missing/archived are restored', async () => {
      const writtenEvents = [];
      const mockWriter = {
        write: async (type, data) => {
          writtenEvents.push({ type, data });
        },
      };

      // Scenario: user has cat_food active, cat_fuel archived, and all other seed categories missing
      const initialCategories = [
        { id: 'cat_food', name: 'Custom Food Name', color: '#ff0000', icon: '🍔', archived: false },
        { id: 'cat_fuel', name: 'Fuel', color: '#eab308', icon: '⛽', archived: true },
      ];

      const res1 = await restoreDefaultCategories({
        writer: mockWriter,
        categories: initialCategories,
        seedCategories: SEED_CATEGORIES,
      });

      // SEED_CATEGORIES has 13 items (cat_fees added). cat_food was active, so 12 needed restore.
      expect(res1.restoredCount).toBe(12);
      expect(writtenEvents).toHaveLength(12);

      // cat_food was NOT restored/overwritten
      const foodEvent = writtenEvents.find((e) => e.data.id === 'cat_food');
      expect(foodEvent).toBeUndefined();

      // cat_fuel was restored to active
      const fuelEvent = writtenEvents.find((e) => e.data.id === 'cat_fuel');
      expect(fuelEvent).toBeDefined();
      expect(fuelEvent.data.archived).toBe(false);

      // Now run again with the restored categories list (idempotency check)
      const restoredCategories = [
        initialCategories[0], // cat_food remains active
        ...writtenEvents.map((e) => e.data),
      ];

      writtenEvents.length = 0;
      const res2 = await restoreDefaultCategories({
        writer: mockWriter,
        categories: restoredCategories,
        seedCategories: SEED_CATEGORIES,
      });

      expect(res2.restoredCount).toBe(0);
      expect(writtenEvents).toHaveLength(0);
    });
  });

  describe('Developer tools diagnostic helpers', () => {
    const events = [
      {
        v: 1,
        id: 'ev_1',
        type: 'category.upserted',
        dev: 'phone1',
        seq: 1,
        ts: '2026-02-01T10:00:00+05:30',
        data: { id: 'cat_food', name: 'Food', archived: false },
      },
      {
        v: 1,
        id: 'ev_2',
        type: 'category.upserted',
        dev: 'phone2',
        seq: 2,
        ts: '2026-02-05T12:00:00+05:30',
        data: { id: 'cat_food', name: 'Food', archived: true },
      },
      {
        v: 1,
        id: 'ev_3',
        type: 'category.upserted',
        dev: 'phone1',
        seq: 3,
        ts: '2026-02-03T10:00:00+05:30',
        data: { id: 'cat_fuel', name: 'Fuel', archived: false },
      },
    ];

    it('(1) getCategoriesDump lists categories with last event ts and dev', () => {
      const dump = getCategoriesDump(
        [
          { id: 'cat_food', name: 'Food', archived: true },
          { id: 'cat_fuel', name: 'Fuel', archived: false },
        ],
        events
      );
      expect(dump).toHaveLength(2);
      expect(dump[0]).toEqual({
        id: 'cat_food',
        name: 'Food',
        archived: true,
        lastTs: '2026-02-05T12:00:00+05:30',
        lastDev: 'phone2',
      });
    });

    it('(2) getCategoriesDumpFromLogs recomputes state from log events', () => {
      const dump = getCategoriesDumpFromLogs(events);
      expect(dump).toHaveLength(2);
      const food = dump.find((d) => d.id === 'cat_food');
      expect(food?.archived).toBe(true);
      expect(food?.lastDev).toBe('phone2');
    });

    it('(3) getCategoryEventCounts counts upserted events and last archived value', () => {
      const counts = getCategoryEventCounts(events);
      expect(counts).toHaveLength(2);
      const food = counts.find((c) => c.id === 'cat_food');
      expect(food).toEqual({
        id: 'cat_food',
        count: 2,
        lastArchived: true,
        lastTs: '2026-02-05T12:00:00+05:30',
        lastDev: 'phone2',
      });
      const fuel = counts.find((c) => c.id === 'cat_fuel');
      expect(fuel).toEqual({
        id: 'cat_fuel',
        count: 1,
        lastArchived: false,
        lastTs: '2026-02-03T10:00:00+05:30',
        lastDev: 'phone1',
      });
    });
  });
});
