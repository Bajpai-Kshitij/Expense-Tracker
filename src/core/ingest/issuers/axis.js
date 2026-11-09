import { parseAmountToPaise, parseDateToken, parseTimeToken, toTxnTs, isHouseholdName, istDateFromMs } from '../normalize.js';
import { matchAccount } from '../accounts.js';
import { formatAccountKey, formatCompactDateTime } from '../keys.js';
import { registerParser } from '../registry.js';

const AMT = '(\\d[\\d,]*(?:\\.\\d+)?)';
const DATE = '(\\d{1,2}[-/]\\d{1,2}[-/]\\d{2,4})';
const TIME = '(\\d{1,2}:\\d{2}:\\d{2})';

const SPENT_CARD = new RegExp(`^Spent\\s+Card\\s+no\\.?\\s+XX(\\d+)\\s+(?:INR|Rs\\.?)\\s*${AMT}\\s+${DATE}\\s+${TIME}(?:\\s+IST)?\\s+(.*?)\\s+Avl\\s+L(?:i)?m(?:i)?t:?\\s*(?:INR|Rs\\.?)\\s*${AMT}`, 'i');
const DEBIT_A = new RegExp(`^Debit\\s+(?:INR|Rs\\.?)\\s*${AMT}\\s+(?:Axis\\s+Bank\\s+)?A\\/c(?:\\s+no\\.?)?\\s+XX(\\d+)\\s+${DATE},?\\s+${TIME}(?:\\s+IST)?\\s+(.+?)(?:\\s+WhatsApp\\b|\\s+Chk\\s+Bal|\\s+Bal\\s+INR|\\s+Not\\s+You|\\s+\\S+\\s+Cust\\b)`, 'i');
const DEBIT_B = new RegExp(`^INR\\s*${AMT}\\s+debited\\s+A\\/c\\s+no\\.?\\s+XX(\\d+)\\s+${DATE},?\\s+${TIME}(?:\\s+IST)?\\s+(.+?)\\s+Not\\s+You`, 'i');
const UPI_CREDIT = new RegExp(`(?:INR|Rs\\.?)\\s*${AMT}\\s+credited\\s+to\\s+A\\/c\\s+no\\.?\\s+XX(\\d+)\\s+on\\s+${DATE}\\s+at\\s+${TIME}(?:\\s+IST)?\\.?\\s+Info\\s*-\\s*UPI\\/P2[AM]\\/(\\d{12})\\/([^/]*?)(?:\\/|\\s+-\\s+Axis|\\s+Chk)`, 'i');
const CARD_PAYMENT = new RegExp(`payment\\s+of\\s+Rs\\.?\\s*${AMT}\\s+towards\\s+your\\s+Axis\\s+Bank\\s+Credit\\s+Card\\s+X+(\\d{4})\\s+has\\s+been\\s+received\\s+on\\s+(\\d{1,2}-[A-Za-z]{3}-\\d{2,4})`, 'i');
const CASHBACK = new RegExp(`Cashback\\s+of\\s+INR\\s*${AMT}\\s+has\\s+been\\s+credited\\s+to\\s+your\\s+Axis\\s+Bank\\s+.*?Credit\\s+Card\\s+XX(\\d+)`, 'i');

function base(digits, accounts) {
  const accountId = matchAccount('axis', digits, accounts);
  return { issuer: 'axis', accountId, accountHint: { issuer: 'axis', digits }, accountKey: formatAccountKey(accountId, 'axis', digits) };
}

/** Classifies a bank-account debit narration; null sends the message to Review. */
function classifyNarration(narration, ownerNames) {
  const upi = narration.match(/^UPI\/P2[AM]\/(\d{12})\/([^/]*)/i);
  if (upi) {
    const payee = upi[2].trim();
    return { kind: isHouseholdName(payee, ownerNames) ? 'transfer' : 'spend', merchantRaw: payee, mode: 'upi', refNo: upi[1], linkHint: null };
  }
  if (narration.startsWith('CRD-PMNT-')) {
    const card = narration.match(/\*{2,4}(\d{4})/);
    return { kind: 'transfer', merchantRaw: '', mode: 'other', refNo: null, linkHint: { type: 'card_payment', side: 'bank', cardLast4: card ? card[1] : '' } };
  }
  if (narration.startsWith('ACH-DR-')) return { kind: 'fixed', merchantRaw: narration, mode: 'other', refNo: null, linkHint: null };
  if (/card\s*payment/i.test(narration)) return { kind: 'transfer', merchantRaw: narration, mode: 'other', refNo: null, linkHint: null };
  return null;
}

