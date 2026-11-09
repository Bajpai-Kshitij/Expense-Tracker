import { listReviewItems } from '../db/reviewQueue.js';
import { matchUserIgnore } from './userIgnore.js';
import { parseSms } from './index.js';
import { sha256Hex } from './registry.js';
import { expenseIdFromDedupeKey } from '../events/id.js';
import { categorize } from '../categorize/index.js';
import { isAllowed } from './senders.js';
import { findRefundOriginal, findManualCandidates, findStatementMatch } from './match.js';

/**
 * Computes deterministic linkId for card payments across SMS and statement pipelines.
 * Formula: "pay_" + first 12 hex of SHA-256(cardLast4 + "|" + amountPaise + "|" + date)
 *
 * @param {object} params
 * @param {string} params.cardLast4
 * @param {number} params.amountPaise
 * @param {string} params.date "YYYY-MM-DD"
 * @returns {string|null}
 */
export function computePaymentLinkId({ cardLast4, amountPaise, date }) {
  if (!cardLast4) return null;
  return 'pay_' + sha256Hex(`${cardLast4}|${amountPaise}|${date}`).slice(0, 12);
}

/**
 * Plans importing an array of incoming SMS messages against the current system state.
 * PURE function with no side effects.
 * 
 * @param {object} params
 * @param {Array<{ address: string, body: string, date: number }>} params.messages
 * @param {object} params.ctx - { accounts, brands, rules, ownerNames }
 * @param {object} params.state - Current reducer state
 * @param {Set<string>|Array<string>} [params.seenHashes] - Hashes of already stored raw messages
 * @param {string[]} [params.allowlist] - List of permitted sender addresses
 * @param {number|(() => number)} [params.now] - Current timestamp
 * @returns {object} { events, rawRows, reviewItems, summary }
 */
