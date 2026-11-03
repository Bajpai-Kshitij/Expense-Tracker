/**
 * Multi-month trend calculations with integer arithmetic.
 */

import { currentMonthIST } from './months.js';

/**
 * Builds trend series from monthly rows and requested month list.
 * Fills missing months with zeros.
 * Computes average over complete past months (excluding current month).
 * 
 * @param {Array<{ month: string, netPaise: number, fixedPaise: number }>} monthRows
 * @param {string[]} months Array of "YYYY-MM" strings in chronological order
 * @param {object} [options={}]
 * @param {Date|number} [options.now=new Date()]
 * @returns {{ points: Array<{ month: string, netPaise: number, fixedPaise: number }>, maxPaise: number, averagePaise: number }}
 */
export function buildTrend(monthRows = [], months = [], { now = new Date() } = {}) {
  const safeMonths = Array.isArray(months) ? months : [];
  const rowMap = new Map();

  if (Array.isArray(monthRows)) {
    for (const r of monthRows) {
      if (r && r.month) {
        rowMap.set(r.month, {
          netPaise: Number(r.netPaise || 0),
          fixedPaise: Number(r.fixedPaise || 0),
        });
      }
    }
  }

  const currentYm = currentMonthIST(now);
  const points = [];
  let maxPaise = 0;

  for (const m of safeMonths) {
    const data = rowMap.get(m) || { netPaise: 0, fixedPaise: 0 };
    points.push({
      month: m,
      netPaise: data.netPaise,
      fixedPaise: data.fixedPaise,
    });
    if (data.netPaise > maxPaise) {
      maxPaise = data.netPaise;
    }
  }

  // Compute average over complete months (excluding current incomplete month)
  const completePoints = points.filter((p) => p.month < currentYm);

  let averagePaise = 0;
  if (completePoints.length > 0) {
    const totalComplete = completePoints.reduce((acc, p) => acc + p.netPaise, 0);
    averagePaise = Math.round(totalComplete / completePoints.length);
  }

  return {
    points,
    maxPaise,
    averagePaise,
  };
}

