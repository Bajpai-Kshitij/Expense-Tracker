import { sha256Hex } from './registry.js';
import { planImport, applyImport } from './pipeline.js';
import { listReviewItems, countOpenReviewItems } from '../db/reviewQueue.js';

export { listReviewItems, countOpenReviewItems };

/**
 * Assigns an alias to an existing account, writes account.upserted,
 * reprocesses held messages for that alias, and marks the unknown_account review item resolved.
 * 
 * @param {object} params
 * @param {string} params.issuer - Issuer name (e.g. "icici" or "hdfc")
 * @param {string} params.digits - Last digits or product name
 * @param {string} params.accountId - Existing account ID
 * @param {object} params.writer - LogWriter instance
 * @param {object} params.state - Current reducer state
 * @param {object} params.db - SQLite database adapter
 * @returns {Promise<object>} Reprocessed import plan summary
 */
export async function assignAccountAlias({
  issuer,
  digits,
  accountId,
  writer,
  state = {},
  db,
}) {
  const accounts = state.accounts || {};
  const account =
    accounts[accountId] || Object.values(accounts).find((a) => a.id === accountId);

  if (!account) {
    throw new Error(`Account not found: ${accountId}`);
  }

  // 1. Add alias to account if not already present
  const aliases = Array.isArray(account.aliases) ? [...account.aliases] : [];
  const targetIssuer = String(issuer).trim().toLowerCase();
  const targetDigits = String(digits).trim();

  const alreadyHasAlias = aliases.some((a) => {
    const aIssuer = String(a.issuer || '').trim().toLowerCase();
    const aDigits = String(a.digits || '').trim();
    return aIssuer === targetIssuer && aDigits.slice(-3) === targetDigits.slice(-3);
  });

  if (!alreadyHasAlias) {
    aliases.push({ issuer, digits: targetDigits });
  }

  const updatedAccount = { ...account, aliases };
  state.accounts[accountId] = updatedAccount;

  // Re-emit account.upserted
  await writer.write('account.upserted', updatedAccount);

  // 2. Query stored raw rows held for that alias
  let heldSummary = null;
  if (db && typeof db.query === 'function') {
    const rows = await db.query(
      "SELECT hash, kind, body, received_at, parsed FROM raw_messages WHERE kind = 'parsed';"
    );

    const heldRows = rows.filter((r) => {
      let parsedData = {};
      try {
        parsedData = JSON.parse(r.parsed || '{}');
      } catch {}

      const isNullAcc =
        parsedData.accountId === null || parsedData.txn?.accountId === null;
      if (!isNullAcc) return false;

      const hint = parsedData.accountHint || parsedData.txn?.accountHint;
      if (!hint) return false;

      const hintIssuer = String(hint.issuer || '').trim().toLowerCase();
      if (hintIssuer !== targetIssuer) return false;

      const hintDigits = String(hint.digits || '').trim();
      if (hintDigits.length >= 3 && hintDigits.slice(-3) === targetDigits.slice(-3)) {
        return true;
      }
      if (
        hint.product &&
        String(hint.product).trim().toLowerCase() === targetDigits.toLowerCase()
      ) {
        return true;
      }

      return false;
    });

    if (heldRows.length > 0) {
      const messages = heldRows.map((r) => {
        let parsedData = {};
        try {
          parsedData = JSON.parse(r.parsed || '{}');
        } catch {}

        return {
          address: parsedData.address || 'UNKNOWN',
          body: r.body,
          date:
            parsedData.date ||
            (typeof r.received_at === 'string' ? Date.parse(r.received_at) : r.received_at),
        };
      });

      const ctx = {
        accounts: state.accounts,
        brands: state.brands || {},
        rules: state.rules || {},
        ownerNames: state.ownerNames || [],
      };

      const plan = planImport({
        messages,
        ctx,
        state,
        seenHashes: new Set(), // Allow held messages to be planned and created
      });

      await applyImport({ plan, writer, db });

      // Update parsed JSON in raw_messages to reflect the matched account
      for (const row of plan.rawRows) {
        await db.exec('UPDATE raw_messages SET parsed = ? WHERE hash = ?;', [
          row.parsed,
          row.hash,
        ]);
      }

      heldSummary = plan.summary;
    }
  }

  // 3. Mark the unknown_account review item as resolved
  const stableKey = `${issuer}|${digits}`;
  const reviewId = 'rv_' + sha256Hex('unknown_account|' + stableKey).slice(0, 12);

  await writer.write('review.resolved', {
    reviewId,
    resolution: 'alias_assigned',
    accountId,
    issuer,
    digits,
  });

  if (db && typeof db.exec === 'function') {
    await db.exec('UPDATE review_queue SET status = ? WHERE id = ?;', ['resolved', reviewId]);
  }

  return heldSummary;
}

/**
 * Resolves a possible_duplicate review item by either merging or keeping both.
 * 
 * @param {object} params
 * @param {string} params.reviewId
 * @param {"merge"|"keep_both"} params.decision
 * @param {string} [params.keepId]
 * @param {string} [params.dropId]
 * @param {object} params.writer - LogWriter instance
 * @param {object} params.state - Current reducer state
 * @param {object} [params.db] - SQLite database adapter
 */
export async function resolveDuplicate({
  reviewId,
  decision,
  keepId,
  dropId,
  writer,
  state = {},
  db,
}) {
  if (decision === 'merge') {
    const keepExpense = state.expenses?.[keepId] || {};
    const dropExpense = state.expenses?.[dropId] || {};

    // 1. expense.merged
    await writer.write('expense.merged', { keepId, dropId });

    // 2. expense.updated on keepId that copies note, categoryId (and sets category_locked if manual was locked)
    const patch = {};
    if (!keepExpense.note && dropExpense.note) {
      patch.note = dropExpense.note;
    }
    if (!keepExpense.categoryId && dropExpense.categoryId) {
      patch.categoryId = dropExpense.categoryId;
      if (dropExpense.categoryLocked || dropExpense.category_locked) {
        patch.categoryLocked = 1;
        patch.category_locked = 1;
      }
    }

    if (Object.keys(patch).length > 0) {
      await writer.write('expense.updated', { expenseId: keepId, patch });
    }

    // 3. review.resolved
    await writer.write('review.resolved', {
      reviewId,
      decision: 'merge',
      keepId,
      dropId,
    });
  } else if (decision === 'keep_both') {
    await writer.write('review.resolved', {
      reviewId,
      decision: 'keep_both',
    });
  }

  if (db && typeof db.exec === 'function') {
    await db.exec('UPDATE review_queue SET status = ? WHERE id = ?;', ['resolved', reviewId]);
  }
}

/**
 * Dismisses an unparsed review item by writing review.resolved and updating review_queue.
 * 
 * @param {object} params
 * @param {string} params.reviewId
 * @param {object} params.writer - LogWriter instance
 * @param {object} [params.db] - SQLite database adapter
 */
export async function dismissUnparsed({ reviewId, writer, db }) {
  await writer.write('review.resolved', {
    reviewId,
    decision: 'dismissed',
  });

  if (db && typeof db.exec === 'function') {
    await db.exec('UPDATE review_queue SET status = ? WHERE id = ?;', ['resolved', reviewId]);
  }
}
