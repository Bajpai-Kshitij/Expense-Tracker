import { describe, it, expect } from 'vitest';
import { planRenumberRules, getNewRulePriority, swapRulePriorities } from './rules.js';

describe('BUG C - Rules prioritization and renumbering', () => {
  it('planRenumberRules detects duplicate priorities and renumbers with gaps of 10 in evaluation order', () => {
    const rules = [
      { id: 'r1', priority: 1, pattern: 'P1' },
      { id: 'r2', priority: 1, pattern: 'P2' },
      { id: 'r3', priority: 10, pattern: 'P3' },
    ];

    const updates = planRenumberRules(rules);
    expect(updates.length).toBeGreaterThan(0);
    const r1Up = updates.find((r) => r.id === 'r1');
    const r2Up = updates.find((r) => r.id === 'r2');
    const r3Up = updates.find((r) => r.id === 'r3');
    expect(r1Up.priority).toBe(10);
    expect(r2Up.priority).toBe(20);
    expect(r3Up.priority).toBe(30);

    // Idempotent: re-running on the renumbered list yields zero updates
    const updatedRules = rules.map((r) => updates.find((u) => u.id === r.id) || r);
    const secondPass = planRenumberRules(updatedRules);
    expect(secondPass).toEqual([]);
  });

  it('planRenumberRules returns empty array when all priorities are distinct', () => {
    const rules = [
      { id: 'r1', priority: 10, pattern: 'P1' },
      { id: 'r2', priority: 20, pattern: 'P2' },
      { id: 'r3', priority: 30, pattern: 'P3' },
    ];
    expect(planRenumberRules(rules)).toEqual([]);
  });

  it('getNewRulePriority returns lowest existing priority minus 10', () => {
    expect(getNewRulePriority([])).toBe(0);
    expect(getNewRulePriority([{ priority: 10 }, { priority: 20 }])).toBe(0);
    expect(getNewRulePriority([{ priority: 0 }, { priority: 10 }])).toBe(-10);
  });

  it('swapRulePriorities swaps neighbours priorities', () => {
    const ruleA = { id: 'r1', priority: 10 };
    const ruleB = { id: 'r2', priority: 20 };
    const [swappedA, swappedB] = swapRulePriorities(ruleA, ruleB);
    expect(swappedA.priority).toBe(20);
    expect(swappedB.priority).toBe(10);
  });
});

