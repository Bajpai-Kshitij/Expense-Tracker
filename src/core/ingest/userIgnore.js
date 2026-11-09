import { prepareBody } from './normalize.js';
import { sha256Hex } from './registry.js';
import { listReviewItems } from '../db/reviewQueue.js';

/**
 * User-defined SMS rejections. Stored as rule.upserted events with action "ignore_sms",
 * so they sync to both phones. Message text never goes into a rule, only its hash.
 */
export const IGNORE_ACTION = 'ignore_sms';

const DATE_TOKEN = /\b\d{1,2}[-/ ](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|\d{1,2})[a-z]*[-/ ]\d{2,4}\b/g;

/** Message wording with every number, date and masked account removed. */
export function smsTemplate(body) {
  const { flat } = prepareBody(String(body || ''));
  return String(flat || '')
    .toLowerCase()
    .replace(DATE_TOKEN, '#')
    .replace(/[x*]*\d[\d,.:/-]*/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

export function smsTemplateKey(body) {
  return sha256Hex(`tmpl|${smsTemplate(body)}`).slice(0, 16);
}

/** Upper-cases a payee and collapses spacing, so two spellings of one name compare equal. */
export function normalizeName(name) {
  return String(name || '').toUpperCase().replace(/\s+/g, ' ').trim();
}

export function buildTemplateIgnoreRule({ body, address, rawHash }) {
  const templateKey = smsTemplateKey(body);
  return { id: `ign_t_${templateKey}`, action: IGNORE_ACTION, matchType: 'template', templateKey, sender: address || null, sampleHash: rawHash || null, active: true };
}

export function buildMerchantIgnoreRule({ merchant }) {
  const merchantName = normalizeName(merchant);
  return { id: `ign_m_${sha256Hex(`merchant|${merchantName}`).slice(0, 16)}`, action: IGNORE_ACTION, matchType: 'merchant', merchantName, active: true };
}

export function buildAccountIgnoreRule({ issuer, digits }) {
  const iss = String(issuer || '').trim().toLowerCase();
  const dig = String(digits || '').trim();
  return { id: `ign_a_${sha256Hex(`account|${iss}|${dig.toLowerCase()}`).slice(0, 16)}`, action: IGNORE_ACTION, matchType: 'account', issuer: iss, digits: dig, active: true };
}

function ignoreRulesFrom(rules) {
  const list = Array.isArray(rules) ? rules : Object.values(rules || {});
  return list.filter((r) => r && r.action === IGNORE_ACTION && r.active !== false && !r._deleted);
}

export function listIgnoreRules(rules) {
  return ignoreRulesFrom(rules);
}

function accountRuleMatches(rule, hint) {
  if (!hint || String(hint.issuer || '').trim().toLowerCase() !== rule.issuer) return false;
  const ruleDigits = rule.digits.toLowerCase();
  const digits = String(hint.digits || '').trim();
  if (digits.length >= 3 && /^\d+$/.test(ruleDigits)) return digits.slice(-3) === ruleDigits.slice(-3);
  return String(hint.product || '').trim().toLowerCase() === ruleDigits;
}

/**
 * Finds the user rule that rejects this message, if any.
 *
 * @param {{ body: string, status: string, txn?: object, rules: object|Array }} params
 * @returns {object|null} The matching rule.
 */
export function matchUserIgnore({ body, status, txn, rules }) {
  const active = ignoreRulesFrom(rules);
  if (active.length === 0) return null;

  let templateKey = null;
  for (const rule of active) {
    if (rule.matchType === 'template') {
      if (status !== 'unparsed' && status !== 'parsed') continue;
      if (templateKey === null) templateKey = smsTemplateKey(body);
      if (rule.templateKey === templateKey) return rule;
    } else if (rule.matchType === 'merchant') {
      if (status === 'parsed' && txn?.merchantRaw && normalizeName(txn.merchantRaw) === rule.merchantName) return rule;
    } else if (rule.matchType === 'account') {
      if (status === 'parsed' && txn && txn.accountId === null && accountRuleMatches(rule, txn.accountHint)) return rule;
    }
  }
  return null;
}

function reviewItemMatches(item, rules) {
  const payload = item.payload || {};
  for (const rule of rules) {
    if (item.type === 'unparsed' && rule.matchType === 'template' && payload.body && rule.templateKey === smsTemplateKey(payload.body)) return true;
    if (item.type === 'unknown_account' && rule.matchType === 'account' && accountRuleMatches(rule, payload)) return true;
  }
  return false;
}

/** Number of open unparsed items that share each template, keyed by template. */
export function countSimilarUnparsed(items = []) {
  const counts = new Map();
  for (const item of items) {
    if (item?.type !== 'unparsed' || !item.payload?.body) continue;
    const key = smsTemplateKey(item.payload.body);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

/**
 * Resolves every open review item the given rules reject.
 * @returns {Promise<number>} Items resolved.
 */
export async function applyIgnoreRulesToOpenItems({ rules, writer, db }) {
  const active = ignoreRulesFrom(rules);
  if (active.length === 0) return 0;
  const matched = (await listReviewItems(db)).filter((item) => reviewItemMatches(item, active));
  if (matched.length === 0) return 0;
  await writer.writeMany(matched.map((item) => ({ type: 'review.resolved', data: { reviewId: item.id, decision: 'ignored' } })));
  for (const item of matched) {
    await db.exec('UPDATE review_queue SET status = ? WHERE id = ?;', ['resolved', item.id]);
  }
  return matched.length;
}

/** Saves a rule and clears the open review items it matches. */
export async function applyIgnoreRule({ rule, writer, db }) {
  await writer.write('rule.upserted', rule);
  return applyIgnoreRulesToOpenItems({ rules: [rule], writer, db });
}

/** Active expenses of exactly this payee. */
export function findSamePayee(expenses = [], merchant) {
  const target = normalizeName(merchant);
  if (!target) return [];
  return expenses.filter((e) => e && e.status !== 'deleted' && !e.deleted && normalizeName(e.merchant_raw) === target);
}

/** First rupee amount in a message, as plain digits, to pre-fill a manual entry the user confirms. */
export function extractAmountHint(body) {
  const m = String(body || '').match(/(?:inr|rs\.?|₹)\s*([\d,]+(?:\.\d{1,2})?)/i);
  return m ? m[1].replace(/,/g, '') : '';
}
