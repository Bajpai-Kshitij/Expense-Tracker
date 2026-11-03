import { describe, it, expect } from 'vitest';
import {
  monthRange,
  prevMonth,
  nextMonth,
  lastNMonths,
  currentMonthIST,
  currentDayIST,
  isFutureMonth,
  formatMonthLabel,
  percentChange,
  buildCategoryBreakdown,
  buildTrend,
  buildDailySeries,
  projectMonthEnd,
  buildInsights,
} from './index.js';

describe('months pure utilities', () => {
  it('computes monthRange correctly for standard and leap year months', () => {
    // Feb 2024 is a leap year (29 days)
    const feb2024 = monthRange('2024-02');
    expect(feb2024).toEqual({ from: '2024-02-01', to: '2024-02-29', days: 29 });

    // Feb 2025 is non-leap (28 days)
    const feb2025 = monthRange('2025-02');
    expect(feb2025).toEqual({ from: '2025-02-01', to: '2025-02-28', days: 28 });

    // Apr (30 days)
    const apr2026 = monthRange('2026-04');
    expect(apr2026).toEqual({ from: '2026-04-01', to: '2026-04-30', days: 30 });

    // Oct (31 days)
    const oct2026 = monthRange('2026-10');
    expect(oct2026).toEqual({ from: '2026-10-01', to: '2026-10-31', days: 31 });
  });

  it('throws on invalid month string in monthRange', () => {
    expect(() => monthRange('invalid')).toThrow(/Invalid month format/);
    expect(() => monthRange('')).toThrow(/Invalid month format/);
    expect(() => monthRange(null)).toThrow(/Invalid month format/);
  });

  it('computes prevMonth and nextMonth crossing year boundaries', () => {
    expect(prevMonth('2026-01')).toBe('2025-12');
    expect(prevMonth('2026-10')).toBe('2026-09');

    expect(nextMonth('2025-12')).toBe('2026-01');
    expect(nextMonth('2026-09')).toBe('2026-10');
  });

  it('computes lastNMonths in chronological order', () => {
    const last6 = lastNMonths('2026-10', 6);
    expect(last6).toEqual([
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
      '2026-10',
    ]);

    const last3 = lastNMonths('2026-01', 3);
    expect(last3).toEqual(['2025-11', '2025-12', '2026-01']);
  });

  it('determines currentMonthIST and currentDayIST correctly across UTC midnight', () => {
    // 2026-10-31 20:00 UTC = 2026-11-01 01:30 IST
    const date1 = new Date('2026-10-31T20:00:00Z');
    expect(currentMonthIST(date1)).toBe('2026-11');
    expect(currentDayIST(date1)).toBe(1);

    // 2026-10-31 18:00 UTC = 2026-10-31 23:30 IST
    const date2 = new Date('2026-10-31T18:00:00Z');
    expect(currentMonthIST(date2)).toBe('2026-10');
    expect(currentDayIST(date2)).toBe(31);
  });

  it('checks isFutureMonth correctly', () => {
    const fixedNow = new Date('2026-10-15T12:00:00Z');
    expect(isFutureMonth('2026-11', fixedNow)).toBe(true);
    expect(isFutureMonth('2026-10', fixedNow)).toBe(false);
    expect(isFutureMonth('2026-09', fixedNow)).toBe(false);
  });

  it('formats month labels correctly', () => {
    expect(formatMonthLabel('2026-10')).toBe('Oct 2026');
    expect(formatMonthLabel('2025-01')).toBe('Jan 2025');
    expect(formatMonthLabel('')).toBe('');
    expect(formatMonthLabel('invalid')).toBe('invalid');
  });
});

