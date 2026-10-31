import { describe, it, expect, beforeEach } from 'vitest';
import {
  SEED_CATEGORIES,
  SEED_ACCOUNTS,
  seedIfEmpty,
} from './seed.js';
import { createSqljsAdapter } from '../db/testing/sqljsAdapter.js';
import { migrate, settings } from '../db/index.js';

describe('PHASE P5 - Seed Data and Bootstrap', () => {
  it('Seed data integrity: unique IDs, valid categories and accounts with owners', () => {
    // 1. Categories
    expect(SEED_CATEGORIES.length).toBeGreaterThanOrEqual(12);
    const catIds = new Set();
    for (const cat of SEED_CATEGORIES) {
      expect(cat.id).toMatch(/^cat_[a-z_]+$/);
      expect(catIds.has(cat.id)).toBe(false);
      catIds.add(cat.id);
      expect(typeof cat.name).toBe('string');
      expect(cat.name.length).toBeGreaterThan(0);
    }

    // 2. Accounts
    expect(SEED_ACCOUNTS.length).toBeGreaterThanOrEqual(12);
    const accIds = new Set();
    const validOwners = new Set(['Me', 'Wife', 'Joint']);
    const validTypes = new Set(['card', 'bank', 'cash']);

    for (const acc of SEED_ACCOUNTS) {
      expect(acc.id).toMatch(/^acc_[a-z0-9_]+$/);
      expect(accIds.has(acc.id)).toBe(false);
      accIds.add(acc.id);
      expect(typeof acc.name).toBe('string');
      expect(validOwners.has(acc.owner)).toBe(true);
      expect(validTypes.has(acc.type)).toBe(true);
    }
  });

  describe('seedIfEmpty execution', () => {
    let writtenEvents;
    let mockWriter;
    let db;

    beforeEach(async () => {
      writtenEvents = [];
      mockWriter = {
        write: async (type, data) => {
          writtenEvents.push({ type, data });
          return { id: `ev_${writtenEvents.length}`, type, data };
        },
      };

      db = await createSqljsAdapter();
      await migrate(db);
    });

    it('writes all missing categories and accounts on first run and sets seeded="1"', async () => {
      const res = await seedIfEmpty({
        writer: mockWriter,
        db,
        settings,
      });

      expect(res.seeded).toBe(true);
      expect(res.writtenCount).toBe(SEED_CATEGORIES.length + SEED_ACCOUNTS.length);
      expect(writtenEvents).toHaveLength(SEED_CATEGORIES.length + SEED_ACCOUNTS.length);

      // Verify setting stored
      const stored = await settings.getSetting(db, 'seeded');
      expect(stored).toBe('1');

      // Second run is a no-op
      const res2 = await seedIfEmpty({
        writer: mockWriter,
        db,
        settings,
      });
      expect(res2.seeded).toBe(false);
      expect(res2.writtenCount).toBe(0);
    });

    it('does not overwrite existing category or account IDs', async () => {
      // Simulate state with an existing category
      const existingState = {
        categories: {
          cat_food: { id: 'cat_food', name: 'Custom Food Name' },
        },
        accounts: {},
      };

      const res = await seedIfEmpty({
        writer: mockWriter,
        state: existingState,
        db,
        settings,
      });

      expect(res.seeded).toBe(true);
      // cat_food should not be re-written
      const foodEvent = writtenEvents.find(
        (e) => e.type === 'category.upserted' && e.data.id === 'cat_food'
      );
      expect(foodEvent).toBeUndefined();
    });
  });
});

