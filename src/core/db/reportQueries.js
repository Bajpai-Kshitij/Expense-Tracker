/**
 * Reporting and aggregation queries for SQLite read model.
 * Executes parameterized SQL aggregations without loading raw rows into memory.
 */

function buildFilterClause(filters = {}) {
  const conditions = ["e.status = 'active'"];
  const params = [];

  if (filters.includeFixed) {
    conditions.push("e.kind IN ('spend', 'fixed')");
  } else {
    conditions.push("e.kind = 'spend'");
  }

  if (filters.from) {
    conditions.push('e.date >= ?');
    params.push(filters.from);
  }

  if (filters.to) {
    conditions.push('e.date <= ?');
    params.push(filters.to);
  }

  if (filters.accountId) {
    conditions.push('e.account_id = ?');
    params.push(filters.accountId);
  }

  if (filters.owner) {
    if (filters.owner === 'Unassigned') {
      conditions.push(
        "(e.account_id IS NULL OR json_extract(a.extras, '$.owner') NOT IN ('Me', 'Wife', 'Joint') OR json_extract(a.extras, '$.owner') IS NULL)"
      );
    } else {
      conditions.push("json_extract(a.extras, '$.owner') = ?");
      params.push(filters.owner);
    }
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  return { whereClause, params };
}

/**
 * Aggregates net spend and count by category ID.
 * Returns null for uncategorized expenses.
 * 
 * @param {object} db
 * @param {object} [filters={}]
 * @returns {Promise<Array<{ categoryId: string|null, netPaise: number, count: number }>>}
 */
export async function categoryTotals(db, filters = {}) {
  const { whereClause, params } = buildFilterClause(filters);

  const sql = `
    SELECT
      e.category_id AS categoryId,
      COALESCE(SUM(CASE WHEN e.direction = 'debit' THEN e.amount_paise ELSE -e.amount_paise END), 0) AS netPaise,
      COUNT(*) AS count
    FROM expenses e
    LEFT JOIN accounts a ON e.account_id = a.id
    ${whereClause}
    GROUP BY e.category_id
    ORDER BY netPaise DESC;
  `;

  const rows = await db.query(sql, params);
  return (rows || []).map((r) => ({
    categoryId: r.categoryId !== undefined ? r.categoryId : null,
    netPaise: Number(r.netPaise || 0),
    count: Number(r.count || 0),
  }));
}

/**
 * Aggregates net spend and count by day.
 * 
 * @param {object} db
 * @param {object} [filters={}]
 * @returns {Promise<Array<{ date: string, netPaise: number, count: number }>>}
 */
export async function dayTotals(db, filters = {}) {
  const { whereClause, params } = buildFilterClause(filters);

  const sql = `
    SELECT
      e.date,
      COALESCE(SUM(CASE WHEN e.direction = 'debit' THEN e.amount_paise ELSE -e.amount_paise END), 0) AS netPaise,
      COUNT(*) AS count
    FROM expenses e
    LEFT JOIN accounts a ON e.account_id = a.id
    ${whereClause}
    GROUP BY e.date
    ORDER BY e.date ASC;
  `;

  const rows = await db.query(sql, params);
  return (rows || []).map((r) => ({
    date: r.date,
    netPaise: Number(r.netPaise || 0),
    count: Number(r.count || 0),
  }));
}

/**
 * Monthly aggregations in a single query across a month range.
 * Fixed and income amounts are returned separately regardless of includeFixed.
 * 
 * @param {object} db
 * @param {object} filters
 * @param {string} filters.fromMonth "YYYY-MM"
 * @param {string} filters.toMonth "YYYY-MM"
 * @param {boolean} [filters.includeFixed=false]
 * @param {string} [filters.accountId]
 * @param {string} [filters.owner]
 * @returns {Promise<Array<{ month: string, netPaise: number, fixedPaise: number, incomePaise: number, count: number }>>}
 */
export async function monthTotals(db, filters = {}) {
  const conditions = ["e.status = 'active'"];
  const params = [];

  const fromMonth = filters.fromMonth || (filters.from ? filters.from.slice(0, 7) : null);
  const toMonth = filters.toMonth || (filters.to ? filters.to.slice(0, 7) : null);

  if (fromMonth) {
    conditions.push('substr(e.date, 1, 7) >= ?');
    params.push(fromMonth);
  }
  if (toMonth) {
    conditions.push('substr(e.date, 1, 7) <= ?');
    params.push(toMonth);
  }

  if (filters.accountId) {
    conditions.push('e.account_id = ?');
    params.push(filters.accountId);
  }

  if (filters.owner) {
    if (filters.owner === 'Unassigned') {
      conditions.push(
        "(e.account_id IS NULL OR json_extract(a.extras, '$.owner') NOT IN ('Me', 'Wife', 'Joint') OR json_extract(a.extras, '$.owner') IS NULL)"
      );
    } else {
      conditions.push("json_extract(a.extras, '$.owner') = ?");
      params.push(filters.owner);
    }
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;
  const includeFixed = Boolean(filters.includeFixed);

  const sql = `
    SELECT
      substr(e.date, 1, 7) AS month,
      COALESCE(SUM(CASE
        WHEN ${includeFixed ? "e.kind IN ('spend', 'fixed')" : "e.kind = 'spend'"}
        THEN (CASE WHEN e.direction = 'debit' THEN e.amount_paise ELSE -e.amount_paise END)
        ELSE 0
      END), 0) AS netPaise,
      COUNT(CASE
        WHEN ${includeFixed ? "e.kind IN ('spend', 'fixed')" : "e.kind = 'spend'"}
        THEN 1
        ELSE NULL
      END) AS count,
      COALESCE(SUM(CASE
        WHEN e.kind = 'fixed'
        THEN (CASE WHEN e.direction = 'debit' THEN e.amount_paise ELSE -e.amount_paise END)
        ELSE 0
      END), 0) AS fixedPaise,
      COALESCE(SUM(CASE
        WHEN e.kind = 'income' AND e.direction = 'credit'
        THEN e.amount_paise
        ELSE 0
      END), 0) AS incomePaise
    FROM expenses e
    LEFT JOIN accounts a ON e.account_id = a.id
    ${whereClause}
    GROUP BY substr(e.date, 1, 7)
    ORDER BY month ASC;
  `;

  const rows = await db.query(sql, params);
  return (rows || []).map((r) => ({
    month: r.month,
    netPaise: Number(r.netPaise || 0),
    fixedPaise: Number(r.fixedPaise || 0),
    incomePaise: Number(r.incomePaise || 0),
    count: Number(r.count || 0),
  }));
}

/**
 * Top brands / merchants aggregation.
 * Groups by brand when set, else by first alphanumeric token of merchant_raw upper-cased,
 * else "(no merchant)".
 * 
 * @param {object} db
 * @param {object} [filters={}]
 * @param {number} [filters.limit=10]
 * @returns {Promise<Array<{ key: string, label: string, netPaise: number, count: number }>>}
 */
export async function topBrands(db, filters = {}) {
  const { whereClause, params } = buildFilterClause(filters);

  // Group by (brand, merchant_raw) in SQL to avoid loading all raw rows
  const sql = `
    SELECT
      e.brand,
      e.merchant_raw,
      COALESCE(SUM(CASE WHEN e.direction = 'debit' THEN e.amount_paise ELSE -e.amount_paise END), 0) AS net_paise,
      COUNT(*) AS count
    FROM expenses e
    LEFT JOIN accounts a ON e.account_id = a.id
    ${whereClause}
    GROUP BY e.brand, e.merchant_raw;
  `;

  const rows = await db.query(sql, params);

  // Group by brand or first alphanumeric token of merchant_raw
  const map = new Map();

  for (const r of rows || []) {
    let key = '(no merchant)';
    let label = '(no merchant)';

    if (r.brand && r.brand.trim()) {
      key = r.brand.trim();
      label = key;
    } else if (r.merchant_raw && r.merchant_raw.trim()) {
      const match = r.merchant_raw.match(/[a-zA-Z0-9]+/);
      if (match) {
        key = match[0].toUpperCase();
        label = key;
      }
    }

    const net = Number(r.net_paise || 0);
    const cnt = Number(r.count || 0);

    if (!map.has(key)) {
      map.set(key, { key, label, netPaise: 0, count: 0 });
    }
    const item = map.get(key);
    item.netPaise += net;
    item.count += cnt;
  }

  const list = Array.from(map.values()).sort((a, b) => b.netPaise - a.netPaise);
  const limit = typeof filters.limit === 'number' && filters.limit > 0 ? filters.limit : 10;
  return list.slice(0, limit);
}

/**
 * Aggregates net spend and count by account ID.
 * 
 * @param {object} db
 * @param {object} [filters={}]
 * @returns {Promise<Array<{ accountId: string|null, netPaise: number, count: number }>>}
 */
export async function accountTotals(db, filters = {}) {
  const { whereClause, params } = buildFilterClause(filters);

  const sql = `
    SELECT
      e.account_id AS accountId,
      COALESCE(SUM(CASE WHEN e.direction = 'debit' THEN e.amount_paise ELSE -e.amount_paise END), 0) AS netPaise,
      COUNT(*) AS count
    FROM expenses e
    LEFT JOIN accounts a ON e.account_id = a.id
    ${whereClause}
    GROUP BY e.account_id
    ORDER BY netPaise DESC;
  `;

  const rows = await db.query(sql, params);
  return (rows || []).map((r) => ({
    accountId: r.accountId !== undefined ? r.accountId : null,
    netPaise: Number(r.netPaise || 0),
    count: Number(r.count || 0),
  }));
}

/**
 * Aggregates net spend and count by account owner ("Me"|"Wife"|"Joint"|"Unassigned").
 * Rows with no account owner are placed into "Unassigned".
 * 
 * @param {object} db
 * @param {object} [filters={}]
 * @returns {Promise<Array<{ owner: string, netPaise: number, count: number }>>}
 */
export async function ownerTotals(db, filters = {}) {
  const { whereClause, params } = buildFilterClause(filters);

  const sql = `
    SELECT
      CASE
        WHEN json_extract(a.extras, '$.owner') IN ('Me', 'Wife', 'Joint') THEN json_extract(a.extras, '$.owner')
        ELSE 'Unassigned'
      END AS owner,
      COALESCE(SUM(CASE WHEN e.direction = 'debit' THEN e.amount_paise ELSE -e.amount_paise END), 0) AS netPaise,
      COUNT(*) AS count
    FROM expenses e
    LEFT JOIN accounts a ON e.account_id = a.id
    ${whereClause}
    GROUP BY owner
    ORDER BY netPaise DESC;
  `;

  const rows = await db.query(sql, params);
  return (rows || []).map((r) => ({
    owner: r.owner,
    netPaise: Number(r.netPaise || 0),
    count: Number(r.count || 0),
  }));
}

/**
 * Aggregates net spend and count by device ID (created_by_dev).
 * 
 * @param {object} db
 * @param {object} [filters={}]
 * @returns {Promise<Array<{ deviceId: string|null, netPaise: number, count: number }>>}
 */
export async function addedByTotals(db, filters = {}) {
  const { whereClause, params } = buildFilterClause(filters);

  const sql = `
    SELECT
      e.created_by_dev AS deviceId,
      COALESCE(SUM(CASE WHEN e.direction = 'debit' THEN e.amount_paise ELSE -e.amount_paise END), 0) AS netPaise,
      COUNT(*) AS count
    FROM expenses e
    LEFT JOIN accounts a ON e.account_id = a.id
    ${whereClause}
    GROUP BY e.created_by_dev
    ORDER BY netPaise DESC;
  `;

  const rows = await db.query(sql, params);
  return (rows || []).map((r) => ({
    deviceId: r.deviceId || null,
    netPaise: Number(r.netPaise || 0),
    count: Number(r.count || 0),
  }));
}

/**
 * Aggregates uncounted totals (transfers out, transfers in, income) for active expenses.
 * 
 * @param {object} db
 * @param {object} [filters={}]
 * @returns {Promise<{ transfersOutPaise: number, transfersInPaise: number, incomePaise: number }>}
 */
export async function uncountedTotals(db, filters = {}) {
  const conditions = ["e.status = 'active'"];
  const params = [];

  const from = filters.from || (filters.fromMonth ? `${filters.fromMonth}-01` : null);
  const to = filters.to || (filters.toMonth ? `${filters.toMonth}-31` : null);

  if (from) {
    conditions.push('e.date >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('e.date <= ?');
    params.push(to);
  }

  if (filters.accountId) {
    conditions.push('e.account_id = ?');
    params.push(filters.accountId);
  }

  if (filters.owner) {
    if (filters.owner === 'Unassigned') {
      conditions.push(
        "(e.account_id IS NULL OR json_extract(a.extras, '$.owner') NOT IN ('Me', 'Wife', 'Joint') OR json_extract(a.extras, '$.owner') IS NULL)"
      );
    } else {
      conditions.push("json_extract(a.extras, '$.owner') = ?");
      params.push(filters.owner);
    }
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`;

  const sql = `
    SELECT
      COALESCE(SUM(CASE WHEN e.kind = 'transfer' AND e.direction = 'debit' THEN e.amount_paise ELSE 0 END), 0) AS transfersOutPaise,
      COALESCE(SUM(CASE WHEN e.kind = 'transfer' AND e.direction = 'credit' THEN e.amount_paise ELSE 0 END), 0) AS transfersInPaise,
      COALESCE(SUM(CASE WHEN e.kind = 'income' THEN e.amount_paise ELSE 0 END), 0) AS incomePaise
    FROM expenses e
    LEFT JOIN accounts a ON e.account_id = a.id
    ${whereClause};
  `;

  const rows = await db.query(sql, params);
  const row = rows[0] || {};
  return {
    transfersOutPaise: Number(row.transfersOutPaise ?? row.TRANSFERSOUTPAISE ?? 0),
    transfersInPaise: Number(row.transfersInPaise ?? row.TRANSFERSINPAISE ?? 0),
    incomePaise: Number(row.incomePaise ?? row.INCOMEPAISE ?? 0),
  };
}

