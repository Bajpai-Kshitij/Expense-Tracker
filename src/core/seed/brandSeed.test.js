import { describe, it, expect, beforeEach } from 'vitest';
import { STARTER_BRANDS, SAMPLE_RULE, seedBrandsIfEmpty } from './brandSeed.js';
import { createSqljsAdapter } from '../db/testing/sqljsAdapter.js';
import { migrate, settings } from '../db/index.js';

describe('PHASE P6 - Brand and Rule Seed Integrity', () => {
  it('Starter brands integrity: unique IDs, valid categories and patterns', () => {
    expect(STARTER_BRANDS.length).toBeGreaterThanOrEqual(20);
    const ids = new Set();
    for (const b of STARTER_BRANDS) {
      expect(b.id).toMatch(/^brand_[a-z0-9_]+$/);
      expect(ids.has(b.id)).toBe(false);
      ids.add(b.id);
      expect(typeof b.name).toBe('string');
      expect(typeof b.pattern).toBe('string');
      expect(b.categoryId).toMatch(/^cat_[a-z_]+$/);
      expect(b.active).toBe(true);
      expect(b.mode).toBe('words');
    }

    expect(SAMPLE_RULE.id).toBe('rule_sample_starbucks');
    expect(SAMPLE_RULE.active).toBe(false);
  });

  describe('seedBrandsIfEmpty execution', () => {
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

    it('writes all starter brands and the sample rule on first run and sets seeded_brands="1"', async () => {
      const res = await seedBrandsIfEmpty({
        writer: mockWriter,
        db,
        settings,
      });

      expect(res.seeded).toBe(true);
      expect(res.writtenCount).toBe(STARTER_BRANDS.length + 1); // +1 for sample rule
      expect(writtenEvents).toHaveLength(STARTER_BRANDS.length + 1);

      const stored = await settings.getSetting(db, 'seeded_brands');
      expect(stored).toBe('1');

      // Second run is a no-op
      const res2 = await seedBrandsIfEmpty({
        writer: mockWriter,
        db,
        settings,
      });
      expect(res2.seeded).toBe(false);
      expect(res2.writtenCount).toBe(0);
    });

    it('Seed adds only missing ids and never overwrites an edited brand', async () => {
      // Simulate existing brand in state that has been edited by user
      const existingState = {
        brands: {
          brand_swiggy: {
            id: 'brand_swiggy',
            name: 'My Swiggy Custom Name',
            pattern: 'SWIGGY|BUNDL',
            categoryId: 'cat_groceries',
          },
        },
        rules: {},
      };

      const res = await seedBrandsIfEmpty({
        writer: mockWriter,
        state: existingState,
        db,
        settings,
      });

      expect(res.seeded).toBe(true);
      // brand_swiggy must NOT be re-written
      const swiggyEvent = writtenEvents.find(
        (e) => e.type === 'brand.upserted' && e.data.id === 'brand_swiggy'
      );
      expect(swiggyEvent).toBeUndefined();
    });
  });
});