export function planImport({
  messages = [],
  ctx = {},
  state = {},
  seenHashes = new Set(),
  allowlist,
  now,
} = {}) {
  const sorted = messages.slice().sort((a, b) => (Number(a.date) || 0) - (Number(b.date) || 0));
  const seen = seenHashes instanceof Set ? new Set(seenHashes) : new Set(seenHashes || []);

  const accountsList = Array.isArray(ctx.accounts)
    ? ctx.accounts
    : Object.values(ctx.accounts || {});
  const parseCtx = {
    ...ctx,
    accounts: accountsList,
  };
  const catCtx = {
    ...ctx,
    categories: ctx.categories || state.categories || {},
  };

  const events = [];
  const rawRows = [];
  const reviewItems = [];
  const allExpenses = { ...(state?.expenses || {}) };

  const summary = {
    scanned: 0,
    skippedSender: 0,
    duplicateMessage: 0,
    ignored: 0,
    unknown: 0,
    unparsed: 0,
    held: 0,
    created: 0,
    duplicateTransaction: 0,
    skippedDeleted: 0,
    refundLinked: 0,
    possibleDuplicates: 0,
    byKind: {
      spend: 0,
      transfer: 0,
      income: 0,
      fixed: 0,
    },
    newestMessageDate: null,
  };

  for (const msg of sorted) {
    if (!msg) continue;
    summary.scanned += 1;
    const msgDate = Number(msg.date) || null;
    if (msgDate) {
      summary.newestMessageDate = Math.max(summary.newestMessageDate || 0, msgDate);
    }

    // a. Sender allowlist check
    if (allowlist && !isAllowed(msg.address, allowlist)) {
      summary.skippedSender += 1;
      continue;
    }

    // Duplicate message check via rawHash
    const rawHash = sha256Hex(`${msg.address}|${msg.date}|${msg.body}`);
    if (seen.has(rawHash)) {
      summary.duplicateMessage += 1;
      continue;
    }
    seen.add(rawHash);

    // b. Parse SMS
    const parsedResult = parseSms(msg, parseCtx);
    const { status, txn } = parsedResult;

    if (status === 'unknown') {
      summary.unknown += 1;
      continue;
    }

    if (status === 'ignored') {
      summary.ignored += 1;
      rawRows.push({
        hash: rawHash,
        kind: 'ignored',
        body: msg.body,
        received_at: msg.date,
        parsed: JSON.stringify({ ...parsedResult, address: msg.address, date: msg.date }),
      });
      continue;
    }

    if (matchUserIgnore({ body: msg.body, status, txn, rules: ctx?.rules })) {
      summary.ignored += 1;
      rawRows.push({
        hash: rawHash,
        kind: 'ignored',
        body: msg.body,
        received_at: msg.date,
        parsed: JSON.stringify({ status: 'ignored', reason: 'user_rule', address: msg.address, date: msg.date }),
      });
      continue;
    }

    if (status === 'unparsed') {
      summary.unparsed += 1;
      rawRows.push({
        hash: rawHash,
        kind: 'unparsed',
        body: msg.body,
        received_at: msg.date,
        parsed: JSON.stringify({ ...parsedResult, address: msg.address, date: msg.date }),
      });

      const reviewId = 'rv_' + sha256Hex('unparsed|' + rawHash).slice(0, 12);
      if (!state?.reviews?.[reviewId]) {
        reviewItems.push({
          id: reviewId,
          reviewId,
          type: 'unparsed',
          payload: {
            id: reviewId,
            reviewId,
            type: 'unparsed',
            status: 'open',
            rawHash,
            address: msg.address,
            date: msg.date,
            body: msg.body,
          },
          status: 'open',
        });
      }
      continue;
    }

    // c. Parsed with accountId null -> HOLD
    if (status === 'parsed' && (!txn || txn.accountId === null)) {
      summary.held += 1;
      rawRows.push({
        hash: rawHash,
        kind: 'parsed',
        body: msg.body,
        received_at: msg.date,
        parsed: JSON.stringify({
          ...parsedResult,
          address: msg.address,
          date: msg.date,
          accountId: null,
        }),
      });

      const digitsOrProduct = txn?.accountHint?.digits || txn?.accountHint?.product || '';
      const stableKey = `${txn?.accountHint?.issuer || ''}|${digitsOrProduct}`;
      const reviewId = 'rv_' + sha256Hex('unknown_account|' + stableKey).slice(0, 12);
      if (!state?.reviews?.[reviewId]) {
        reviewItems.push({
          id: reviewId,
          reviewId,
          type: 'unknown_account',
          payload: {
            id: reviewId,
            reviewId,
            type: 'unknown_account',
            status: 'open',
            issuer: txn?.accountHint?.issuer,
            digits: txn?.accountHint?.digits,
            product: txn?.accountHint?.product,
            accountType: txn?.accountHint?.accountType,
            stableKey,
          },
          status: 'open',
        });
      }
      continue;
    }

    // d. Parsed with an account
    if (status === 'parsed' && txn && txn.accountId !== null) {
      // Raw row is always stored for parsed messages
      rawRows.push({
        hash: rawHash,
        kind: 'parsed',
        body: msg.body,
        received_at: msg.date,
        parsed: JSON.stringify({ ...parsedResult, address: msg.address, date: msg.date }),
      });

      const expenseId = expenseIdFromDedupeKey(txn.dedupeKey);
      const existing = allExpenses[expenseId];
      if (existing) {
        if (existing.deleted || existing.status === 'deleted') {
          summary.skippedDeleted += 1;
        } else {
          summary.duplicateTransaction += 1;
        }
        continue;
      }

      // Check if SMS dedupeKey exists in linkedKeys / expense_keys
      const linkedExpense = Object.values(allExpenses).find((exp) => {
        if (exp.dedupeKey === txn.dedupeKey) return true;
        if (exp.linkedKeys && exp.linkedKeys.has(txn.dedupeKey)) return true;
        return false;
      });
      if (linkedExpense) {
        summary.duplicateTransaction += 1;
        continue;
      }

      // Check mirrored statement match
      const stmtMatch = findStatementMatch(txn, txn.accountId, allExpenses);
      if (stmtMatch.status === 'one') {
        const matchedExpenseId = stmtMatch.expenseId;
        const targetExp = allExpenses[matchedExpenseId];

        events.push({
          type: 'expense.linked',
          data: {
            expenseId: matchedExpenseId,
            key: txn.dedupeKey,
            via: 'sms',
          },
        });

        // Patch only empty fields; never overwrite statement values
        const patch = {};
        if (!targetExp.txnTs && txn.txnTs) patch.txnTs = txn.txnTs;
        if (!targetExp.refNo && txn.refNo) patch.refNo = txn.refNo;
        if (!targetExp.mode && txn.mode) patch.mode = txn.mode;
        if (!targetExp.availLimitPaise && txn.availLimitPaise) patch.availLimitPaise = txn.availLimitPaise;
        patch.smsKey = txn.dedupeKey;

        events.push({
          type: 'expense.updated',
          data: {
            expenseId: matchedExpenseId,
            patch,
          },
        });

        if (!targetExp.linkedKeys) targetExp.linkedKeys = new Set();
        targetExp.linkedKeys.add(txn.dedupeKey);
        targetExp.smsKey = txn.dedupeKey;
        Object.assign(targetExp, patch);
        continue;
      } else if (stmtMatch.status === 'many') {
        summary.possibleDuplicates += 1;
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
              candidateExpenseIds: stmtMatch.candidates.map((c) => c.id),
              reason: 'multiple_statement_candidates',
            },
            status: 'open',
          });
        }
      }

      let finalKind = txn.kind;
      let brand = null;
      let categoryId = null;

      // Categorize only kinds spend and fixed
      if (txn.kind === 'spend' || txn.kind === 'fixed') {
        const catResult = categorize(
          {
            merchantRaw: txn.merchantRaw,
            note: '',
            rawText: msg.body,
            accountId: txn.accountId,
            direction: txn.direction,
            amountPaise: txn.amountPaise,
          },
          catCtx
        );
        brand = catResult.brand || null;
        categoryId = catResult.categoryId || null;
        if (txn.kind === 'spend' && catResult.kind) {
          finalKind = catResult.kind;
        }
      }

      // Refund linking
      let refundOf = null;
      if (txn.direction === 'credit' && (finalKind === 'spend' || finalKind === 'fixed')) {
        const refundMatch = findRefundOriginal({
          txn: { ...txn, kind: finalKind, brand, categoryId },
          expenses: allExpenses,
        });
        if (refundMatch) {
          refundOf = refundMatch.id;
          categoryId = refundMatch.categoryId;
          brand = refundMatch.brand;
          summary.refundLinked += 1;
        }
      }

      // Card payment link
      let linkId = null;
      if (txn.linkHint?.type === 'card_payment' && txn.linkHint.cardLast4) {
        linkId = computePaymentLinkId({
          cardLast4: txn.linkHint.cardLast4,
          amountPaise: txn.amountPaise,
          date: txn.date,
        });
      }

      // Manual duplicate check
      const manualCandidates = findManualCandidates({ txn, expenses: allExpenses });
      if (manualCandidates.length > 0) {
        summary.possibleDuplicates += 1;
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
              importedId: expenseId,
              candidateIds: manualCandidates,
            },
            status: 'open',
          });
        }
      }

      const expenseData = {
        expenseId,
        amountPaise: txn.amountPaise,
        date: txn.date,
        direction: txn.direction,
        kind: finalKind,
        merchantRaw: txn.merchantRaw || '',
        brand,
        categoryId,
        categoryLocked: 0,
        accountId: txn.accountId,
        mode: txn.mode || 'other',
        source: 'sms',
        refNo: txn.refNo || null,
        dedupeKey: txn.dedupeKey,
        note: '',
        rawHash,
      };

      if (txn.txnTs) {
        expenseData.txnTs = txn.txnTs;
      }
      if (linkId) {
        expenseData.linkId = linkId;
      }
      if (refundOf) {
        expenseData.refundOf = refundOf;
      }

      events.push({
        type: 'expense.created',
        data: expenseData,
      });

      summary.created += 1;
      summary.byKind[finalKind] = (summary.byKind[finalKind] || 0) + 1;

      // Track created expense for subsequent deduplication / linking in this batch
      allExpenses[expenseId] = {
        id: expenseId,
        ...expenseData,
        status: 'active',
        deleted: false,
      };
    }
  }

  return {
    events,
    rawRows,
    reviewItems,
    summary,
  };
}

