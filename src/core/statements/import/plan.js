import { categorize } from '../../categorize/index.js';
import { expenseIdFromDedupeKey } from '../../events/id.js';
import { sha256Hex } from '../../ingest/registry.js';
import { computePaymentLinkId } from '../../ingest/pipeline.js';
import { checkTotals, isNeedsAttention } from './reconcile.js';
import { statementLineKey, findSmsMatch, findManualMatch } from './match.js';

const EMI_TYPES = new Set(['emi_interest', 'emi_principal', 'emi_tax', 'emi_fee']);
const FEE_TYPES = new Set(['fee', 'tax']);

function emiPartOf(line) {
  return line.emiPart || { emi_principal: 'principal', emi_interest: 'interest', emi_tax: 'tax', emi_fee: 'fee' }[line.type] || null;
}

function emiPlanKeyOf(line, accountId) {
  if (line.plan && line.plan.creationDate && line.plan.total != null && line.plan.loanPaise != null) {
    return `emi:${accountId}|${line.plan.creationDate}|${line.plan.total}|${line.plan.loanPaise}`;
  }
  const emiMerchant = line.emiMerchant || line.merchant || line.merchantRaw || '';
  return `emi:${accountId}|${emiMerchant.toUpperCase().replace(/[^A-Z0-9]/g, '')}|${line.emiTotal ?? ''}`;
}

function emiFieldsOf(line, accountId) {
  return {
    emiPlanKey: emiPlanKeyOf(line, accountId),
    emiNo: line.emiNo ?? null,
    emiTotal: line.emiTotal ?? null,
    emiPart: emiPartOf(line),
    emiMonthlyPaise: line.emiMonthlyPaise ?? (line.plan?.monthlyPaise ?? null),
    emiFinishDate: line.emiFinishDate ?? (line.plan?.finishDate ?? null),
    emiOutstandingPaise: line.emiOutstandingPaise ?? (line.plan?.outstandingPaise ?? null),
  };
}

/** True if the field still has the value it got when the expense was created. */
function isUnedited(exp, ...fields) {
  const created = exp.field_ts?.dedupeKey;
  return fields.every((field) => {
    const stamp = exp.field_ts?.[field];
    return !stamp || !created || (stamp.ts === created.ts && stamp.dev === created.dev);
  });
}

/**
 * Patch that brings an already imported expense in line with this line's classification.
 * Fields the user changed are left alone. Returns null when nothing needs changing.
 */
