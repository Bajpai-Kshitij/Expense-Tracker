/**
 * Category spending breakdown logic with integer arithmetic.
 */

/**
 * Builds a category breakdown from query rows and categories.
 * 
 * Rules:
 * - Sorted by netPaise descending.
 * - "Uncategorized" (id: null) is always its own row and never merged.
 * - Categories beyond topN are merged into "Other (N categories)".
 * - shareBps is the share of total positive spend in basis points (10000 = 100%).
 * - Rows with netPaise <= 0 have shareBps = 0, but refund-only categories are kept visible with a "refunds" label.
 * - Archived categories keep their names.
 * - Never throws on empty or malformed input.
 * 
 * @param {Array<{ categoryId: string|null, netPaise: number, count: number, name?: string }>} rows
 * @param {Array<object>|object} [categories=[]]
 * @param {object} [options={}]
 * @param {number} [options.topN=8]
 * @returns {Array<{ id: string|null, name: string, netPaise: number, count: number, shareBps: number, isRefund?: boolean, label?: string }>}
 */
export function buildCategoryBreakdown(rows = [], categories = [], { topN = 8 } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return [];
  }

  // Build categories lookup map
  const catMap = new Map();
  if (Array.isArray(categories)) {
    for (const c of categories) {
      if (c && c.id) {
        catMap.set(c.id, c.name || c.id);
      }
    }
  } else if (categories && typeof categories === 'object') {
    for (const [id, val] of Object.entries(categories)) {
      if (val && typeof val === 'object') {
        catMap.set(id, val.name || id);
      } else if (typeof val === 'string') {
        catMap.set(id, val);
      }
    }
  }

  let uncategorizedRow = null;
  const categorizedRows = [];

  for (const r of rows) {
    if (!r) continue;
    const cid = r.categoryId !== undefined ? r.categoryId : (r.id !== undefined ? r.id : null);
    const net = Number(r.netPaise || 0);
    const cnt = Number(r.count || 0);

    if (cid === null || cid === undefined || cid === 'uncategorized') {
      const existingNet = uncategorizedRow ? uncategorizedRow.netPaise : 0;
      const existingCnt = uncategorizedRow ? uncategorizedRow.count : 0;
      uncategorizedRow = {
        id: null,
        name: 'Uncategorized',
        netPaise: existingNet + net,
        count: existingCnt + cnt,
      };
    } else {
      const name = r.name || catMap.get(cid) || 'Archived Category';
      categorizedRows.push({
        id: cid,
        name,
        netPaise: net,
        count: cnt,
      });
    }
  }

  // Sort categorized rows by netPaise descending
  categorizedRows.sort((a, b) => b.netPaise - a.netPaise);

  let finalRows = [];
  const limit = typeof topN === 'number' && topN > 0 ? topN : 8;

  if (categorizedRows.length <= limit) {
    finalRows = [...categorizedRows];
  } else {
    const head = categorizedRows.slice(0, limit);
    const tail = categorizedRows.slice(limit);

    let tailNet = 0;
    let tailCount = 0;
    for (const t of tail) {
      tailNet += t.netPaise;
      tailCount += t.count;
    }

    finalRows = [
      ...head,
      {
        id: 'other_merged',
        name: `Other (${tail.length} categories)`,
        netPaise: tailNet,
        count: tailCount,
      },
    ];
  }

  // Insert uncategorized row if present
  if (uncategorizedRow && (uncategorizedRow.count > 0 || uncategorizedRow.netPaise !== 0)) {
    finalRows.push(uncategorizedRow);
  }

  // Sort all final rows by netPaise descending
  finalRows.sort((a, b) => b.netPaise - a.netPaise);

  // Compute total positive spend for shareBps
  let totalPositivePaise = 0;
  for (const r of finalRows) {
    if (r.netPaise > 0) {
      totalPositivePaise += r.netPaise;
    }
  }

  let largestPositiveIdx = -1;
  let largestNet = -1;
  let sumBps = 0;

  const result = finalRows.map((r, idx) => {
    let shareBps = 0;
    if (r.netPaise > 0 && totalPositivePaise > 0) {
      shareBps = Math.round((r.netPaise * 10000) / totalPositivePaise);
      sumBps += shareBps;
      if (r.netPaise > largestNet) {
        largestNet = r.netPaise;
        largestPositiveIdx = idx;
      }
    }

    const item = {
      id: r.id,
      name: r.name,
      netPaise: r.netPaise,
      count: r.count,
      shareBps,
    };

    if (r.netPaise < 0) {
      item.isRefund = true;
      item.label = 'refunds';
    }

    return item;
  });

  // Ensure positive rows sum within 1 basis point (adjust largest if needed)
  if (totalPositivePaise > 0 && largestPositiveIdx >= 0) {
    const diff = 10000 - sumBps;
    if (Math.abs(diff) <= 10) {
      result[largestPositiveIdx].shareBps += diff;
    }
  }

  return result;
}

