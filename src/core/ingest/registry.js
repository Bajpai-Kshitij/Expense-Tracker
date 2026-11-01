import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { prepareBody } from './normalize.js';
import { IGNORE_RULES } from './ignoreRules.js';

const parsers = [];

/**
 * Registers an issuer parser.
 * 
 * @param {{ issuer: string, detect: (flat: string) => boolean, parse: (parsed: { lines: string[], flat: string }, ctx: object) => object|null }} parser 
 */
export function registerParser(parser) {
  if (parser && typeof parser.parse === 'function' && typeof parser.detect === 'function') {
    if (!parsers.some((p) => p.issuer === parser.issuer && p === parser)) {
      parsers.push(parser);
    }
  }
}

/**
 * Returns all currently registered parsers.
 */
export function getParsers() {
  return [...parsers];
}

/**
 * Computes SHA-256 hex digest of a string using noble/hashes.
 */
export function sha256Hex(str) {
  return bytesToHex(sha256(utf8ToBytes(String(str))));
}

/**
 * Parses an incoming SMS message.
 * 
 * @param {object} message { address, body, date }
 * @param {object} [ctx] { accounts }
 * @returns {{ status: 'parsed'|'ignored'|'unparsed'|'unknown', reason?: string, rawHash: string, txn?: object }}
 */
export function parseSms(message, ctx = {}) {
  try {
    if (!message || typeof message !== 'object') {
      return { status: 'unknown', reason: 'invalid_message', rawHash: '' };
    }

    const address = String(message.address || '');
    const date = message.date !== undefined && message.date !== null ? String(message.date) : '';
    const body = typeof message.body === 'string' ? message.body : '';

    const rawHash = sha256Hex(`${address}|${date}|${body}`);
    const { lines, flat } = prepareBody(body);

    if (!flat) {
      return { status: 'unknown', rawHash };
    }

    // 1. Check ignore rules in order BEFORE any parser
    for (const rule of IGNORE_RULES) {
      try {
        if (rule.test(flat)) {
          return { status: 'ignored', reason: rule.id, rawHash };
        }
      } catch (e) {
        // Continue to next rule if one throws
      }
    }

    // 2. Try detected parsers
    let hadDetectingParser = false;
    let parserHadError = false;

    for (const parser of parsers) {
      let detects = false;
      try {
        detects = Boolean(parser.detect(flat));
      } catch (err) {
        detects = false;
      }

      if (detects) {
        hadDetectingParser = true;
        try {
          const txn = parser.parse({ lines, flat }, ctx);
          if (txn && typeof txn === 'object') {
            return { status: 'parsed', rawHash, txn };
          }
        } catch (err) {
          parserHadError = true;
        }
      }
    }

    // 3. Classify remaining messages: unparsed vs unknown
    // Looks financial: contains an INR/Rs amount AND a word like debit, credit, spent, paid, payment, transaction, withdrawn, refund
    const hasAmount =
      /(?:inr|rs\.?)\s*[\d,]+(?:\.\d+)?|\b[\d,]+(?:\.\d{1,2})?\s*(?:inr|rs\.?)\b/i.test(flat);
    const hasFinancialKeyword =
      /\b(?:debit(?:ed)?|credit(?:ed)?|spent|paid|payment|transaction|withdrawn|refund)\b/i.test(
        flat
      );

    if (hasAmount && hasFinancialKeyword) {
      const reason = (hadDetectingParser || parserHadError) ? 'format_mismatch' : 'no_parser';
      return { status: 'unparsed', reason, rawHash };
    }

    return { status: 'unknown', rawHash };
  } catch (err) {
    // Top-level catch guarantee: never throw
    const fallbackHash = message?.body ? sha256Hex(String(message.body)) : '';
    return { status: 'unparsed', reason: 'format_mismatch', rawHash: fallbackHash };
  }
}

