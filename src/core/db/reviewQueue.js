/**
 * Queries open review items from the review_queue table.
 * 
 * @param {object} db - SQLite database adapter
 * @param {string} [typeFilter] - Optional filter for review item type (unknown_account, possible_duplicate, unparsed)
 * @returns {Promise<Array<{ id: string, type: string, payload: object, status: string }>>}
 */
export async function listReviewItems(db, typeFilter = null) {
  if (!db || typeof db.query !== 'function') return [];

  let sql = 'SELECT id, type, payload, status FROM review_queue WHERE status = ?';
  const params = ['open'];

  if (typeFilter) {
    sql += ' AND type = ?';
    params.push(typeFilter);
  }

  sql += ' ORDER BY id ASC;';

  const rows = await db.query(sql, params);
  return rows.map((row) => ({
    id: row.id,
    type: row.type,
    payload:
      typeof row.payload === 'string'
        ? (() => {
            try {
              return JSON.parse(row.payload);
            } catch {
              return row.payload;
            }
          })()
        : row.payload,
    status: row.status,
  }));
}

/**
 * Counts open review items in the review_queue table.
 * 
 * @param {object} db - SQLite database adapter
 * @returns {Promise<number>}
 */
export async function countOpenReviewItems(db) {
  if (!db || typeof db.query !== 'function') return 0;
  const rows = await db.query(
    "SELECT count(*) as c FROM review_queue WHERE status = 'open';"
  );
  return Number(rows[0]?.c ?? rows[0]?.C ?? 0);
}

/**
 * Marks a review item as resolved in the review_queue table.
 * 
 * @param {object} db - SQLite database adapter
 * @param {string} reviewId
 */
export async function markReviewResolved(db, reviewId) {
  if (!db || typeof db.exec !== 'function') return;
  await db.exec('UPDATE review_queue SET status = ? WHERE id = ?;', ['resolved', reviewId]);
}

