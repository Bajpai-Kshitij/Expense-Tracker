/**
 * Seed starter brands and a disabled sample rule with fixed deterministic IDs.
 * Guarantees convergence across devices.
 */

export const STARTER_BRANDS = [
  // Food
  { id: 'brand_swiggy', name: 'Swiggy', pattern: 'SWIGGY', mode: 'words', categoryId: 'cat_food', kind: null, note: '', priority: 10, active: true },
  { id: 'brand_zomato', name: 'Zomato', pattern: 'ZOMATO', mode: 'words', categoryId: 'cat_food', kind: null, note: '', priority: 10, active: true },

  // Groceries
  { id: 'brand_blinkit', name: 'Blinkit', pattern: 'BLINKIT', mode: 'words', categoryId: 'cat_groceries', kind: null, note: '', priority: 10, active: true },
  { id: 'brand_zepto', name: 'Zepto', pattern: 'ZEPTO', mode: 'words', categoryId: 'cat_groceries', kind: null, note: '', priority: 10, active: true },
  { id: 'brand_bigbasket', name: 'BigBasket', pattern: 'BIGBASKET', mode: 'words', categoryId: 'cat_groceries', kind: null, note: '', priority: 10, active: true },

  // Shopping
  { id: 'brand_amazon', name: 'Amazon', pattern: 'AMAZON', mode: 'words', categoryId: 'cat_shopping', kind: null, note: '', priority: 10, active: true },
  { id: 'brand_flipkart', name: 'Flipkart', pattern: 'FLIPKART', mode: 'words', categoryId: 'cat_shopping', kind: null, note: '', priority: 10, active: true },
  { id: 'brand_myntra', name: 'Myntra', pattern: 'MYNTRA', mode: 'words', categoryId: 'cat_shopping', kind: null, note: '', priority: 10, active: true },
  { id: 'brand_ajio', name: 'Ajio', pattern: 'AJIO', mode: 'words', categoryId: 'cat_shopping', kind: null, note: '', priority: 10, active: true },

  // Travel
  { id: 'brand_irctc', name: 'IRCTC', pattern: 'IRCTC', mode: 'words', categoryId: 'cat_travel', kind: null, note: '', priority: 10, active: true },
  { id: 'brand_uber', name: 'Uber', pattern: 'UBER', mode: 'words', categoryId: 'cat_travel', kind: null, note: '', priority: 10, active: true },
  { id: 'brand_ola', name: 'Ola', pattern: 'OLA', mode: 'words', categoryId: 'cat_travel', kind: null, note: '', priority: 10, active: true },
  { id: 'brand_makemytrip', name: 'MakeMyTrip', pattern: 'MAKEMYTRIP', mode: 'words', categoryId: 'cat_travel', kind: null, note: '', priority: 10, active: true },

  // Fuel
  { id: 'brand_indianoil', name: 'Indian Oil', pattern: 'INDIAN OIL|IOCL', mode: 'words', categoryId: 'cat_fuel', kind: null, note: '', priority: 10, active: true },
  { id: 'brand_hpcl', name: 'HPCL', pattern: 'HPCL', mode: 'words', categoryId: 'cat_fuel', kind: null, note: '', priority: 10, active: true },
  { id: 'brand_bpcl', name: 'BPCL', pattern: 'BPCL', mode: 'words', categoryId: 'cat_fuel', kind: null, note: '', priority: 10, active: true },
  { id: 'brand_shell', name: 'Shell', pattern: 'SHELL', mode: 'words', categoryId: 'cat_fuel', kind: null, note: '', priority: 10, active: true },

  // Entertainment
  { id: 'brand_netflix', name: 'Netflix', pattern: 'NETFLIX', mode: 'words', categoryId: 'cat_entertainment', kind: null, note: '', priority: 10, active: true },
  { id: 'brand_spotify', name: 'Spotify', pattern: 'SPOTIFY', mode: 'words', categoryId: 'cat_entertainment', kind: null, note: '', priority: 10, active: true },
  { id: 'brand_hotstar', name: 'Hotstar', pattern: 'HOTSTAR', mode: 'words', categoryId: 'cat_entertainment', kind: null, note: '', priority: 10, active: true },
  { id: 'brand_bookmyshow', name: 'BookMyShow', pattern: 'BOOKMYSHOW', mode: 'words', categoryId: 'cat_entertainment', kind: null, note: '', priority: 10, active: true },
  { id: 'brand_district', name: 'District', pattern: 'DISTRICT', mode: 'words', categoryId: 'cat_entertainment', kind: null, note: '', priority: 10, active: true },

  // Health
  { id: 'brand_apollo', name: 'Apollo', pattern: 'APOLLO', mode: 'words', categoryId: 'cat_health', kind: null, note: '', priority: 10, active: true },
  { id: 'brand_pharmeasy', name: 'PharmEasy', pattern: 'PHARMEASY', mode: 'words', categoryId: 'cat_health', kind: null, note: '', priority: 10, active: true },
  { id: 'brand_1mg', name: '1mg', pattern: '1MG', mode: 'words', categoryId: 'cat_health', kind: null, note: '', priority: 10, active: true },

  // Bills and Utilities
  { id: 'brand_airtel', name: 'Airtel', pattern: 'AIRTEL', mode: 'words', categoryId: 'cat_bills', kind: null, note: '', priority: 10, active: true },
  { id: 'brand_jio', name: 'Jio', pattern: 'JIO', mode: 'words', categoryId: 'cat_bills', kind: null, note: '', priority: 10, active: true },
  { id: 'brand_electricity', name: 'Electricity', pattern: 'ELECTRICITY', mode: 'words', categoryId: 'cat_bills', kind: null, note: '', priority: 10, active: true },

  // Insurance with kind "fixed"
  { id: 'brand_policybazaar', name: 'PolicyBazaar', pattern: 'POLICYBAZAAR', mode: 'words', categoryId: 'cat_insurance', kind: 'fixed', note: '', priority: 10, active: true },
];

