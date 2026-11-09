import { parseAmountToPaise, parseDateToken, parseTime12Token, toTxnTs } from '../normalize.js';
import { matchAccount } from '../accounts.js';
import { formatAccountKey, formatCompactDateTime } from '../keys.js';
import { registerParser } from '../registry.js';

// "Rs.<amt> toll paid at <PLAZA> on <dd-Mon-yyyy> <hh:mm:ss PM> for <VEHICLE> via FASTag. Bal Rs.<amt>. ... - IndusInd Bank"
const TOLL = /Rs\.?\s*(\d[\d,]*(?:\.\d+)?)\s+toll\s+paid\s+at\s+(.+?)\s+on\s+(\d{1,2}-[A-Za-z]{3}-\d{4})\s+(\d{1,2}:\d{2}:\d{2}\s*[AP]M)\s+for\s+(\w+)\s+via\s+FASTag/i;

export const indusindParser = {
  issuer: 'indusind',

  detect(flat) {
    return /indusind/i.test(flat);
  },

  parse({ flat }, ctx = {}) {
    const m = flat.match(TOLL);
    if (!m) return null;
    const amountPaise = parseAmountToPaise(m[1]);
    const date = parseDateToken(m[3]);
    const time = parseTime12Token(m[4]);
    if (!amountPaise || !date || !time) return null;

    const digits = m[5].slice(-4);
    const accountId = matchAccount('indusind', digits, ctx.accounts || []);
    return {
      issuer: 'indusind',
      accountId,
      accountHint: { issuer: 'indusind', digits, accountType: 'bank' },
      amountPaise,
      direction: 'debit',
      kind: 'spend',
      date,
      time,
      txnTs: toTxnTs(date, time),
      merchantRaw: m[2].trim(),
      mode: 'other',
      refNo: null,
      availLimitPaise: null,
      dedupeKey: `fp:${formatAccountKey(accountId, 'indusind', digits)}|${amountPaise}|${formatCompactDateTime(date, time)}`,
      linkHint: null,
      source: 'sms',
    };
  },
};

registerParser(indusindParser);
