import { parseSms } from '../ingest/index.js';
import { isAllowed } from '../ingest/senders.js';
import { listReviewItems, markReviewResolved } from '../db/reviewQueue.js';

const KNOWN_BANK_ISSUERS = new Set(['axis', 'icici', 'hdfc', 'idfc', 'sbi', 'sbimf', 'indusind']);
const BANK_REGEX = /\b(?:axis|icici|hdfc|idfc)\b/i;
const SENDER_BANK_REGEX = /(?:axis|icici|hdfc|idfc|sbi(?!mf))/i;

/**
 * Checks if a message parses to a known bank issuer (axis, icici, hdfc, idfc)
 * with status "parsed" or "ignored".
 * 
 * @param {object} msg - Raw SMS object { address, body, date }
 * @param {object} [parsedResult] - Optional pre-computed parseSms result
 * @param {object} [ctx] - Parser context (accounts, etc.)
 * @returns {boolean}
 */
export function isLikelyBankMessage(msg, parsedResult = null, ctx = {}) {
  if (!msg) return false;

  const parsed = parsedResult || parseSms(msg, ctx);
  if (!parsed) return false;

  const status = parsed.status;
  if (status !== 'parsed' && status !== 'ignored') {
    return false;
  }

  // 1. If parsed with a recognized bank issuer
  const issuer = String(parsed.txn?.issuer || parsed.issuer || '').toLowerCase();
  if (KNOWN_BANK_ISSUERS.has(issuer)) {
    return true;
  }

  // 2. If status is parsed or ignored, check if address or body refers to known issuer
  const address = String(msg.address || '');
  if (SENDER_BANK_REGEX.test(address)) {
    return true;
  }

  const body = String(msg.body || '');
  if (BANK_REGEX.test(body)) {
    return true;
  }

  return false;
}

/**
 * Given an array of SMS messages, returns a Set of sender addresses
 * where at least one message parses to a known issuer (axis, icici, hdfc, idfc)
 * with status "parsed" or "ignored".
 * 
 * @param {Array<object>} messages
 * @param {object} [ctx]
 * @returns {Set<string>}
 */
export function findLikelyBankSenderAddresses(messages = [], ctx = {}) {
  const likelySet = new Set();
  for (const msg of messages) {
    if (!msg || !msg.address) continue;
    const addr = String(msg.address).trim();
    if (likelySet.has(addr)) continue;

    if (isLikelyBankMessage(msg, null, ctx)) {
      likelySet.add(addr);
    }
  }
  return likelySet;
}

/**
 * Resolves open unparsed and held review items whose stored address is not allowed.
 * Writes `review.resolved` events and marks rows in `review_queue` as resolved.
 * 
 * @param {object} options
 * @param {object} options.db - SQLite database adapter
 * @param {object} options.writer - LogWriter instance
 * @param {string[]} options.allowlist - Array of allowed sender strings
 * @returns {Promise<{ count: number, resolvedIds: string[] }>}
 */
export async function removeReviewItemsFromDisallowedSenders({ db, writer, allowlist = [] }) {
  if (!db) {
    return { count: 0, resolvedIds: [] };
  }

  const openItems = await listReviewItems(db);
  const resolvedIds = [];

  // Query raw_messages for held message addresses
  let heldAddressMap = {}; // stableKey -> Set of sender addresses
  try {
    const rawRows = await db.query("SELECT hash, parsed FROM raw_messages WHERE kind = 'parsed';");
    for (const r of rawRows) {
      try {
        const parsed = JSON.parse(r.parsed || '{}');
        if (parsed.accountId === null || parsed.txn?.accountId === null) {
          const issuer = parsed.accountHint?.issuer || parsed.txn?.accountHint?.issuer || '';
          const digits =
            parsed.accountHint?.digits ||
            parsed.accountHint?.product ||
            parsed.txn?.accountHint?.digits ||
            '';
          const stableKey = `${issuer}|${digits}`;
          if (!heldAddressMap[stableKey]) heldAddressMap[stableKey] = new Set();
          if (parsed.address) heldAddressMap[stableKey].add(parsed.address);
        }
      } catch {}
    }
  } catch {}

  for (const item of openItems) {
    if (item.status !== 'open') continue;
    let shouldResolve = false;

    if (item.type === 'unparsed') {
      const addr = item.payload?.address || item.address;
      if (addr && !isAllowed(addr, allowlist)) {
        shouldResolve = true;
      }
    } else if (item.type === 'unknown_account') {
      const addr = item.payload?.address || item.address;
      if (addr) {
        if (!isAllowed(addr, allowlist)) {
          shouldResolve = true;
        }
      } else {
        const issuer = item.payload?.issuer || '';
        const digits = item.payload?.digits || item.payload?.product || '';
        const stableKey = item.payload?.stableKey || `${issuer}|${digits}`;
        const addrs = heldAddressMap[stableKey];
        if (addrs && addrs.size > 0) {
          const hasAllowed = Array.from(addrs).some((a) => isAllowed(a, allowlist));
          if (!hasAllowed) {
            shouldResolve = true;
          }
        }
      }
    }

    if (shouldResolve) {
      resolvedIds.push(item.id);
      if (writer && typeof writer.write === 'function') {
        await writer.write('review.resolved', {
          reviewId: item.id,
          decision: 'dismissed',
          reason: 'disallowed_sender',
        });
      }
      if (typeof markReviewResolved === 'function') {
        await markReviewResolved(db, item.id);
      } else {
        await db.exec('UPDATE review_queue SET status = ? WHERE id = ?;', ['resolved', item.id]);
      }
    }
  }

  return {
    count: resolvedIds.length,
    resolvedIds,
  };
}
