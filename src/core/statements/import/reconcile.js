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
    return { ok: true, differences: [] };
  }

  const { declaredTotals, lines = [] } = result;
  const differences = [];

  const sumLines = (predicate) =>
    lines.filter(predicate).reduce((acc, l) => acc + (l.amountPaise || 0), 0);

  if (declaredTotals.purchasesPaise !== undefined && declaredTotals.purchasesPaise !== null) {
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

  if (declaredTotals.creditsPaise !== undefined && declaredTotals.creditsPaise !== null) {
    const parsedCredits = sumLines((l) => l.direction === 'credit');
    const diff = Math.abs(parsedCredits - declaredTotals.creditsPaise);
    if (diff > 0) {
      differences.push({
        field: 'creditsPaise',
        declared: declaredTotals.creditsPaise,
        parsed: parsedCredits,
        diff,
      });
    }
  }

  if (declaredTotals.paymentsPaise !== undefined && declaredTotals.paymentsPaise !== null) {
    const parsedPayments = sumLines((l) => l.type === 'payment');
    const diff = Math.abs(parsedPayments - declaredTotals.paymentsPaise);
    if (diff > 0) {
      differences.push({
        field: 'paymentsPaise',
        declared: declaredTotals.paymentsPaise,
        parsed: parsedPayments,
        diff,
      });
    }
  }

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
 * Marked if unparsedLines is not empty OR checkTotals fails.
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
  return hasUnparsed || totalsFailed;
}

