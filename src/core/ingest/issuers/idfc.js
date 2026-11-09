import { parseAmountToPaise, parseDateToken, parseTime12Token, toTxnTs } from '../normalize.js';
import { matchAccount } from '../accounts.js';
import { formatAccountKey, formatCompactDateTime } from '../keys.js';
import { registerParser } from '../registry.js';

const AMT = '(\\d[\\d,]*(?:\\.\\d+)?)';
const DATE = '(\\d{1,2}[-\\s][A-Za-z]{3,9}[-\\s]\\d{4})';

// "<greeting> INR <amt> spent on your IDFC FIRST Bank Credit Card [ending ]XX<digits> at <MERCHANT> on <d Mon yyyy>[ at <h:mm PM>] Avbl|Available limit: INR <amt>"
const SPEND = new RegExp(`INR\\s*${AMT}\\s+spent\\s+on\\s+your\\s+IDFC\\s+FIRST\\s+Bank\\s+Credit\\s+Card\\s+(?:ending\\s+)?[X*]*(\\d{4})\\s+at\\s+(.+?)\\s+on\\s+${DATE}(?:\\s+at\\s+(\\d{1,2}:\\d{2}\\s*[AP]M))?\\s*\\.?\\s*(?:Avbl|Available)\\s+limit:?\\s*(?:INR|Rs\\.?)\\s*${AMT}`, 'i');
// "Thank you for payment of INR <amt> towards your FIRST <product> Credit Card XX<digits> on <d Mon yyyy>."
const PAYMENT = new RegExp(`payment\\s+of\\s+INR\\s*${AMT}\\s+towards\\s+your\\s+FIRST\\s+\\w+\\s+Credit\\s+Card\\s+[X*]*(\\d{4})\\s+on\\s+${DATE}`, 'i');

const toDate = (token) => {
  const [d, m, y] = token.trim().split(/[-\s]+/);
  return parseDateToken(`${d}-${m.slice(0, 3)}-${y}`);
};

export const idfcParser = {
  issuer: 'idfc',

  detect(flat) {
    return /IDFC\s+FIRST/i.test(flat);
  },

  parse({ flat }, ctx = {}) {
    const accounts = ctx.accounts || [];

    let m = flat.match(SPEND);
    if (m) {
      const amountPaise = parseAmountToPaise(m[1]);
      const digits = m[2];
      const date = toDate(m[4]);
      const time = m[5] ? parseTime12Token(m[5]) : null;
      const availLimitPaise = parseAmountToPaise(m[6]);
      if (!amountPaise || !date) return null;
      const accountId = matchAccount('idfc', digits, accounts);
      const avlPart = availLimitPaise !== null ? `|avl${availLimitPaise}` : '';
      return {
        issuer: 'idfc',
        accountId,
        accountHint: { issuer: 'idfc', digits },
        amountPaise,
        direction: 'debit',
        kind: 'spend',
        date,
        time,
        txnTs: toTxnTs(date, time),
        merchantRaw: m[3].trim(),
        mode: 'card',
        refNo: null,
        availLimitPaise,
        dedupeKey: `fp:${formatAccountKey(accountId, 'idfc', digits)}|${amountPaise}|${formatCompactDateTime(date, time)}${avlPart}`,
        linkHint: null,
        source: 'sms',
      };
    }

    m = flat.match(PAYMENT);
    if (m) {
      const amountPaise = parseAmountToPaise(m[1]);
      const digits = m[2];
      const date = toDate(m[3]);
      if (!amountPaise || !date) return null;
      const accountId = matchAccount('idfc', digits, accounts);
      return {
        issuer: 'idfc',
        accountId,
        accountHint: { issuer: 'idfc', digits },
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
        dedupeKey: `fp:${formatAccountKey(accountId, 'idfc', digits)}|${amountPaise}|${date.replace(/-/g, '')}|payrecv`,
        linkHint: { type: 'card_payment', side: 'card', cardLast4: digits },
        source: 'sms',
      };
    }

    return null;
  },
};

registerParser(idfcParser);
