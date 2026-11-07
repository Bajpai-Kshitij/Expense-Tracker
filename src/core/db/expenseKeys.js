/**
 * Look up expense ID by deduplication, statement, or linked key.
 *
 * @param {object} db - Database adapter { query }
 * @param {string} key - Dedup key string
 * @returns {Promise<string|null>} Found expense ID or null
 */
export async function findExpenseIdByKey(db, key) {
  if (!db || !key || typeof db.query !== 'function') return null;
  const rows = await db.query('SELECT expense_id FROM expense_keys WHERE key = ? LIMIT 1;', [key]);
  return rows[0]?.expense_id || null;
}

