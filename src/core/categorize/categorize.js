import { compilePattern } from './pattern.js';

function getCategory(categories, id) {
  if (!categories || !id) return null;
  if (categories instanceof Map) {
    return categories.get(id) || null;
  }
  if (Array.isArray(categories)) {
    return categories.find((c) => (c.id === id || c.categoryId === id)) || null;
  }
  return categories[id] || null;
}

function priorityComparator(a, b) {
  const prioA = typeof a.priority === 'number' ? a.priority : 100;
  const prioB = typeof b.priority === 'number' ? b.priority : 100;
  if (prioA !== prioB) {
    return prioA - prioB;
  }
  return String(a.id || '').localeCompare(String(b.id || ''));
}

/**
 * Categorizes an expense based on active brands and rules.
 * 
 * Order of evaluation:
 * (a) Brand map: First active brand matching merchantRaw sets brand name.
 * (b) Rules: First active rule matching field, account, direction, amount range,
 *     and valid non-archived category sets categoryId and optionally kind.
 * (c) If no rule matched, fallback to brand's categoryId if valid and not archived.
 * (d) Otherwise categoryId = null.
 * 
 * @param {object} input - Expense input { merchantRaw, note, rawText, accountId, direction, amountPaise, brand }.
 * @param {object} context - Context containing brands, rules, accounts, and categories.
 * @returns {{ brand: string|null, categoryId: string|null, kind: string|null, matchedBrandId: string|null, matchedRuleId: string|null }}
 */
export function categorize(input = {}, context = {}) {
  const merchantRaw = String(input.merchantRaw || input.merchant || '').slice(0, 200);
  const note = String(input.note || '').slice(0, 200);
  const rawText = input.rawText !== undefined ? String(input.rawText).slice(0, 200) : null;
  const accountId = input.accountId || null;
  const direction = input.direction || null;
  const amountPaise = typeof input.amountPaise === 'number'
    ? input.amountPaise
    : (typeof input.amount_paise === 'number' ? input.amount_paise : null);

  const rawBrands = Array.isArray(context.brands)
    ? context.brands
    : Object.values(context.brands || {});
  const rawRules = Array.isArray(context.rules)
    ? context.rules
    : Object.values(context.rules || {});

  const activeBrands = rawBrands.filter((b) => b && b.active !== false).sort(priorityComparator);
  const activeRules = rawRules.filter((r) => r && r.active !== false).sort(priorityComparator);

  let brandName = input.brand || null;
  let matchedBrandId = null;
  let matchedBrand = null;

  // Step (a): Brand matching
  for (const b of activeBrands) {
    if (!b.pattern) continue;
    const compiled = compilePattern({ pattern: b.pattern, mode: b.mode || 'words' });
    if (compiled.ok && compiled.regex.test(merchantRaw)) {
      brandName = b.name;
      matchedBrandId = b.id;
      matchedBrand = b;
      break;
    }
  }

  let categoryId = null;
  let kind = null;
  let matchedRuleId = null;

  // Step (b): Rules matching
  for (const r of activeRules) {
    if (!r.pattern) continue;

    // Field text selection
    let fieldText = '';
    const field = r.field || 'merchant';

    if (field === 'merchant') {
      fieldText = merchantRaw;
    } else if (field === 'brand') {
      fieldText = brandName || '';
    } else if (field === 'rawText') {
      if (rawText === null) {
        // rawText is absent; rule does not match
        continue;
      }
      fieldText = rawText;
    } else if (field === 'note') {
      fieldText = note;
    }

    const compiled = compilePattern({ pattern: r.pattern, mode: r.mode || 'words' });
    if (!compiled.ok || !compiled.regex.test(fieldText)) {
      continue;
    }

    // Condition: accountId
    if (r.accountId && r.accountId !== accountId) {
      continue;
    }

    // Condition: direction
    if (r.direction && r.direction !== direction) {
      continue;
    }

    // Condition: minPaise
    if (r.minPaise != null && (amountPaise == null || amountPaise < r.minPaise)) {
      continue;
    }

    // Condition: maxPaise
    if (r.maxPaise != null && (amountPaise == null || amountPaise > r.maxPaise)) {
      continue;
    }

    // Target category check: skipped if missing or archived
    const targetCat = getCategory(context.categories, r.categoryId);
    if (!targetCat || targetCat.archived) {
      continue;
    }

    // Rule matched! First match wins
    categoryId = r.categoryId;
    kind = r.kind || null;
    matchedRuleId = r.id;
    break;
  }

  // Step (c): Fallback to brand's category if no rule matched
  if (!categoryId && matchedBrand && matchedBrand.categoryId) {
    const brandCat = getCategory(context.categories, matchedBrand.categoryId);
    if (brandCat && !brandCat.archived) {
      categoryId = matchedBrand.categoryId;
      if (!kind && matchedBrand.kind) {
        kind = matchedBrand.kind;
      }
    }
  }

  return {
    brand: brandName,
    categoryId,
    kind,
    matchedBrandId,
    matchedRuleId,
  };
}

