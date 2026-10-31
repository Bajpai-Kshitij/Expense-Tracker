/**
 * Seed data definitions for categories and accounts with fixed deterministic identifiers.
 * Guarantees convergence across multiple independent devices.
 */

export const SEED_CATEGORIES = [
  { id: 'cat_food', name: 'Food', icon: 'utensils', color: '#f97316' },
  { id: 'cat_groceries', name: 'Groceries', icon: 'shopping-cart', color: '#22c55e' },
  { id: 'cat_fuel', name: 'Fuel', icon: 'fuel', color: '#eab308' },
  { id: 'cat_travel', name: 'Travel', icon: 'plane', color: '#3b82f6' },
  { id: 'cat_shopping', name: 'Shopping', icon: 'bag-handle', color: '#ec4899' },
  { id: 'cat_bills', name: 'Bills and Utilities', icon: 'receipt', color: '#8b5cf6' },
  { id: 'cat_entertainment', name: 'Entertainment', icon: 'film', color: '#a855f7' },
  { id: 'cat_health', name: 'Health', icon: 'heart', color: '#ef4444' },
  { id: 'cat_emi', name: 'EMI and Loans', icon: 'cash', color: '#64748b' },
  { id: 'cat_cash', name: 'Cash', icon: 'banknote', color: '#10b981' },
  { id: 'cat_insurance', name: 'Insurance', icon: 'shield', color: '#06b6d4' },
  { id: 'cat_other', name: 'Other', icon: 'grid', color: '#94a3b8' },
];

export const SEED_ACCOUNTS = [
  { id: 'acc_axis_flipkart', name: 'Axis Flipkart 3765', owner: 'Me', issuer: 'Axis', lastDigits: '3765', type: 'card' },
  { id: 'acc_axis_myzone', name: 'Axis My Zone 4230', owner: 'Me', issuer: 'Axis', lastDigits: '4230', type: 'card' },
  { id: 'acc_axis_indianoil', name: 'Axis Indian Oil 7068', owner: 'Me', issuer: 'Axis', lastDigits: '7068', type: 'card' },
  { id: 'acc_icici_coral', name: 'ICICI Coral 3001', owner: 'Me', issuer: 'ICICI', lastDigits: '3001', type: 'card' },
  { id: 'acc_icici_mmt', name: 'ICICI MakeMyTrip 7008', owner: 'Me', issuer: 'ICICI', lastDigits: '7008', type: 'card' },
  { id: 'acc_icici_amazonpay', name: 'ICICI Amazon Pay 6017', owner: 'Me', issuer: 'ICICI', lastDigits: '6017', type: 'card' },
  { id: 'acc_hdfc_pixel', name: 'HDFC Pixel Play 3726', owner: 'Me', issuer: 'HDFC', lastDigits: '3726', type: 'card' },
  { id: 'acc_idfc_millennia', name: 'IDFC First Millennia 1885', owner: 'Me', issuer: 'IDFC', lastDigits: '1885', type: 'card' },
  { id: 'acc_axis_savings', name: 'Axis Savings 7693', owner: 'Me', issuer: 'Axis', lastDigits: '7693', type: 'bank' },
  { id: 'acc_icici_savings', name: 'ICICI Savings 476', owner: 'Me', issuer: 'ICICI', lastDigits: '476', type: 'bank' },
  { id: 'acc_joint', name: 'Joint Account 4425', owner: 'Joint', issuer: 'unknown', lastDigits: '4425', type: 'bank' },
  { id: 'acc_cash', name: 'Cash', owner: 'Me', issuer: null, lastDigits: null, type: 'cash' },
];

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
 * Seeds initial categories and accounts into event log if not already seeded.
 * Runs after the first sync of a session.
 * 
 * @param {object} options
 * @param {object} options.writer - LogWriter instance.
 * @param {object} [options.state] - Current reducer state.
 * @param {object} [options.settings] - Settings query object or mock.
 * @param {object} [options.db] - SQLite database adapter.
 * @returns {Promise<{ seeded: boolean, writtenCount: number }>}
 */
export async function seedIfEmpty({ writer, state, settings, db } = {}) {
  const seededStatus = await getSettingValue(settings, db, 'seeded');
  if (seededStatus === '1') {
    return { seeded: false, writtenCount: 0 };
  }

  // Determine existing category and account IDs
  const existingCatIds = new Set();
  const existingAccIds = new Set();

  if (state) {
    for (const id of Object.keys(state.categories || {})) {
      existingCatIds.add(id);
    }
    for (const id of Object.keys(state.accounts || {})) {
      existingAccIds.add(id);
    }
  } else if (db && typeof db.query === 'function') {
    const catRows = await db.query('SELECT id FROM categories;');
    for (const r of catRows) existingCatIds.add(r.id);

    const accRows = await db.query('SELECT id FROM accounts;');
    for (const r of accRows) existingAccIds.add(r.id);
  }

  let writtenCount = 0;

  // Upsert missing seed categories
  for (const cat of SEED_CATEGORIES) {
    if (!existingCatIds.has(cat.id)) {
      await writer.write('category.upserted', cat);
      writtenCount++;
    }
  }

  // Upsert missing seed accounts
  for (const acc of SEED_ACCOUNTS) {
    if (!existingAccIds.has(acc.id)) {
      await writer.write('account.upserted', acc);
      writtenCount++;
    }
  }

  // Mark seeded in settings
  await setSettingValue(settings, db, 'seeded', '1');

  return { seeded: true, writtenCount };
}

