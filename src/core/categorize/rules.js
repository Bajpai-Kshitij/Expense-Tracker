/**
 * Rule prioritization, ordering, and renumbering helpers.
 * Pure functions only; no external side effects.
 */

/**
 * Priority comparator sorting rules in current evaluation order.
 * Primary: priority ASC (lower numbers evaluate first).
 * Secondary: id ASC.
 */
export function rulePriorityComparator(a, b) {
  const prioA = typeof a?.priority === 'number' ? a.priority : 100;
  const prioB = typeof b?.priority === 'number' ? b.priority : 100;
  if (prioA !== prioB) {
    return prioA - prioB;
  }
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

/**
 * Checks if any two rules share a priority.
 * If so, renumbers all rules in current evaluation order with gaps of 10 (10, 20, 30...).
 * Returns only the rules whose priority changed (for writing rule.upserted).
 * Idempotent: returns [] if no duplicate priorities exist.
 *
 * @param {Array<object>} rules
 * @returns {Array<object>} Changed rules with new priorities
 */
export function planRenumberRules(rules = []) {
  if (!Array.isArray(rules) || rules.length <= 1) {
    return [];
  }

  const sorted = [...rules].sort(rulePriorityComparator);
  const seenPriorities = new Set();
  let hasDuplicate = false;

  for (const r of sorted) {
    const p = typeof r.priority === 'number' ? r.priority : 100;
    if (seenPriorities.has(p)) {
      hasDuplicate = true;
      break;
    }
    seenPriorities.add(p);
  }

  if (!hasDuplicate) {
    return [];
  }

  const changed = [];
  sorted.forEach((rule, idx) => {
    const newPriority = (idx + 1) * 10;
    if (rule.priority !== newPriority) {
      changed.push({
        ...rule,
        priority: newPriority,
      });
    }
  });

  return changed;
}

/**
 * Returns priority for a new rule: lowest existing priority minus 10.
 *
 * @param {Array<object>} rules
 * @returns {number}
 */
export function getNewRulePriority(rules = []) {
  if (!Array.isArray(rules) || rules.length === 0) {
    return 0;
  }

  const priorities = rules
    .map((r) => (typeof r.priority === 'number' ? r.priority : null))
    .filter((p) => p !== null);

  if (priorities.length === 0) {
    return 0;
  }

  const minPriority = Math.min(...priorities);
  return minPriority - 10;
}

/**
 * Swaps priorities between two neighbouring rules.
 *
 * @param {object} ruleA
 * @param {object} ruleB
 * @returns {[object, object]}
 */
export function swapRulePriorities(ruleA, ruleB) {
  const prioA = typeof ruleA.priority === 'number' ? ruleA.priority : 10;
  const prioB = typeof ruleB.priority === 'number' ? ruleB.priority : 10;

  if (prioA === prioB) {
    return [
      { ...ruleA, priority: prioB + 10 },
      { ...ruleB, priority: prioA },
    ];
  }

  return [
    { ...ruleA, priority: prioB },
    { ...ruleB, priority: prioA },
  ];
}