describe('compare - percentChange', () => {
  it('returns null for zero or negative previousPaise or negative currentPaise', () => {
    expect(percentChange(10000, 0)).toBeNull();
    expect(percentChange(10000, -5000)).toBeNull();
    expect(percentChange(-1000, 10000)).toBeNull();
    expect(percentChange(null, 1000)).toBeNull();
    expect(percentChange(1000, undefined)).toBeNull();
  });

  it('returns no change when diff is 0 or rounds to 0%', () => {
    expect(percentChange(10000, 10000)).toEqual({
      bps: 0,
      direction: 'same',
      label: 'no change',
    });

    // diff of 20 on 100000 is 0.02% (2 bps), rounds to 0% -> "no change"
    expect(percentChange(100020, 100000)).toEqual({
      bps: 2,
      direction: 'same',
      label: 'no change',
    });
  });

  it('calculates positive and negative percentage changes with integer math', () => {
    // 11200 vs 10000 -> +12% (+1200 bps)
    const up = percentChange(11200, 10000);
    expect(up).toEqual({
      bps: 1200,
      direction: 'up',
      label: '+12%',
    });

    // 9500 vs 10000 -> -5% (-500 bps)
    const down = percentChange(9500, 10000);
    expect(down).toEqual({
      bps: -500,
      direction: 'down',
      label: '-5%',
    });

    // Rounds half away from zero: 1055 vs 1000 = +5.5% (550 bps) -> +6%
    const roundUp = percentChange(1055, 1000);
    expect(roundUp.label).toBe('+6%');
  });
});