/**
 * Applies an import plan with strict transactional ordering:
 * 1) Append events via writer.writeMany (appends to log and updates read model).
 * 2) In ONE database transaction: insert raw_messages (IGNORE) and review_queue (IGNORE).
 * 
 * @param {object} params
 * @param {object} params.plan - Result of planImport
 * @param {object} params.writer - LogWriter instance
 * @param {object} params.db - SQLite database adapter
 */
export async function applyImport({ plan, writer, db }) {
  if (!plan) return;

  // 1) Write events through writer
  if (plan.events && plan.events.length > 0) {
    await writer.writeMany(plan.events);
  }

  // 2) ONE database transaction for raw rows and review items
  if (db && typeof db.transaction === 'function') {
    await db.transaction(async (tx) => {
      for (const row of plan.rawRows || []) {
        const receivedAtStr =
          typeof row.received_at === 'number'
            ? new Date(row.received_at).toISOString()
            : String(row.received_at);
        await tx.exec(
          'INSERT OR IGNORE INTO raw_messages (hash, kind, body, received_at, parsed) VALUES (?, ?, ?, ?, ?);',
          [row.hash, row.kind, row.body, receivedAtStr, row.parsed]
        );
      }

      for (const item of plan.reviewItems || []) {
        const payloadStr =
          typeof item.payload === 'string' ? item.payload : JSON.stringify(item.payload);
        await tx.exec(
          'INSERT OR IGNORE INTO review_queue (id, type, payload, status) VALUES (?, ?, ?, ?);',
          [item.id, item.type, payloadStr, item.status || 'open']
        );
      }
    });
  }
}