export const SAMPLE_RULE = {
  id: 'rule_sample_starbucks',
  priority: 100,
  field: 'merchant',
  pattern: 'STARBUCKS',
  mode: 'words',
  accountId: null,
  direction: null,
  minPaise: null,
  maxPaise: null,
  categoryId: 'cat_food',
  kind: null,
  note: 'Sample rule explaining how rules work: automatically maps Starbucks transactions to Food category',
  active: false, // disabled sample rule
};

async function getSettingValue(settings, db, key) {
  if (settings && typeof settings.getSetting === 'function') {
    if (db) {
      try {
        const val = await settings.getSetting(db, key);
        if (val !== undefined) return val;
      } catch (e) {}
    }
    try {
      const val = await settings.getSetting(key);
      if (val !== undefined) return val;
    } catch (e) {}
  }
  if (settings && typeof settings.get === 'function') {
    return settings.get(key);
  }
  if (db && typeof db.query === 'function') {
    const rows = await db.query('SELECT value FROM settings WHERE key = ?;', [key]);
    return rows[0]?.value ?? null;
  }
  return null;
}

async function setSettingValue(settings, db, key, value) {
  if (settings && typeof settings.setSetting === 'function') {
    if (db) {
      try {
        return await settings.setSetting(db, key, value);
      } catch (e) {}
    }
    try {
      return await settings.setSetting(key, value);
    } catch (e) {}
  }
  if (settings && typeof settings.set === 'function') {
    return settings.set(key, value);
  }
  if (db && typeof db.exec === 'function') {
    return db.exec('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);', [key, value]);
  }
}

/**
 * Seeds starter brands and sample rule if not already seeded.
 * 
 * @param {object} options
 * @param {object} options.writer - LogWriter instance.
 * @param {object} [options.state] - Current reducer state.
 * @param {object} [options.settings] - Settings query object or mock.
 * @param {object} [options.db] - SQLite database adapter.
 * @returns {Promise<{ seeded: boolean, writtenCount: number }>}
 */
export async function seedBrandsIfEmpty({ writer, state, settings, db } = {}) {
  const seededStatus = await getSettingValue(settings, db, 'seeded_brands');
  if (seededStatus === '1') {
    return { seeded: false, writtenCount: 0 };
  }

  const existingBrandIds = new Set();
  const existingRuleIds = new Set();

  if (state) {
    for (const id of Object.keys(state.brands || {})) existingBrandIds.add(id);
    for (const id of Object.keys(state.rules || {})) existingRuleIds.add(id);
  } else if (db && typeof db.query === 'function') {
    const brandRows = await db.query('SELECT id FROM brands;');
    for (const r of brandRows) existingBrandIds.add(r.id);

    const ruleRows = await db.query('SELECT id FROM rules;');
    for (const r of ruleRows) existingRuleIds.add(r.id);
  }

  let writtenCount = 0;

  // Add missing starter brands
  for (const b of STARTER_BRANDS) {
    if (!existingBrandIds.has(b.id)) {
      await writer.write('brand.upserted', b);
      writtenCount++;
    }
  }

  // Add missing sample rule
  if (!existingRuleIds.has(SAMPLE_RULE.id)) {
    await writer.write('rule.upserted', SAMPLE_RULE);
    writtenCount++;
  }

  // Mark seeded_brands = '1'
  await setSettingValue(settings, db, 'seeded_brands', '1');

  return { seeded: true, writtenCount };
}

