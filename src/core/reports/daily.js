/**
 * Daily series and month-end projection logic with integer arithmetic.
 */

import { monthRange, currentMonthIST, currentDayIST } from './months.js';

/**
 * Builds daily net spend series for every day of the given month.
 * 
 * @param {Array<{ date: string, netPaise: number }>} dayRows
 * @param {string} ym "YYYY-MM"
 * @returns {{ days: Array<{ date: string, day: number, netPaise: number }>, maxPaise: number }}
 */
export function buildDailySeries(dayRows = [], ym) {
  const { days: totalDays } = monthRange(ym);
  const rowMap = new Map();

  if (Array.isArray(dayRows)) {
    for (const r of dayRows) {
      if (r && r.date) {
        rowMap.set(r.date, Number(r.netPaise || 0));
      }
    }
  }

  const days = [];
  let maxPaise = 0;

  for (let d = 1; d <= totalDays; d++) {
    const dayStr = String(d).padStart(2, '0');
    const dateStr = `${ym}-${dayStr}`;
    const net = rowMap.get(dateStr) || 0;

    days.push({
      date: dateStr,
      day: d,
      netPaise: net,
    });

    if (net > maxPaise) {
      maxPaise = net;
    }
  }

  return { days, maxPaise };
}

/**
 * Projects month-end spending based on progress so far.
 * 
 * Rules:
 * - Returns null for past months, future months, or day 1.
 * - Uses integer arithmetic.
 * - Always includes isEstimate: true.
 * 
 * @param {object} params
 * @param {string} params.ym "YYYY-MM"
 * @param {number} params.netSoFarPaise Total net spend up to today
 * @param {Date|number} [params.today=new Date()]
 * @returns {{ projectedPaise: number, daysElapsed: number, daysInMonth: number, isEstimate: true } | null}
 */
export function projectMonthEnd({ ym, netSoFarPaise, today = new Date() }) {
  if (!ym || typeof netSoFarPaise !== 'number') {
    return null;
  }

  const currentYm = currentMonthIST(today);
  // Only project for the active, current month (not past or future)
  if (ym !== currentYm) {
    return null;
  }

  const daysElapsed = currentDayIST(today);
  // Day 1 has insufficient elapsed history for projection
  if (daysElapsed <= 1) {
    return null;
  }

  const { days: daysInMonth } = monthRange(ym);

  if (netSoFarPaise <= 0) {
    return {
      projectedPaise: 0,
      daysElapsed,
      daysInMonth,
      isEstimate: true,
    };
  }

  // Integer math projection: (netSoFar * daysInMonth) / daysElapsed
  const projectedPaise = Math.round((netSoFarPaise * daysInMonth) / daysElapsed);

  return {
    projectedPaise,
    daysElapsed,
    daysInMonth,
    isEstimate: true,
  };
}

