/**
 * EMI & Loan plans builder and active tracking.
 * Pure business logic for aggregating and projecting active EMI plans.
 */

const FORTY_FIVE_DAYS_MS = 45 * 24 * 60 * 60 * 1000;

/**
 * Groups active fixed expenses by emiPlanKey and extracts latest installment state.
 *
 * @param {Array<object>} expenses - List of expenses.
 * @param {Date|number|string} [now=new Date()] - Reference timestamp.
 * @returns {Array<object> & { plans: Array<object>, monthlyCommitmentPaise: number }}
 */
export function buildEmiPlans(expenses = [], now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now);

  if (!Array.isArray(expenses) || expenses.length === 0) {
    const emptyResult = [];
    emptyResult.plans = [];
    emptyResult.monthlyCommitmentPaise = 0;
    return emptyResult;
  }

  // 1. Group active fixed expenses by emiPlanKey
  const groups = new Map();
  for (const exp of expenses) {
    if (!exp || exp.deleted || exp.status === 'deleted') continue;
    if (exp.kind !== 'fixed') continue;
    const planKey = exp.emiPlanKey || exp.emi_plan_key;
    if (!planKey) continue;

    if (!groups.has(planKey)) {
      groups.set(planKey, []);
    }
    groups.get(planKey).push(exp);
  }

  const activePlans = [];

  for (const [planKey, groupExpenses] of groups.entries()) {
    // For each plan take the latest installment (highest emiNo)
    let latestExp = null;
    let maxEmiNo = -1;

    for (const exp of groupExpenses) {
      const emiNo = exp.emiNo ?? exp.emi_no ?? 0;
      if (emiNo > maxEmiNo) {
        maxEmiNo = emiNo;
        latestExp = exp;
      } else if (emiNo === maxEmiNo && latestExp) {
        const currDate = exp.date || '';
        const prevDate = latestExp.date || '';
        if (currDate > prevDate) {
          latestExp = exp;
        }
      }
    }

    if (!latestExp) continue;

    const emiNo = latestExp.emiNo ?? latestExp.emi_no ?? 0;
    const emiTotal = latestExp.emiTotal ?? latestExp.emi_total ?? 0;
    const monthlyPaise = latestExp.emiMonthlyPaise ?? latestExp.emi_monthly_paise ?? 0;
    const finishDate = latestExp.emiFinishDate ?? latestExp.emi_finish_date ?? null;
    const outstandingPaise = latestExp.emiOutstandingPaise ?? latestExp.emi_outstanding_paise ?? 0;
    const remaining = emiTotal - emiNo;
    const lastDate = latestExp.date || null;

    // Clean merchant name
    let merchant = latestExp.merchant || latestExp.merchantRaw || latestExp.merchant_raw || '';
    const markerMatch = merchant.match(/<\d+\/\d+>(.*)$/);
    if (markerMatch) {
      merchant = markerMatch[1].trim();
    } else {
      merchant = merchant.replace(/^(?:Interest|Principal)\s+Amount\s+Amortization\s*-\s*/i, '').trim();
    }
    if (merchant.endsWith(' IN')) {
      const words = merchant.split(/\s+/);
      if (words.length >= 4) {
        merchant = merchant.slice(0, -3).trim();
      }
    }

    // A plan is active when remaining > 0 and the last installment is within 45 days of now
    if (remaining <= 0) continue;

    if (lastDate) {
      const lastDateMs = Date.parse(lastDate);
      if (!isNaN(lastDateMs)) {
        const diffMs = nowMs - lastDateMs;
        if (diffMs > FORTY_FIVE_DAYS_MS || diffMs < -FORTY_FIVE_DAYS_MS) {
          continue; // Stale plan or too far in future
        }
      }
    }

    activePlans.push({
      planKey,
      merchant,
      emiNo,
      emiTotal,
      monthlyPaise,
      remaining,
      finishDate,
      outstandingPaise,
      lastDate,
    });
  }

  // Sort plans by finishDate or planKey
  activePlans.sort((a, b) => (a.finishDate || '').localeCompare(b.finishDate || ''));

  const monthlyCommitmentPaise = activePlans.reduce((sum, p) => sum + (p.monthlyPaise || 0), 0);

  activePlans.plans = activePlans;
  activePlans.monthlyCommitmentPaise = monthlyCommitmentPaise;

  return activePlans;
}
