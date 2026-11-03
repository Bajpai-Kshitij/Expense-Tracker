/**
 * Pure insight generation with fixed descriptive wording.
 * No advice, judgments, or unsolicited predictions.
 */

import { formatPaise } from '../format/money.js';
import { formatDateDisplay } from '../format/dates.js';

/**
 * Generates up to 5 plain-text insight lines from report data.
 * 
 * Rules:
 * 1. Biggest category and its share: "Biggest spend was <category> (<N>% of total)"
 * 2. Category with largest increase vs last month (if both have data and increase >= ₹1,000):
 *    "<category> increased by <₹X> vs last month"
 * 3. Uncategorized share when at least 10% of count:
 *    "<N> expenses (<₹X>) are uncategorized"
 * 4. A day with spend above 3x daily average:
 *    "High spend of <₹X> on <date>"
 * 5. Fixed payments this month:
 *    "Fixed payments this month: <₹X>"
 * 
 * @param {object} data
 * @param {Array<object>} [data.breakdown] Category breakdown rows
 * @param {Array<object>} [data.prevBreakdown] Previous month category breakdown rows
 * @param {object} [data.dailySeries] Daily series { days: [...] }
 * @param {number} [data.netPaise] Total net spend for the month
 * @param {number} [data.fixedPaise] Fixed payments for the month
 * @param {number} [data.totalCount] Total count of expenses for the month
 * @param {number} [data.daysInMonth] Number of days in the month
 * @returns {string[]} Up to 5 insight strings
 */
export function buildInsights(data = {}) {
  const insights = [];
  const {
    breakdown = [],
    prevBreakdown = [],
    dailySeries = null,
    netPaise = 0,
    fixedPaise = 0,
    totalCount = 0,
    daysInMonth = 30,
  } = data;

  // 1. Biggest category and its share
  const positiveCategories = breakdown.filter((c) => c && c.netPaise > 0);
  if (positiveCategories.length > 0) {
    const topCat = positiveCategories[0]; // Already sorted descending
    const sharePercent = Math.round(topCat.shareBps / 100);
    if (sharePercent > 0) {
      insights.push(`Biggest spend was ${topCat.name} (${sharePercent}% of total)`);
    }
  }

  // 2. Category with largest increase vs last month (min ₹1,000 = 100,000 paise increase)
  if (breakdown.length > 0 && prevBreakdown.length > 0) {
    const prevMap = new Map();
    for (const p of prevBreakdown) {
      if (p && p.id !== undefined) {
        prevMap.set(p.id, p.netPaise);
      }
    }

    let maxIncrease = 0;
    let maxIncreaseCat = null;

    for (const curr of breakdown) {
      if (curr && curr.id !== undefined && prevMap.has(curr.id)) {
        const prevNet = prevMap.get(curr.id) || 0;
        const diff = curr.netPaise - prevNet;
        if (diff > maxIncrease && diff >= 100000) {
          maxIncrease = diff;
          maxIncreaseCat = curr;
        }
      }
    }

    if (maxIncreaseCat) {
      insights.push(
        `${maxIncreaseCat.name} increased by ${formatPaise(maxIncrease)} vs last month`
      );
    }
  }

  // 3. Uncategorized share when at least 10% of total count
  const uncatRow = breakdown.find((c) => c && c.id === null);
  if (uncatRow && uncatRow.count > 0 && totalCount > 0) {
    const uncatCountPercent = Math.round((uncatRow.count * 100) / totalCount);
    if (uncatCountPercent >= 10) {
      insights.push(
        `${uncatRow.count} expenses (${formatPaise(uncatRow.netPaise)}) are uncategorized`
      );
    }
  }

  // 4. A day with spend above 3x daily average
  if (dailySeries && Array.isArray(dailySeries.days) && netPaise > 0 && daysInMonth > 0) {
    const dailyAvg = Math.floor(netPaise / daysInMonth);
    const spikeThreshold = 3 * dailyAvg;

    let highestDay = null;
    let highestNet = 0;

    for (const d of dailySeries.days) {
      if (d && d.netPaise > spikeThreshold && d.netPaise > highestNet) {
        highestNet = d.netPaise;
        highestDay = d;
      }
    }

    if (highestDay) {
      const dateLabel = formatDateDisplay(highestDay.date) || highestDay.date;
      insights.push(`High spend of ${formatPaise(highestDay.netPaise)} on ${dateLabel}`);
    }
  }

  // 5. Fixed payments this month
  if (typeof fixedPaise === 'number' && fixedPaise > 0) {
    insights.push(`Fixed payments this month: ${formatPaise(fixedPaise)}`);
  }

  return insights.slice(0, 5);
}