/**
 * Finds all active, uncategorized, and unlocked expenses matching a suggested rule pattern.
 * 
 * @param {object[]} expenses - Array of expense objects.
 * @param {{ pattern: string, mode: string }} suggestedRule - Suggested rule definition.
 * @param {object} [context={}] - Evaluation context.
 * @returns {string[]} Array of matching expense IDs.
 */
export function findSimilar(expenses = [], suggestedRule = {}, context = {}) {
  if (!suggestedRule || !suggestedRule.pattern) {
    return [];
  }

  const compiled = compilePattern({
    pattern: suggestedRule.pattern,
    mode: suggestedRule.mode || 'words',
  });
  if (!compiled.ok) {
    return [];
  }

  const matchingIds = [];

  for (const exp of expenses) {
    if (!exp) continue;

    // Must be active
    const isDeleted = exp.status === 'deleted' || Boolean(exp.deleted);
    if (isDeleted) continue;

    // Must be uncategorized
    const hasCategory = exp.category_id !== null && exp.category_id !== undefined && exp.category_id !== '';
    if (hasCategory) continue;

    // Must not be locked
    const isLocked = Boolean(exp.category_locked);
    if (isLocked) continue;

    const merchantRaw = String(exp.merchant_raw || exp.merchant || '').slice(0, 200);
    if (compiled.regex.test(merchantRaw)) {
      matchingIds.push(exp.id);
    }
  }

  return matchingIds;
}

/**
 * Computes patches to categorize active, unlocked, uncategorized expenses.
 * Never modifies locked or already categorized expenses.
 * Pure and idempotent: running twice yields zero updates.
 * 
 * @param {object[]} expenses - List of all expenses.
 * @param {object} context - { brands, rules, accounts, categories }.
 * @returns {{ updates: Array<{ expenseId: string, patch: object }>, summary: { totalChecked: number, updatedCount: number } }}
 */
export function planReapply(expenses = [], context = {}) {
  const updates = [];
  let totalChecked = 0;

  for (const exp of expenses) {
    if (!exp) continue;

    // Skip deleted
    const isDeleted = exp.status === 'deleted' || Boolean(exp.deleted);
    if (isDeleted) continue;

    // Never touch locked or already categorized expenses
    const isLocked = Boolean(exp.category_locked);
    const hasCategory = exp.category_id !== null && exp.category_id !== undefined && exp.category_id !== '';
    if (isLocked || hasCategory) {
      continue;
    }

    totalChecked++;

    const res = categorize(
      {
        merchantRaw: exp.merchant_raw,
        note: exp.note,
        accountId: exp.account_id,
        direction: exp.direction,
        amountPaise: exp.amount_paise,
        brand: exp.brand,
      },
      context
    );

    const patch = {};

    if (res.categoryId) {
      patch.category_id = res.categoryId;
      if (res.brand && res.brand !== exp.brand) {
        patch.brand = res.brand;
      }
      if (res.kind && res.kind !== exp.kind) {
        patch.kind = res.kind;
      }
      // Rule-applied categories are NOT locked
      updates.push({ expenseId: exp.id, patch });
    } else if (res.brand && !exp.brand) {
      // Fill missing brand if available
      patch.brand = res.brand;
      updates.push({ expenseId: exp.id, patch });
    }
  }

  return {
    updates,
    summary: {
      totalChecked,
      updatedCount: updates.length,
    },
  };
}

/**
 * Applies a plan of updates through LogWriter in a single batch call.
 * 
 * @param {object} options
 * @param {{ updates: Array<{ expenseId: string, patch: object }> }} options.plan - Plan with updates.
 * @param {object} options.writer - LogWriter instance.
 * @returns {Promise<object[]>} Array of written events.
 */
export async function applyPlan({ plan, writer } = {}) {
  if (!plan?.updates || plan.updates.length === 0 || !writer) {
    return [];
  }

  const eventList = plan.updates.map((item) => ({
    type: 'expense.updated',
    data: {
      expenseId: item.expenseId,
      patch: item.patch,
    },
  }));

  return writer.writeMany(eventList);
}