describe('breakdown - buildCategoryBreakdown', () => {
  const categories = [
    { id: 'cat-groceries', name: 'Groceries' },
    { id: 'cat-dining', name: 'Dining' },
    { id: 'cat-utilities', name: 'Utilities' },
    { id: 'cat-travel', name: 'Travel' },
    { id: 'cat-shopping', name: 'Shopping' },
    { id: 'cat-fuel', name: 'Fuel' },
    { id: 'cat-health', name: 'Health' },
    { id: 'cat-ent', name: 'Entertainment' },
    { id: 'cat-misc', name: 'Misc' },
  ];

  it('returns empty array on empty or invalid rows', () => {
    expect(buildCategoryBreakdown([])).toEqual([]);
    expect(buildCategoryBreakdown(null)).toEqual([]);
    expect(buildCategoryBreakdown(undefined)).toEqual([]);
  });

  it('sorts by netPaise descending and assigns names from categories list', () => {
    const rows = [
      { categoryId: 'cat-dining', netPaise: 20000, count: 2 },
      { categoryId: 'cat-groceries', netPaise: 50000, count: 5 },
      { categoryId: 'cat-utilities', netPaise: 30000, count: 1 },
    ];

    const result = buildCategoryBreakdown(rows, categories);
    expect(result.map((r) => r.name)).toEqual(['Groceries', 'Utilities', 'Dining']);
    expect(result.map((r) => r.netPaise)).toEqual([50000, 30000, 20000]);

    // Total positive = 100000. Shares: 5000 bps (50%), 3000 bps (30%), 2000 bps (20%)
    expect(result.map((r) => r.shareBps)).toEqual([5000, 3000, 2000]);
    const totalShare = result.reduce((acc, r) => acc + r.shareBps, 0);
    expect(totalShare).toBe(10000);
  });

  it('keeps Uncategorized separate and never merges it into Other', () => {
    const rows = [
      { categoryId: 'c1', netPaise: 10000, count: 1, name: 'C1' },
      { categoryId: 'c2', netPaise: 9000, count: 1, name: 'C2' },
      { categoryId: 'c3', netPaise: 8000, count: 1, name: 'C3' },
      { categoryId: 'c4', netPaise: 7000, count: 1, name: 'C4' },
      { categoryId: null, netPaise: 2500, count: 1 }, // Uncategorized
    ];

    const result = buildCategoryBreakdown(rows, [], { topN: 2 });
    // topN = 2 leaves c1, c2, and merges c3, c4 into Other (2 categories)
    // Uncategorized is still separate with id: null
    const uncat = result.find((r) => r.id === null);
    expect(uncat).toBeDefined();
    expect(uncat.name).toBe('Uncategorized');
    expect(uncat.netPaise).toBe(2500);

    const other = result.find((r) => r.id === 'other_merged');
    expect(other).toBeDefined();
    expect(other.name).toBe('Other (2 categories)');
    expect(other.netPaise).toBe(15000);
  });

  it('handles negative net spend as refund rows', () => {
    const rows = [
      { categoryId: 'cat-groceries', netPaise: 10000, count: 2 },
      { categoryId: 'cat-travel', netPaise: -2000, count: 1 }, // Refund only
    ];

    const result = buildCategoryBreakdown(rows, categories);
    const refundCat = result.find((r) => r.id === 'cat-travel');
    expect(refundCat.netPaise).toBe(-2000);
    expect(refundCat.isRefund).toBe(true);
    expect(refundCat.label).toBe('refunds');
    expect(refundCat.shareBps).toBe(0);
  });

  it('preserves names of archived categories if provided in rows', () => {
    const rows = [
      { categoryId: 'archived-old', name: 'Old Gym', netPaise: 5000, count: 1 },
    ];
    const result = buildCategoryBreakdown(rows, []);
    expect(result[0].name).toBe('Old Gym');
  });

  it('fuzz testing: 200 random inputs produce valid outputs without throwing', () => {
    for (let i = 0; i < 200; i++) {
      const rowCount = Math.floor(Math.random() * 20);
      const rows = [];
      for (let j = 0; j < rowCount; j++) {
        const netPaise = Math.floor(Math.random() * 200000) - 20000;
        const count = Math.floor(Math.random() * 10) + 1;
        const categoryId = Math.random() < 0.2 ? null : `cat-${j}`;
        rows.push({ categoryId, netPaise, count });
      }

      const topN = Math.floor(Math.random() * 8) + 1;
      const res = buildCategoryBreakdown(rows, categories, { topN });
      expect(Array.isArray(res)).toBe(true);

      const positiveRows = res.filter((r) => r.netPaise > 0);
      if (positiveRows.length > 0) {
        const sumBps = positiveRows.reduce((acc, r) => acc + r.shareBps, 0);
        expect(Math.abs(10000 - sumBps)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('trend - buildTrend', () => {
  it('zero-fills missing months and calculates max and average', () => {
    const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
    const monthRows = [
      { month: '2026-05', netPaise: 50000, fixedPaise: 10000 },
      { month: '2026-07', netPaise: 70000, fixedPaise: 10000 },
      { month: '2026-09', netPaise: 90000, fixedPaise: 10000 },
      { month: '2026-10', netPaise: 40000, fixedPaise: 5000 }, // Incomplete current month
    ];

    // Mock now as mid-Oct 2026
    const fixedNow = new Date('2026-10-15T12:00:00Z');
    const trend = buildTrend(monthRows, months, { now: fixedNow });

    expect(trend.points.length).toBe(6);
    expect(trend.points[1]).toEqual({ month: '2026-06', netPaise: 0, fixedPaise: 0 }); // Zero-filled
    expect(trend.points[3]).toEqual({ month: '2026-08', netPaise: 0, fixedPaise: 0 }); // Zero-filled

    expect(trend.maxPaise).toBe(90000);

    // Average should be over complete months only: May (50k), Jun (0), Jul (70k), Aug (0), Sep (90k)
    // 5 complete months: (50000 + 0 + 70000 + 0 + 90000) / 5 = 210000 / 5 = 42000
    expect(trend.averagePaise).toBe(42000);
  });

  it('fuzz testing: 200 random inputs for trend do not throw and remain consistent', () => {
    const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
    for (let i = 0; i < 200; i++) {
      const monthRows = months
        .filter(() => Math.random() > 0.3)
        .map((m) => ({
          month: m,
          netPaise: Math.floor(Math.random() * 500000),
          fixedPaise: Math.floor(Math.random() * 50000),
        }));

      const res = buildTrend(monthRows, months);
      expect(res.points.length).toBe(6);
      expect(typeof res.maxPaise).toBe('number');
      expect(typeof res.averagePaise).toBe('number');
      expect(res.maxPaise).toBeGreaterThanOrEqual(0);
      expect(res.averagePaise).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('daily - buildDailySeries and projectMonthEnd', () => {
  it('buildDailySeries generates an entry for every day of the month', () => {
    const dayRows = [
      { date: '2026-02-05', netPaise: 12000 },
      { date: '2026-02-10', netPaise: 35000 },
    ];
    // Non-leap Feb 2025 has 28 days
    const { days, maxPaise } = buildDailySeries(dayRows, '2025-02');
    expect(days.length).toBe(28);
    expect(days[0]).toEqual({ date: '2025-02-01', day: 1, netPaise: 0 });
    expect(maxPaise).toBe(0); // None of the rows matched 2025-02

    // Leap Feb 2024 has 29 days
    const leap = buildDailySeries([{ date: '2024-02-29', netPaise: 50000 }], '2024-02');
    expect(leap.days.length).toBe(29);
    expect(leap.days[28]).toEqual({ date: '2024-02-29', day: 29, netPaise: 50000 });
    expect(leap.maxPaise).toBe(50000);
  });

  it('projectMonthEnd returns null for past, future, or day 1', () => {
    // Current IST is 2026-10-15
    const midOct = new Date('2026-10-15T12:00:00Z');

    // Past month
    expect(projectMonthEnd({ ym: '2026-09', netSoFarPaise: 50000, today: midOct })).toBeNull();
    // Future month
    expect(projectMonthEnd({ ym: '2026-11', netSoFarPaise: 50000, today: midOct })).toBeNull();

    // Day 1
    const day1Oct = new Date('2026-10-01T12:00:00Z');
    expect(projectMonthEnd({ ym: '2026-10', netSoFarPaise: 5000, today: day1Oct })).toBeNull();
  });

  it('projectMonthEnd computes integer projection for mid-month', () => {
    // Day 10 of Oct (31 days). Spend so far: 10,000 paise
    // Projection = round((10000 * 31) / 10) = 31000 paise
    const day10Oct = new Date('2026-10-10T12:00:00Z');
    const projection = projectMonthEnd({
      ym: '2026-10',
      netSoFarPaise: 10000,
      today: day10Oct,
    });

    expect(projection).toEqual({
      projectedPaise: 31000,
      daysElapsed: 10,
      daysInMonth: 31,
      isEstimate: true,
    });
  });
});

describe('insights - buildInsights', () => {
  it('generates up to 5 plain-text descriptive insights according to rules', () => {
    const data = {
      breakdown: [
        { id: 'cat-groceries', name: 'Groceries', netPaise: 60000, count: 6, shareBps: 6000 },
        { id: 'cat-dining', name: 'Dining', netPaise: 30000, count: 2, shareBps: 3000 },
        { id: null, name: 'Uncategorized', netPaise: 10000, count: 2, shareBps: 1000 },
      ],
      prevBreakdown: [
        { id: 'cat-groceries', name: 'Groceries', netPaise: 40000 }, // diff: +20000 (below ₹1,000 increase)
        { id: 'cat-dining', name: 'Dining', netPaise: 5000 }, // diff: +25000 (₹250.00, below ₹1000 threshold)
      ],
      dailySeries: {
        days: [
          { date: '2026-10-01', netPaise: 1000 },
          { date: '2026-10-05', netPaise: 50000 }, // 50000 > 3 * (100000/30 = 3333) = 9999
        ],
      },
      netPaise: 100000,
      fixedPaise: 25000,
      totalCount: 10, // Uncategorized is 2/10 = 20% >= 10%
      daysInMonth: 30,
    };

    const lines = buildInsights(data);
    expect(lines).toContain('Biggest spend was Groceries (60% of total)');
    expect(lines).toContain('2 expenses (₹100.00) are uncategorized');
    expect(lines).toContain('High spend of ₹500.00 on 5 Oct 2026');
    expect(lines).toContain('Fixed payments this month: ₹250.00');
    expect(lines.length).toBeLessThanOrEqual(5);
  });

  it('detects largest category increase >= ₹1,000 (100,000 paise)', () => {
    const data = {
      breakdown: [
        { id: 'c1', name: 'Gadgets', netPaise: 250000, shareBps: 10000 },
      ],
      prevBreakdown: [
        { id: 'c1', name: 'Gadgets', netPaise: 50000 }, // diff = 200,000 paise = ₹2,000
      ],
      netPaise: 250000,
      daysInMonth: 30,
    };

    const lines = buildInsights(data);
    expect(lines).toContain('Gadgets increased by ₹2,000.00 vs last month');
  });
});
