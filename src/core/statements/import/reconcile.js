/**
 * Reconciles parsed transaction line totals against declared statement totals.
 *
 * @param {object} result - Output from parser
 * @param {object|null} result.declaredTotals - e.g. { purchasesPaise, creditsPaise, paymentsPaise, feesPaise }
 * @param {Array<object>} result.lines - Parsed statement lines
 * @returns {{ ok: boolean, differences: Array<{ field: string, declared: number, parsed: number, diff: number }> }}
 */
export function checkTotals(result) {
  if (!result || !result.declaredTotals) {
    if (result && Array.isArray(result.warnings) && result.warnings.length > 0) {
      return { ok: false, differences: [{ field: 'declaredTotals', declared: 0, parsed: 0, diff: 1 }] };
    }
    return { ok: true, differences: [] };
  }

  const { declaredTotals, lines = [] } = result;
  const differences = [];

  const sumLines = (predicate) =>
    lines.filter(predicate).reduce((acc, l) => acc + (l.amountPaise || 0), 0);

  // 1. Payments: sum of payment lines
  const declaredPayments = declaredTotals.payments ?? declaredTotals.paymentsPaise;
  if (declaredPayments !== undefined && declaredPayments !== null) {
    const parsedPayments = sumLines((l) => l.type === 'payment');
    const diff = Math.abs(parsedPayments - declaredPayments);
    if (diff > 0) {
      differences.push({
        field: declaredTotals.payments !== undefined ? 'payments' : 'paymentsPaise',
        declared: declaredPayments,
        parsed: parsedPayments,
        diff,
      });
    }
  }

  // 2. Credits:
  // If Axis format (declaredTotals.credits exists): sum of refund and cashback lines
  // If TestBank format (declaredTotals.creditsPaise exists): sum of all credit lines
  const declaredCredits = declaredTotals.credits ?? declaredTotals.creditsPaise;
  if (declaredCredits !== undefined && declaredCredits !== null) {
    const parsedCredits =
      declaredTotals.credits !== undefined
        ? sumLines((l) => l.type === 'refund' || l.type === 'cashback')
        : sumLines((l) => l.direction === 'credit');

    const diff = Math.abs(parsedCredits - declaredCredits);
    if (diff > 0) {
      differences.push({
        field: declaredTotals.credits !== undefined ? 'credits' : 'creditsPaise',
        declared: declaredCredits,
        parsed: parsedCredits,
        diff,
      });
    }
  }

  // 3. Purchases / Debits:
  // Axis format: purchases + cash advance + other = sum of all debit lines
  if (declaredTotals.purchases !== undefined) {
    const declaredDebits =
      (declaredTotals.purchases || 0) +
      (declaredTotals.cash || 0) +
      (declaredTotals.other || 0);
    const parsedDebits = sumLines((l) => l.direction === 'debit');
    const diff = Math.abs(parsedDebits - declaredDebits);
    if (diff > 0) {
      differences.push({
        field: 'purchases',
        declared: declaredDebits,
        parsed: parsedDebits,
        diff,
      });
    }
  } else if (declaredTotals.purchasesPaise !== undefined && declaredTotals.purchasesPaise !== null) {
    // TestBank format: purchasesPaise compared against spend/purchase lines
    const parsedPurchases = sumLines(
      (l) => l.direction === 'debit' && (l.type === 'purchase' || l.type === 'spend')
    );
    const diff = Math.abs(parsedPurchases - declaredTotals.purchasesPaise);
    if (diff > 0) {
      differences.push({
        field: 'purchasesPaise',
        declared: declaredTotals.purchasesPaise,
        parsed: parsedPurchases,
        diff,
      });
    }
  }

  // 4. Fees:
  if (declaredTotals.feesPaise !== undefined && declaredTotals.feesPaise !== null) {
    const parsedFees = sumLines((l) => l.type === 'fee' || l.type === 'interest');
    const diff = Math.abs(parsedFees - declaredTotals.feesPaise);
    if (diff > 0) {
      differences.push({
        field: 'feesPaise',
        declared: declaredTotals.feesPaise,
        parsed: parsedFees,
        diff,
      });
    }
  }

  return {
    ok: differences.length === 0,
    differences,
  };
}

/**
 * Determines whether the statement import requires explicit user confirmation ("needs attention").
 * Marked if unparsedLines is not empty OR checkTotals fails OR there are warnings OR declaredTotals is missing.
 *
 * @param {object} result - Parser output
 * @param {object} [totalsCheck] - Output of checkTotals(result)
 * @returns {boolean}
 */
export function isNeedsAttention(result, totalsCheck) {
  if (!result) return false;
  const hasUnparsed = Array.isArray(result.unparsedLines) && result.unparsedLines.length > 0;
  const check = totalsCheck || checkTotals(result);
  const totalsFailed = Boolean(!check.ok);
  if (check?.note === 'totals not checked yet') {
    return hasUnparsed || totalsFailed;
  }
  const hasWarnings = Array.isArray(result.warnings) && result.warnings.length > 0;
  const missingDeclaredTotals = result.declaredTotals === null;
  return hasUnparsed || totalsFailed || hasWarnings || missingDeclaredTotals;
}