/**
 * Re-reads open "unparsed" review items, so messages scanned before their layout was supported
 * are imported. A rescan cannot do this because their hashes are already stored. Items the user
 * dismissed are not open, so they stay rejected.
 *
 * @returns {Promise<object>} { created, byKind }
 */
export async function reprocessOpenUnparsed({ db, writer, state = {}, ownerNames = [] }) {
  const ctx = { accounts: state.accounts || {}, brands: state.brands || {}, rules: state.rules || {}, ownerNames };
  const parseCtx = { ...ctx, accounts: Object.values(ctx.accounts) };

  const nowReadable = (await listReviewItems(db, 'unparsed')).filter((item) => {
    const { body, address, date } = item.payload || {};
    return body && parseSms({ address, body, date }, parseCtx).status !== 'unparsed';
  });
  if (nowReadable.length === 0) return { created: 0, byKind: {} };

  const messages = nowReadable.map(({ payload: p }) => ({ address: p.address, body: p.body, date: p.date }));
  const plan = planImport({ messages, ctx, state, seenHashes: new Set() });
  await applyImport({ plan, writer, db });

  for (const row of plan.rawRows) {
    await db.exec('UPDATE raw_messages SET kind = ?, parsed = ? WHERE hash = ?;', [row.kind, row.parsed, row.hash]);
  }
  await writer.writeMany(nowReadable.map((item) => ({ type: 'review.resolved', data: { reviewId: item.id, decision: 'parsed_later' } })));
  for (const item of nowReadable) {
    await db.exec('UPDATE review_queue SET status = ? WHERE id = ?;', ['resolved', item.id]);
  }
  return { created: plan.summary.created, byKind: plan.summary.byKind };
}

/**
 * Rebuilds review items for stored raw rows with status "unparsed" or held that lack one.
 * 
 * @param {object} db - SQLite database adapter
 * @param {object} [state={}] - Current reducer state
 * @returns {Promise<Array<object>>} Rebuilt review items
 */
export async function ensureUnparsedReviewItems(db, state = {}) {
  if (!db || typeof db.query !== 'function') return [];

  const rows = await db.query('SELECT hash, kind, body, received_at, parsed FROM raw_messages;');
  const createdItems = [];

  for (const row of rows) {
    let parsedData = {};
    try {
      parsedData = JSON.parse(row.parsed || '{}');
    } catch {}

    if (row.kind === 'unparsed') {
      const id = 'rv_' + sha256Hex('unparsed|' + row.hash).slice(0, 12);
      if (!state?.reviews?.[id]) {
        const payload = {
          id,
          reviewId: id,
          type: 'unparsed',
          status: 'open',
          rawHash: row.hash,
          body: row.body,
          address: parsedData.address,
          date: parsedData.date,
          receivedAt: row.received_at,
        };
        const payloadStr = JSON.stringify(payload);
        await db.exec(
          'INSERT OR IGNORE INTO review_queue (id, type, payload, status) VALUES (?, ?, ?, ?);',
          [id, 'unparsed', payloadStr, 'open']
        );
        createdItems.push({ id, type: 'unparsed', payload });
      }
    } else if (
      row.kind === 'parsed' &&
      (parsedData.accountId === null || parsedData.txn?.accountId === null)
    ) {
      const accountHint = parsedData.accountHint || parsedData.txn?.accountHint;
      const issuer = accountHint?.issuer || '';
      const digitsOrProduct = accountHint?.digits || accountHint?.product || '';
      const stableKey = `${issuer}|${digitsOrProduct}`;
      const id = 'rv_' + sha256Hex('unknown_account|' + stableKey).slice(0, 12);

      if (!state?.reviews?.[id]) {
        const payload = {
          id,
          reviewId: id,
          type: 'unknown_account',
          status: 'open',
          issuer,
          digits: accountHint?.digits,
          product: accountHint?.product,
          stableKey,
        };
        const payloadStr = JSON.stringify(payload);
        await db.exec(
          'INSERT OR IGNORE INTO review_queue (id, type, payload, status) VALUES (?, ?, ?, ?);',
          [id, 'unknown_account', payloadStr, 'open']
        );
        createdItems.push({ id, type: 'unknown_account', payload });
      }
    }
  }

  return createdItems;
}
