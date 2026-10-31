/**
 * Query API for the SQLite read model.
 * Provides filtered expense listings, financial aggregations, uncategorized inbox,
 * raw message retention, settings, and sync state tracking.
 */

function buildExpenseFilterClause(filters = {}, { forTotals = false } = {}) {
  const conditions = [];
  const params = [];

  if (!filters.includeDeleted) {
    conditions.push("status = 'active'");
  }

  if (forTotals) {
    if (filters.includeFixed) {
      conditions.push("kind IN ('spend', 'fixed')");
    } else {
      conditions.push("kind = 'spend'");
    }
  } else {
    if (!filters.includeFixed) {
      conditions.push("kind != 'fixed'");
    }
  }

  if (filters.from) {
    conditions.push('date >= ?');
    params.push(filters.from);
  }

  if (filters.to) {
    conditions.push('date <= ?');
    params.push(filters.to);
  }

  if (filters.uncategorizedOnly) {
    conditions.push('category_id IS NULL');
  } else if (filters.categoryId !== undefined) {
    if (filters.categoryId === null) {
      conditions.push('category_id IS NULL');
    } else {
      conditions.push('category_id = ?');
      params.push(filters.categoryId);
    }
  }

  if (filters.accountId) {
    conditions.push('account_id = ?');
    params.push(filters.accountId);
  }

  if (filters.mode) {
    conditions.push('mode = ?');
    params.push(filters.mode);
  }

  if (filters.createdByDev) {
    conditions.push('created_by_dev = ?');
    params.push(filters.createdByDev);
  }

  if (filters.text) {
    conditions.push('(merchant_raw LIKE ? OR brand LIKE ? OR note LIKE ?)');
    const pattern = `%${filters.text}%`;
    params.push(pattern, pattern, pattern);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return { whereClause, params };
}

/**
 * Lists expenses filtered by criteria, sorted newest first.
 * @param {object} db - Database adapter.
 * @param {object} [filters={}] - Filter criteria.
 * @returns {Promise<object[]>} Array of expense rows.
 */
export async function listExpenses(db, filters = {}) {
  const { whereClause, params } = buildExpenseFilterClause(filters, { forTotals: false });

  let sql = `SELECT * FROM expenses ${whereClause} ORDER BY date DESC, txn_ts DESC, id DESC`;

  if (filters.limit !== undefined) {
    sql += ' LIMIT ?';
    params.push(filters.limit);
    if (filters.offset !== undefined) {
      sql += ' OFFSET ?';
      params.push(filters.offset);
    }
  }

  return db.query(sql, params);
}

/**
 * Computes monetary totals for expenses matching the filters.
 * Net spend = sum(debit spend) - sum(credit spend).
 * Transfers and income never count; fixed expenses count only if includeFixed: true.
 * 
 * @param {object} db - Database adapter.
 * @param {object} [filters={}] - Filter criteria.
 * @returns {Promise<{ spendPaise: number, refundPaise: number, netPaise: number, count: number }>}
 */
export async function totals(db, filters = {}) {
  const { whereClause, params } = buildExpenseFilterClause(filters, { forTotals: true });

  const sql = `
    SELECT
      COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_paise ELSE 0 END), 0) AS spend_paise,
      COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_paise ELSE 0 END), 0) AS refund_paise,
      COUNT(*) AS count
    FROM expenses
    ${whereClause};
  `;

  const rows = await db.query(sql, params);
  const row = rows[0] || {};
  const spendPaise = Number(row.spend_paise || 0);
  const refundPaise = Number(row.refund_paise || 0);
  const netPaise = spendPaise - refundPaise;
  const count = Number(row.count || 0);

  return { spendPaise, refundPaise, netPaise, count };
}

/**
 * Aggregates net spend grouped by category ID.
 * @param {object} db - Database adapter.
 * @param {object} [filters={}] - Filter criteria.
 * @returns {Promise<Array<{ categoryId: string|null, spendPaise: number, refundPaise: number, netPaise: number, count: number }>>}
 */
export async function totalsByCategory(db, filters = {}) {
  const { whereClause, params } = buildExpenseFilterClause(filters, { forTotals: true });

  const sql = `
    SELECT
      category_id,
      COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_paise ELSE 0 END), 0) AS spend_paise,
      COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_paise ELSE 0 END), 0) AS refund_paise,
      COUNT(*) AS count
    FROM expenses
    ${whereClause}
    GROUP BY category_id
    ORDER BY (
      COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_paise ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_paise ELSE 0 END), 0)
    ) DESC;
  `;

  const rows = await db.query(sql, params);
  return rows.map((r) => {
    const spendPaise = Number(r.spend_paise || 0);
    const refundPaise = Number(r.refund_paise || 0);
    return {
      categoryId: r.category_id,
      spendPaise,
      refundPaise,
      netPaise: spendPaise - refundPaise,
      count: Number(r.count || 0),
    };
  });
}

/**
 * Aggregates net spend grouped by YYYY-MM month.
 * @param {object} db - Database adapter.
 * @param {object} [filters={}] - Filter criteria.
 * @returns {Promise<Array<{ month: string, spendPaise: number, refundPaise: number, netPaise: number, count: number }>>}
 */
export async function totalsByMonth(db, filters = {}) {
  const { whereClause, params } = buildExpenseFilterClause(filters, { forTotals: true });

  const sql = `
    SELECT
      SUBSTR(date, 1, 7) AS month,
      COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount_paise ELSE 0 END), 0) AS spend_paise,
      COALESCE(SUM(CASE WHEN direction = 'credit' THEN amount_paise ELSE 0 END), 0) AS refund_paise,
      COUNT(*) AS count
    FROM expenses
    ${whereClause}
    GROUP BY SUBSTR(date, 1, 7)
    ORDER BY month DESC;
  `;

  const rows = await db.query(sql, params);
  return rows.map((r) => {
    const spendPaise = Number(r.spend_paise || 0);
    const refundPaise = Number(r.refund_paise || 0);
    return {
      month: r.month,
      spendPaise,
      refundPaise,
      netPaise: spendPaise - refundPaise,
      count: Number(r.count || 0),
    };
  });
}

/**
 * Returns active expenses needing categorization (spend or fixed, category_id NULL, newest first).
 * @param {object} db - Database adapter.
 * @returns {Promise<object[]>} Uncategorized active expenses.
 */
export async function uncategorizedInbox(db) {
  const sql = `
    SELECT * FROM expenses
    WHERE (kind = 'spend' OR kind = 'fixed')
      AND category_id IS NULL
      AND status = 'active'
    ORDER BY date DESC, txn_ts DESC, id DESC;
  `;
  return db.query(sql);
}

/**
 * Raw message repository methods.
 */
export const rawMessages = {
  async insertRaw(db, { hash, kind, body, receivedAt, parsed }) {
    const parsedJson = parsed !== undefined ? (typeof parsed === 'string' ? parsed : JSON.stringify(parsed)) : null;
    await db.exec(
      `INSERT OR REPLACE INTO raw_messages (hash, kind, body, received_at, parsed) VALUES (?, ?, ?, ?, ?);`,
      [hash, kind, body, receivedAt, parsedJson]
    );
  },

  async existsRawHash(db, hash) {
    const rows = await db.query(`SELECT 1 FROM raw_messages WHERE hash = ? LIMIT 1;`, [hash]);
    return rows.length > 0;
  },

  async purgeRawOlderThan(db, days, now = new Date()) {
    const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
    const cutoffMs = nowMs - days * 24 * 60 * 60 * 1000;
    const cutoffIso = new Date(cutoffMs).toISOString();

    await db.exec(`DELETE FROM raw_messages WHERE received_at < ?;`, [cutoffIso]);
  },
};

/**
 * Key-value settings methods.
 */
export const settings = {
  async getSetting(db, key) {
    const rows = await db.query(`SELECT value FROM settings WHERE key = ?;`, [key]);
    return rows[0]?.value ?? null;
  },

  async setSetting(db, key, value) {
    await db.exec(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?);`, [key, value]);
  },
};

/**
 * Sync state tracker methods.
 */
export const syncState = {
  async getSyncState(db, file) {
    const rows = await db.query(`SELECT lines_read FROM sync_state WHERE file = ?;`, [file]);
    return rows[0]?.lines_read ?? 0;
  },

  async setSyncState(db, file, linesRead) {
    await db.exec(`INSERT OR REPLACE INTO sync_state (file, lines_read) VALUES (?, ?);`, [file, linesRead]);
  },
};