function repairPatch(line, exp, accountId) {
  const isEmi = EMI_TYPES.has(line.type);
  const isConversion = line.type === 'emi_conversion';
  if (!isEmi && !isConversion && !FEE_TYPES.has(line.type)) return null;

  const patch = {};
  const kind = isEmi ? 'fixed' : isConversion ? 'transfer' : null;
  if (kind && exp.kind !== kind && isUnedited(exp, 'kind')) patch.kind = kind;

  const categoryFree = !exp.categoryLocked && !exp.category_locked && isUnedited(exp, 'categoryId', 'category_id', 'category_locked', 'categoryLocked');
  if (categoryFree) {
    if (isEmi && exp.categoryId !== 'cat_emi') patch.categoryId = 'cat_emi';
    if (FEE_TYPES.has(line.type) && !exp.categoryId) patch.categoryId = 'cat_fees';
  }

  if (isEmi) {
    for (const [field, value] of Object.entries(emiFieldsOf(line, accountId))) {
      if ((exp[field] ?? null) !== value) patch[field] = value;
    }
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

/**
 * Plans importing parsed statement lines into domain events.
 * PURE function with no side effects.
 *
 * @param {object} params
 * @param {object} params.result - Output from statement parser
 * @param {string} params.fileHash - SHA-256 hash of the statement file
 * @param {string} params.accountId - Resolved/selected account ID
 * @param {object} [params.state={}] - Current reducer state
 * @param {string} [params.now] - Current ISO timestamp
 * @param {boolean} [params.isDuplicateFile=false] - Whether this fileHash was already imported
 * @returns {object} { events, rawRows, reviewItems, summary, plannedLines, fileDuplicate }
 */
export function planStatementImport({
  result,
  fileHash,
  accountId,
  state = {},
  now = new Date().toISOString(),
  isDuplicateFile = false,
}) {
  if (!result || !result.ok) {
    return {
      events: [],
      rawRows: [],
      reviewItems: [],
      summary: {
        lines: 0,
        created: 0,
        linkedToSms: 0,
        alreadyImported: 0,
        payments: 0,
        paymentsLinked: 0,
        possibleDuplicates: 0,
        needsAttention: true,
        byType: {},
      },
      plannedLines: [],
      fileDuplicate: false,
    };
  }

  const totalsCheck = checkTotals(result);
  const needsAttention = isNeedsAttention(result, totalsCheck);

  const summary = {
    lines: (result.lines || []).length,
    created: 0,
    linkedToSms: 0,
    alreadyImported: 0,
    payments: 0,
    paymentsLinked: 0,
    possibleDuplicates: 0,
    repaired: 0,
    needsAttention,
    byType: {},
  };

  if (isDuplicateFile) {
    return {
      events: [],
      rawRows: [],
      reviewItems: [],
      summary,
      plannedLines: [],
      fileDuplicate: true,
    };
  }

  // Clone expenses from state to track in-memory during import planning
  const allExpenses = {};
  for (const [id, exp] of Object.entries(state.expenses || {})) {
    allExpenses[id] = {
      ...exp,
      linkedKeys: new Set(exp.linkedKeys || []),
    };
    if (exp.dedupeKey) allExpenses[id].linkedKeys.add(exp.dedupeKey);
    if (exp.statementKey) allExpenses[id].linkedKeys.add(exp.statementKey);
  }

  const catCtx = {
    brands: state.brands || {},
    rules: state.rules || {},
    categories: state.categories || {},
    accounts: state.accounts || {},
  };

  const events = [];
  const rawRows = [];
  const reviewItems = [];
  const plannedLines = [];

  const occurrenceMap = new Map();
  const usedSmsExpenseIds = new Set();

  // Sort lines in date order
  const sortedLines = (result.lines || []).slice().sort((a, b) => a.date.localeCompare(b.date));

  // Count total identical statement lines for 1-to-1 pairing in date order
  const identicalCounts = new Map();
  for (const line of sortedLines) {
    const tokenMatch = (line.merchantRaw || '').match(/[A-Za-z0-9]+/);
    const token = tokenMatch ? tokenMatch[0].toUpperCase() : 'x';
    const sig = `${accountId}|${line.amountPaise}|${line.date}|${line.direction}|${token}`;
    identicalCounts.set(sig, (identicalCounts.get(sig) || 0) + 1);
  }
  const usedCountsBySig = new Map();

  for (const line of sortedLines) {
    summary.byType[line.type] = (summary.byType[line.type] || 0) + 1;

    // Calculate occurrence index for identical lines in this statement
    const tokenMatch = (line.merchantRaw || '').match(/[A-Za-z0-9]+/);
    const token = tokenMatch ? tokenMatch[0].toUpperCase() : 'x';
    const occKey = `${accountId}|${line.amountPaise}|${line.date}|${line.direction}|${token}`;
    const occurrence = (occurrenceMap.get(occKey) || 0) + 1;
    occurrenceMap.set(occKey, occurrence);

    const lineKey = statementLineKey(line, accountId, occurrence);

    // Check if lineKey already exists in expenses
    const existingWithKey = Object.values(allExpenses).find((exp) => {
      if (exp.statementKey === lineKey || exp.dedupeKey === lineKey) return true;
      if (exp.linkedKeys && exp.linkedKeys.has(lineKey)) return true;
      return false;
    });

    const expectedExpId = expenseIdFromDedupeKey(lineKey);
    const existingById = allExpenses[expectedExpId];

    if (existingWithKey || existingById) {
      summary.alreadyImported += 1;
      const existing = existingWithKey || existingById;
      const patch = existing.deleted || existing.status === 'deleted' ? null : repairPatch(line, existing, accountId);
      if (patch) {
        summary.repaired += 1;
        events.push({ type: 'expense.updated', data: { expenseId: existing.id, patch } });
        Object.assign(existing, patch);
      }
      plannedLines.push({
        line,
        status: 'already_imported',
        key: lineKey,
        expenseId: existingWithKey ? existingWithKey.id : existingById.id,
      });
      continue;
    }

    // Payment line handling
    if (line.type === 'payment') {
      summary.payments += 1;
      const cardLast4 = result.account?.digits || '';
      const linkId = computePaymentLinkId({
        cardLast4,
        amountPaise: line.amountPaise,
        date: line.date,
      });

      // Find active SMS payment expense with the same linkId on the same account within 3 days
      const matchingSmsPayment = Object.values(allExpenses).find((exp) => {
        if (!exp || exp.deleted || exp.status === 'deleted') return false;
        if (exp.source !== 'sms') return false;
        if (exp.accountId !== accountId) return false;
        if (exp.linkId !== linkId) return false;
        const diffDays = Math.abs((Date.parse(line.date) - Date.parse(exp.date)) / 86400000);
        return diffDays <= 3.0001;
      });

      if (matchingSmsPayment) {
        summary.paymentsLinked += 1;
        events.push({
          type: 'expense.linked',
          data: {
            expenseId: matchingSmsPayment.id,
            key: lineKey,
            via: 'statement',
          },
        });
        if (!matchingSmsPayment.linkedKeys) matchingSmsPayment.linkedKeys = new Set();
        matchingSmsPayment.linkedKeys.add(lineKey);
        plannedLines.push({
          line,
          status: 'payment_linked',
          key: lineKey,
          expenseId: matchingSmsPayment.id,
        });
      } else {
        const expenseId = expenseIdFromDedupeKey(lineKey);
        const expenseData = {
          expenseId,
          amountPaise: line.amountPaise,
          date: line.date,
          direction: 'credit',
          kind: 'transfer',
          merchantRaw: line.merchantRaw,
          brand: null,
          categoryId: null,
          categoryLocked: false,
          accountId,
          mode: null,
          source: 'statement',
          refNo: line.refNo || null,
          dedupeKey: lineKey,
          statementKey: lineKey,
          statementFileHash: fileHash,
          linkId,
          note: '',
        };

        events.push({
          type: 'expense.created',
          data: expenseData,
        });
        summary.created += 1;

        allExpenses[expenseId] = {
          id: expenseId,
          ...expenseData,
          linkedKeys: new Set([lineKey]),
          deleted: false,
          status: 'active',
        };
        plannedLines.push({
          line,
          status: 'payment',
          key: lineKey,
          expenseId,
        });
      }
      continue;
    }

    // All other line types (purchases, refunds, fees, interest, emi, other)
    const totalIdenticalCount = identicalCounts.get(occKey) || 1;
    const usedCount = usedCountsBySig.get(occKey) || 0;
    const smsMatch = findSmsMatch(line, accountId, allExpenses, usedSmsExpenseIds, {
      totalIdenticalCount,
      usedCount,
    });

    if (smsMatch.status === 'one') {
      usedCountsBySig.set(occKey, usedCount + 1);
      const matchedExpId = smsMatch.expenseId;
      usedSmsExpenseIds.add(matchedExpId);
      summary.linkedToSms += 1;

      events.push({
        type: 'expense.linked',
        data: {
          expenseId: matchedExpId,
          key: lineKey,
          via: 'statement',
        },
      });

      // STATEMENT PRIORITY: amountPaise, date and merchantRaw take statement values;
      // source becomes "statement"; statementKey and statementFileHash are set;
      // category, categoryLocked, brand (if set by hand), note, and kind are NEVER changed.
      const patch = {
        amountPaise: line.amountPaise,
        date: line.date,
        merchantRaw: line.merchantRaw,
        source: 'statement',
        statementKey: lineKey,
        statementFileHash: fileHash,
      };
      if (line.refNo) patch.refNo = line.refNo;
      if (line.type === 'emi_conversion' && allExpenses[matchedExpId].kind === 'spend') {
        patch.kind = 'transfer';
      }

      events.push({
        type: 'expense.updated',
        data: {
          expenseId: matchedExpId,
          patch,
        },
      });

      const targetExp = allExpenses[matchedExpId];
      if (!targetExp.linkedKeys) targetExp.linkedKeys = new Set();
      targetExp.linkedKeys.add(lineKey);
      targetExp.statementKey = lineKey;
      Object.assign(targetExp, patch);

      plannedLines.push({
        line,
        status: 'linked_sms',
        key: lineKey,
        expenseId: matchedExpId,
      });
    } else {
      // Check for manual candidates or multiple SMS candidates
      const manualMatch = findManualMatch(line, accountId, allExpenses);
      const isAmbiguous = smsMatch.status === 'many' || Boolean(manualMatch);

      const expenseId = expenseIdFromDedupeKey(lineKey);

      if (isAmbiguous) {
        summary.possibleDuplicates += 1;
        const candidateIds =
          smsMatch.status === 'many'
            ? smsMatch.candidates.map((c) => c.id)
            : (manualMatch || []).map((c) => c.id);

        const reviewId = 'rv_' + sha256Hex('possible_duplicate|' + expenseId).slice(0, 12);
        if (!state?.reviews?.[reviewId]) {
          reviewItems.push({
            id: reviewId,
            reviewId,
            type: 'possible_duplicate',
            payload: {
              id: reviewId,
              reviewId,
              type: 'possible_duplicate',
              status: 'open',
              incomingExpenseId: expenseId,
              candidateExpenseIds: candidateIds,
              reason: smsMatch.status === 'many' ? 'multiple_sms_candidates' : 'manual_match',
            },
            status: 'open',
          });
        }
      }

      // Create statement expense
      const rawText = line.bankCategory
        ? `${line.merchantRaw} ${line.bankCategory}`
        : line.merchantRaw;

      // Type "cashback" becomes kind "income", direction credit, never categorized
      const isCashback = line.type === 'cashback';
      const isEmi = EMI_TYPES.has(line.type);
      const isConversion = line.type === 'emi_conversion';
      const isFee = FEE_TYPES.has(line.type);
      const catResult = isCashback || isConversion || isEmi
        ? { categoryId: null, brand: null, kind: isCashback ? 'income' : null }
        : categorize(
            {
              merchantRaw: line.merchantRaw,
              note: '',
              rawText,
              accountId,
              direction: line.direction,
              amountPaise: line.amountPaise,
            },
            catCtx
          );

      let finalKind = 'spend';
      if (isCashback) {
        finalKind = 'income';
      } else if (isEmi) {
        finalKind = 'fixed';
      } else if (isConversion) {
        finalKind = 'transfer';
      } else if (line.direction === 'credit' && line.type === 'refund') {
        finalKind = 'spend';
      } else if (catResult.kind) {
        finalKind = catResult.kind;
      }

      let finalCategoryId = isCashback ? null : (catResult.categoryId || null);
      if (isEmi) {
        finalCategoryId = 'cat_emi';
      } else if (isFee && !finalCategoryId) {
        finalCategoryId = 'cat_fees';
      }

      const emi = isEmi ? emiFieldsOf(line, accountId) : {};

      const expenseData = {
        expenseId,
        amountPaise: line.amountPaise,
        date: line.date,
        direction: line.direction,
        kind: finalKind,
        merchantRaw: line.merchantRaw,
        brand: isCashback ? null : (catResult.brand || null),
        categoryId: finalCategoryId,
        categoryLocked: false,
        accountId,
        mode: 'card',
        source: 'statement',
        refNo: line.refNo || null,
        dedupeKey: lineKey,
        statementKey: lineKey,
        statementFileHash: fileHash,
        note: '',
        emiPlanKey: emi.emiPlanKey ?? line.emiPlanKey ?? null,
        emiNo: line.emiNo ?? null,
        emiTotal: line.emiTotal ?? null,
        emiPart: emi.emiPart ?? line.emiPart ?? null,
        emiMonthlyPaise: line.emiMonthlyPaise ?? (line.plan?.monthlyPaise ?? null),
        emiFinishDate: line.emiFinishDate ?? (line.plan?.finishDate ?? null),
        emiOutstandingPaise: line.emiOutstandingPaise ?? (line.plan?.outstandingPaise ?? null),
        bankCategory: line.bankCategory || null,
      };

      events.push({
        type: 'expense.created',
        data: expenseData,
      });
      summary.created += 1;

      allExpenses[expenseId] = {
        id: expenseId,
        ...expenseData,
        linkedKeys: new Set([lineKey]),
        deleted: false,
        status: 'active',
      };

      plannedLines.push({
        line,
        status: isAmbiguous ? 'possible_duplicate' : 'new',
        key: lineKey,
        expenseId,
      });
    }
  }

  // Pass 2: Refund linking inside the statement plan
  // A refund (credit) links to a debit of the same account, the same amount, within 14 days,
  // when EXACTLY ONE such debit exists in the same import or in existing expenses; set refundOf.
  for (const pl of plannedLines) {
    if (
      pl.line?.type === 'refund' ||
      (pl.line?.direction === 'credit' && !['payment', 'cashback', 'emi_conversion'].includes(pl.line?.type))
    ) {
      const refundExpId = pl.expenseId;
      const refundExp = allExpenses[refundExpId];
      if (!refundExp) continue;

      const refundDateMs = Date.parse(refundExp.date);
      const candidates = Object.values(allExpenses).filter((exp) => {
        if (!exp || exp.deleted || exp.status === 'deleted') return false;
        if (exp.id === refundExpId) return false;
        if (exp.accountId !== accountId) return false;
        if (exp.direction !== 'debit' || exp.kind === 'transfer') return false;
        if (exp.amountPaise !== refundExp.amountPaise) return false;
        const diffDays = Math.abs((Date.parse(exp.date) - refundDateMs) / 86400000);
        return diffDays <= 14.0001;
      });

      if (candidates.length === 1) {
        const linkedDebitId = candidates[0].id;
        refundExp.refundOf = linkedDebitId;

        const createdEv = events.find(
          (e) => e.type === 'expense.created' && e.data?.expenseId === refundExpId
        );
        if (createdEv) {
          createdEv.data.refundOf = linkedDebitId;
        } else {
          const updatedEv = events.find(
            (e) => e.type === 'expense.updated' && e.data?.expenseId === refundExpId
          );
          if (updatedEv) {
            updatedEv.data.patch = updatedEv.data.patch || {};
            updatedEv.data.patch.refundOf = linkedDebitId;
          }
        }
      }
    }
  }

  // Store file hash row in raw_messages (no text)
  rawRows.push({
    hash: fileHash,
    kind: 'pdf_file',
    body: '',
    received_at: now,
    parsed: JSON.stringify({
      status: 'imported',
      period: result.period || null,
      fileHash,
    }),
  });

  return {
    events,
    rawRows,
    reviewItems,
    summary,
    plannedLines,
    fileDuplicate: false,
  };
}

/**
 * Events that undo a statement import: deletes the expenses this file created.
 * SMS expenses it only linked to were real before the import, so they stay.
 *
 * @param {object} state - Current reducer state.
 * @param {string} fileHash - SHA-256 of the statement file.
 * @returns {Array<{ type: string, data: object }>}
 */
export function planUndoImport(state = {}, fileHash) {
  return Object.values(state.expenses || {})
    .filter((e) => !e.deleted && e.statementFileHash === fileHash && e.dedupeKey && e.dedupeKey === e.statementKey)
    .map((e) => ({ type: 'expense.deleted', data: { expenseId: e.id } }));
}