function parseLaterLayouts(flat, ctx, receivedAt) {
  const accounts = ctx.accounts || [];
  const ownerNames = ctx.ownerNames || [];

  let m = flat.match(SPENT_CARD);
  if (m) {
    const amountPaise = parseAmountToPaise(m[2]);
    const date = parseDateToken(m[3]);
    const time = parseTimeToken(m[4]);
    const availLimitPaise = parseAmountToPaise(m[6]);
    if (!amountPaise || !date || !time) return null;
    const { accountKey, ...acc } = base(m[1], accounts);
    return { ...acc, amountPaise, direction: 'debit', kind: 'spend', date, time, txnTs: toTxnTs(date, time), merchantRaw: m[5].trim(), mode: 'card', refNo: null, availLimitPaise, dedupeKey: `fp:${accountKey}|${amountPaise}|${formatCompactDateTime(date, time)}${availLimitPaise !== null ? `|avl${availLimitPaise}` : ''}`, linkHint: null, source: 'sms' };
  }

  m = flat.match(DEBIT_A) || flat.match(DEBIT_B);
  if (m) {
    const amountPaise = parseAmountToPaise(m[1]);
    const date = parseDateToken(m[3]);
    const time = parseTimeToken(m[4]);
    const narration = m[5].trim();
    const classified = classifyNarration(narration, ownerNames);
    if (!amountPaise || !date || !time || !classified) return null;
    const { accountKey, ...acc } = base(m[2], accounts);
    const dedupeKey = classified.refNo ? `ref:${classified.refNo}` : `fp:${accountKey}|${amountPaise}|${formatCompactDateTime(date, time)}|${narration.split(/\s+/)[0]}`;
    return { ...acc, amountPaise, direction: 'debit', date, time, txnTs: toTxnTs(date, time), availLimitPaise: null, dedupeKey, source: 'sms', ...classified };
  }

  m = flat.match(UPI_CREDIT);
  if (m) {
    const amountPaise = parseAmountToPaise(m[1]);
    const date = parseDateToken(m[3]);
    const time = parseTimeToken(m[4]);
    const party = m[6].trim();
    if (!amountPaise || !date || !time) return null;
    const { accountKey, ...acc } = base(m[2], accounts);
    return { ...acc, amountPaise, direction: 'credit', kind: isHouseholdName(party, ownerNames) ? 'transfer' : 'income', date, time, txnTs: toTxnTs(date, time), merchantRaw: party, mode: 'upi', refNo: m[5], availLimitPaise: null, dedupeKey: `ref:${m[5]}`, linkHint: null, source: 'sms' };
  }

  m = flat.match(CARD_PAYMENT);
  if (m) {
    const amountPaise = parseAmountToPaise(m[1]);
    const date = parseDateToken(m[3]);
    if (!amountPaise || !date) return null;
    const { accountKey, ...acc } = base(m[2], accounts);
    return { ...acc, amountPaise, direction: 'credit', kind: 'transfer', date, time: null, txnTs: null, merchantRaw: '', mode: 'other', refNo: null, availLimitPaise: null, dedupeKey: `fp:${accountKey}|${amountPaise}|${date.replace(/-/g, '')}|payrecv`, linkHint: { type: 'card_payment', side: 'card', cardLast4: m[2] }, source: 'sms' };
  }

  m = flat.match(CASHBACK);
  if (m && receivedAt) {
    const amountPaise = parseAmountToPaise(m[1]);
    const date = istDateFromMs(receivedAt);
    if (!amountPaise) return null;
    const { accountKey, ...acc } = base(m[2], accounts);
    return { ...acc, amountPaise, direction: 'credit', kind: 'income', date, time: null, txnTs: null, merchantRaw: 'Cashback', mode: 'other', refNo: null, availLimitPaise: null, dedupeKey: `fp:${accountKey}|${amountPaise}|${date.replace(/-/g, '')}|cashback`, linkHint: null, source: 'sms' };
  }

  return null;
}

export const axisParser = {
  issuer: 'axis',

  detect(flat) {
    return /axis\s*bank/i.test(flat);
  },

  parse({ lines, flat, receivedAt }, ctx = {}) {
    const accounts = ctx.accounts || [];

    const later = parseLaterLayouts(flat, ctx, receivedAt);
    if (later) return later;

    // Layout A: Multi-line Card Spend
    // Lines format:
    // Spent INR <amt>
    // Axis Bank Card no. XX<digits>
    // <dd-mm-yy hh:mm:ss> IST
    // <MERCHANT>
    // Avl Limit: INR <amt>
    if (lines.length >= 4) {
      const line0 = lines[0].match(/^Spent\s+(?:INR|Rs\.?)\s*([\d,.]+)/i);
      const line1 = lines[1].match(/^Axis\s+Bank\s+Card(?:\s+no\.?)?\s+XX(\d+)/i);
      const line2 = lines[2].match(/^(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\s+(\d{1,2}:\d{2}:\d{2})(?:\s+IST)?/i);

      if (line0 && line1 && line2) {
        const amountPaise = parseAmountToPaise(line0[1]);
        const digits = line1[1];
        const date = parseDateToken(line2[1]);
        const time = parseTimeToken(line2[2]);
        const merchantRaw = lines[3].trim().replace(/\.+$/, '').trim();

        let availLimitPaise = null;
        if (lines.length >= 5) {
          const avlMatch = lines[4].match(/Avl\s+Limit:?\s*(?:INR|Rs\.?)\s*([\d,.]+)/i);
          if (avlMatch) {
            availLimitPaise = parseAmountToPaise(avlMatch[1]);
          }
        }

        if (amountPaise && date && time) {
          const accountId = matchAccount('axis', digits, accounts);
          const accountKey = formatAccountKey(accountId, 'axis', digits);
          const compactTs = formatCompactDateTime(date, time);
          const avlPart = availLimitPaise !== null ? `|avl${availLimitPaise}` : '';
          const dedupeKey = `fp:${accountKey}|${amountPaise}|${compactTs}${avlPart}`;

          return {
            issuer: 'axis',
            accountId,
            accountHint: { issuer: 'axis', digits },
            amountPaise,
            direction: 'debit',
            kind: 'spend',
            date,
            time,
            txnTs: toTxnTs(date, time),
            merchantRaw,
            mode: 'card',
            refNo: null,
            availLimitPaise,
            dedupeKey,
            linkHint: null,
            source: 'sms',
          };
        }
      }
    }

    // Layout A flattened or Layout B: Single-sentence Card Spend
    // e.g. Spent INR 210 using Axis Bank Credit Card no. XX3765 on 29-10-26 12:09:17 IST at SWIGGY PVT. Avl limit: ...
    const singleMatch = flat.match(
      /Spent\s+(?:INR|Rs\.?)\s*([\d,.]+)\s+using\s+Axis\s+Bank(?:\s+Credit)?\s+Card(?:\s+no\.?)?\s+XX(\d+)\s+on\s+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\s+(\d{1,2}:\d{2}:\d{2})(?:\s+IST)?\s+at\s+(.*?)(?:\.\s*Avl\s+limit|\s+Avl\s+limit|\.$)/i
    );
    if (singleMatch) {
      const amountPaise = parseAmountToPaise(singleMatch[1]);
      const digits = singleMatch[2];
      const date = parseDateToken(singleMatch[3]);
      const time = parseTimeToken(singleMatch[4]);
      const merchantRaw = singleMatch[5].trim().replace(/\.+$/, '').trim();

      const avlMatch = flat.match(/Avl\s+limit:?\s*(?:INR|Rs\.?)\s*([\d,.]+)/i);
      const availLimitPaise = avlMatch ? parseAmountToPaise(avlMatch[1]) : null;

      if (amountPaise && date && time) {
        const accountId = matchAccount('axis', digits, accounts);
        const accountKey = formatAccountKey(accountId, 'axis', digits);
        const compactTs = formatCompactDateTime(date, time);
        const avlPart = availLimitPaise !== null ? `|avl${availLimitPaise}` : '';
        const dedupeKey = `fp:${accountKey}|${amountPaise}|${compactTs}${avlPart}`;

        return {
          issuer: 'axis',
          accountId,
          accountHint: { issuer: 'axis', digits },
          amountPaise,
          direction: 'debit',
          kind: 'spend',
          date,
          time,
          txnTs: toTxnTs(date, time),
          merchantRaw,
          mode: 'card',
          refNo: null,
          availLimitPaise,
          dedupeKey,
          linkHint: null,
          source: 'sms',
        };
      }
    }

    // Layout A fallback on flat text (e.g. multi-line spend flattened onto one line)
    const multiFlatMatch = flat.match(
      /Spent\s+(?:INR|Rs\.?)\s*([\d,.]+)\s+Axis\s+Bank\s+Card(?:\s+no\.?)?\s+XX(\d+)\s+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\s+(\d{1,2}:\d{2}:\d{2})(?:\s+IST)?\s+(.*?)\s+Avl\s+Limit:?\s*(?:INR|Rs\.?)\s*([\d,.]+)/i
    );
    if (multiFlatMatch) {
      const amountPaise = parseAmountToPaise(multiFlatMatch[1]);
      const digits = multiFlatMatch[2];
      const date = parseDateToken(multiFlatMatch[3]);
      const time = parseTimeToken(multiFlatMatch[4]);
      const merchantRaw = multiFlatMatch[5].trim().replace(/\.+$/, '').trim();
      const availLimitPaise = parseAmountToPaise(multiFlatMatch[6]);

      if (amountPaise && date && time) {
        const accountId = matchAccount('axis', digits, accounts);
        const accountKey = formatAccountKey(accountId, 'axis', digits);
        const compactTs = formatCompactDateTime(date, time);
        const avlPart = availLimitPaise !== null ? `|avl${availLimitPaise}` : '';
        const dedupeKey = `fp:${accountKey}|${amountPaise}|${compactTs}${avlPart}`;

        return {
          issuer: 'axis',
          accountId,
          accountHint: { issuer: 'axis', digits },
          amountPaise,
          direction: 'debit',
          kind: 'spend',
          date,
          time,
          txnTs: toTxnTs(date, time),
          merchantRaw,
          mode: 'card',
          refNo: null,
          availLimitPaise,
          dedupeKey,
          linkHint: null,
          source: 'sms',
        };
      }
    }

    // Layout C: Account Debit
    // Lines format:
    // Debit INR <amt>
    // Axis Bank A/c XX<digits>
    // <dd-mm-yy hh:mm:ss>
    // <NARRATION>
    // WhatsApp BAL ... / Not You? ...
    if (lines.length >= 4) {
      const line0 = lines[0].match(/^Debit\s+(?:INR|Rs\.?)\s*([\d,.]+)/i);
      const line1 = lines[1].match(/^Axis\s+Bank\s+A\/c\s+XX(\d+)/i);
      const line2 = lines[2].match(/^(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\s+(\d{1,2}:\d{2}:\d{2})(?:\s+IST)?/i);

      if (line0 && line1 && line2) {
        const amountPaise = parseAmountToPaise(line0[1]);
        const digits = line1[1];
        const date = parseDateToken(line2[1]);
        const time = parseTimeToken(line2[2]);
        const narration = lines[3].trim();

        if (amountPaise && date && time && narration) {
          let kind = null;
          let linkHint = null;
          let merchantRaw = '';

          if (narration.startsWith('CRD-PMNT-')) {
            kind = 'transfer';
            const cardMatch = narration.match(/\*{2,4}(\d{4})/);
            linkHint = {
              type: 'card_payment',
              side: 'bank',
              cardLast4: cardMatch ? cardMatch[1] : '',
            };
          } else if (narration.startsWith('ACH-DR-')) {
            kind = 'fixed';
            merchantRaw = narration;
          } else {
            // Unrecognized narration layout -> return null to signal unparsed format_mismatch
            return null;
          }

          const accountId = matchAccount('axis', digits, accounts);
          const accountKey = formatAccountKey(accountId, 'axis', digits);
          const compactTs = formatCompactDateTime(date, time);
          const firstToken = narration.split(/\s+/)[0];
          const dedupeKey = `fp:${accountKey}|${amountPaise}|${compactTs}|${firstToken}`;

          return {
            issuer: 'axis',
            accountId,
            accountHint: { issuer: 'axis', digits },
            amountPaise,
            direction: 'debit',
            kind,
            date,
            time,
            txnTs: toTxnTs(date, time),
            merchantRaw,
            mode: 'other',
            refNo: null,
            availLimitPaise: null,
            dedupeKey,
            linkHint,
            source: 'sms',
          };
        }
      }
    }

    // Layout C fallback on flat text (flattened debit message)
    const debitFlatMatch = flat.match(
      /Debit\s+(?:INR|Rs\.?)\s*([\d,.]+)\s+Axis\s+Bank\s+A\/c\s+XX(\d+)\s+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\s+(\d{1,2}:\d{2}:\d{2})(?:\s+IST)?\s+(.*?)(?:\s+WhatsApp\s+BAL|\s+Not\s+You|\.$)/i
    );
    if (debitFlatMatch) {
      const amountPaise = parseAmountToPaise(debitFlatMatch[1]);
      const digits = debitFlatMatch[2];
      const date = parseDateToken(debitFlatMatch[3]);
      const time = parseTimeToken(debitFlatMatch[4]);
      const narration = debitFlatMatch[5].trim();

      if (amountPaise && date && time && narration) {
        let kind = null;
        let linkHint = null;
        let merchantRaw = '';

        if (narration.startsWith('CRD-PMNT-')) {
          kind = 'transfer';
          const cardMatch = narration.match(/\*{2,4}(\d{4})/);
          linkHint = {
            type: 'card_payment',
            side: 'bank',
            cardLast4: cardMatch ? cardMatch[1] : '',
          };
        } else if (narration.startsWith('ACH-DR-')) {
          kind = 'fixed';
          merchantRaw = narration;
        } else {
          return null;
        }

        const accountId = matchAccount('axis', digits, accounts);
        const accountKey = formatAccountKey(accountId, 'axis', digits);
        const compactTs = formatCompactDateTime(date, time);
        const firstToken = narration.split(/\s+/)[0];
        const dedupeKey = `fp:${accountKey}|${amountPaise}|${compactTs}|${firstToken}`;

        return {
          issuer: 'axis',
          accountId,
          accountHint: { issuer: 'axis', digits },
          amountPaise,
          direction: 'debit',
          kind,
          date,
          time,
          txnTs: toTxnTs(date, time),
          merchantRaw,
          mode: 'other',
          refNo: null,
          availLimitPaise: null,
          dedupeKey,
          linkHint,
          source: 'sms',
        };
      }
    }

    // Layout D: Account Credit
    // Layout 1: "INR <amt> credited to Axis Bank A/c XX<digits> on <dd-mm-yy> at <hh:mm:ss> IST. Ref: <ref>. View bal: ..."
    // Layout 2: "INR <amt> credited to A/c no. XX<digits> on <dd-mm-yy> at <hh:mm:ss> IST. Info - <ref>. Chk Bal ... - Axis Bank"
    const creditMatch = flat.match(
      /(?:INR|Rs\.?)\s*([\d,.]+)\s+credited\s+to\s+(?:Axis\s+Bank\s+A\/c|A\/c\s+no\.)\s+XX(\d+)\s+on\s+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\s+at\s+(\d{1,2}:\d{2}:\d{2})(?:\s+IST)?\.?\s+(?:Ref:?|Info\s*-)\s*([A-Za-z0-9_\/-]+)/i
    );
    if (creditMatch) {
      const amountPaise = parseAmountToPaise(creditMatch[1]);
      const digits = creditMatch[2];
      const date = parseDateToken(creditMatch[3]);
      const time = parseTimeToken(creditMatch[4]);
      const rawRef = creditMatch[5].trim();

      // Only valid if ref starts with NEFT/, IMPS/ or RTGS/
      if (/^(?:NEFT|IMPS|RTGS)\//i.test(rawRef)) {
        const refNo = rawRef;
        const accountId = matchAccount('axis', digits, accounts);

        if (amountPaise && date && time) {
          return {
            issuer: 'axis',
            accountId,
            accountHint: { issuer: 'axis', digits },
            amountPaise,
            direction: 'credit',
            kind: 'income',
            date,
            time,
            txnTs: toTxnTs(date, time),
            merchantRaw: '',
            mode: 'netbanking',
            refNo,
            availLimitPaise: null,
            dedupeKey: `ref:${refNo}`,
            linkHint: null,
            source: 'sms',
          };
        }
      } else {
        return null;
      }
    }

    // Layout E: Card Bill Payment Received
    // "Payment of INR <amt> has been received towards your Axis Bank Credit Card XX<digits> on <dd-mm-yy> - Axis Bank"
    const payRecvMatch = flat.match(
      /Payment\s+of\s+(?:INR|Rs\.?)\s*([\d,.]+)\s+has\s+been\s+received\s+towards\s+your\s+Axis\s+Bank\s+Credit\s+Card\s+XX(\d+)\s+on\s+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i
    );
    if (payRecvMatch) {
      const amountPaise = parseAmountToPaise(payRecvMatch[1]);
      const digits = payRecvMatch[2];
      const date = parseDateToken(payRecvMatch[3]);

      if (amountPaise && date) {
        const accountId = matchAccount('axis', digits, accounts);
        const accountKey = formatAccountKey(accountId, 'axis', digits);
        const yyyymmdd = date.replace(/-/g, '');
        const dedupeKey = `fp:${accountKey}|${amountPaise}|${yyyymmdd}|payrecv`;

        return {
          issuer: 'axis',
          accountId,
          accountHint: { issuer: 'axis', digits },
          amountPaise,
          direction: 'credit',
          kind: 'transfer',
          date,
          time: null,
          txnTs: null,
          merchantRaw: '',
          mode: 'other',
          refNo: null,
          availLimitPaise: null,
          dedupeKey,
          linkHint: {
            type: 'card_payment',
            side: 'card',
            cardLast4: digits,
          },
          source: 'sms',
        };
      }
    }

    return null;
  },
};

// Register Axis parser
registerParser(axisParser);

