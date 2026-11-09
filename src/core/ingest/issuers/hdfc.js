import { parseAmountToPaise, parseDateToken, parseTimeToken, toTxnTs, isHouseholdName } from '../normalize.js';
import { matchAccount } from '../accounts.js';
import { formatAccountKey } from '../keys.js';
import { registerParser } from '../registry.js';

// "Amt Sent" messages give only dd-mm; the year comes from when the SMS arrived.
function resolveDate(token, receivedAt) {
  const short = token.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!short) return parseDateToken(token);
  if (!receivedAt) return null;
  const received = receivedAt + 19800000; // IST
  let year = new Date(received).getUTCFullYear();
  if (Date.UTC(year, Number(short[2]) - 1, Number(short[1])) > received + 86400000) year -= 1;
  return parseDateToken(`${short[1]}-${short[2]}-${year}`);
}

function bankCredit({ amount, digits, dateToken, vpa, refNo, accounts }) {
  const amountPaise = parseAmountToPaise(amount);
  const date = parseDateToken(dateToken);
  if (!amountPaise || !date) return null;
  return {
    issuer: 'hdfc',
    accountId: matchAccount('hdfc', digits, accounts),
    accountHint: { issuer: 'hdfc', digits, accountType: 'bank' },
    amountPaise,
    direction: 'credit',
    kind: 'income',
    date,
    time: null,
    txnTs: null,
    merchantRaw: vpa,
    mode: 'upi',
    refNo,
    availLimitPaise: null,
    dedupeKey: `ref:${refNo}`,
    linkHint: null,
    source: 'sms',
  };
}

export const hdfcParser = {
  issuer: 'hdfc',

  detect(flat) {
    return /hdfc\s*bank/i.test(flat);
  },

  parse({ lines, flat, receivedAt }, ctx = {}) {
    const accounts = ctx.accounts || [];

    // Layout E: "Payment of Rs <amt> received towards HDFC Bank <PRODUCT> Credit Card on <dd/mm/yy> <hh:mm>."
    const cardPayment = flat.match(
      /Payment\s+of\s+Rs\.?\s*(\d[\d,]*(?:\.\d+)?)\s+received\s+towards\s+HDFC\s+Bank\s+(.+?)\s+Credit\s+Card\s+on\s+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})/i
    );
    if (cardPayment) {
      const amountPaise = parseAmountToPaise(cardPayment[1]);
      const product = cardPayment[2].trim();
      const date = parseDateToken(cardPayment[3]);
      if (!amountPaise || !date) return null;
      const wanted = product.toLowerCase().replace(/\s+/g, ' ');
      const matches = accounts.filter((a) => a.issuer?.toLowerCase() === 'hdfc' && (a.name || '').toLowerCase().replace(/\s+/g, ' ').includes(wanted));
      const accountId = matches.length === 1 ? matches[0].id : null;
      return {
        issuer: 'hdfc',
        accountId,
        accountHint: { issuer: 'hdfc', digits: null, product },
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
        dedupeKey: `fp:${formatAccountKey(accountId, 'hdfc', product)}|${amountPaise}|${date.replace(/-/g, '')}|payrecv`,
        linkHint: null,
        source: 'sms',
      };
    }

    // Layout C: "Credit Alert! Rs.<amt> credited to HDFC Bank A/c XX<digits> on <dd-mm-yy> from VPA <id> (UPI <12 digits>)"
    const alert = flat.match(
      /Rs\.?\s*([\d,.]+)\s+credited\s+to\s+HDFC\s+Bank\s+A\/c\s+[X*]*(\d{3,4})\s+on\s+(\d{1,2}-\d{1,2}-\d{2,4})\s+from\s+VPA\s+(\S+)\s+\(UPI\s+(\d{12})\)/i
    );
    if (alert) {
      return bankCredit({ amount: alert[1], digits: alert[2], dateToken: alert[3], vpa: alert[4], refNo: alert[5], accounts });
    }

    // Layout D: "HDFC Bank: Rs. <amt> credited to a/c XX<digits> on <dd-mm-yy> by a/c linked to VPA <id> (UPI Ref No <12 digits>)."
    const linked = flat.match(
      /Rs\.?\s*([\d,.]+)\s+credited\s+to\s+a\/c\s+[X*]*(\d{3,4})\s+on\s+(\d{1,2}-\d{1,2}-\d{2,4})\s+by\s+a\/c\s+linked\s+to\s+VPA\s+(\S+)\s+\(UPI\s+Ref\s+No\s+(\d{12})\)/i
    );
    if (linked) {
      return bankCredit({ amount: linked[1], digits: linked[2], dateToken: linked[3], vpa: linked[4], refNo: linked[5], accounts });
    }

    // Layout B: Bank account UPI payment
    // "[Amt ]Sent Rs.<amt> From HDFC Bank A/C *<digits> To <PAYEE> On <dd/mm/yy or dd-mm> Ref <12 digits> Not You? ..."
    const sent = flat.match(
      /Sent\s+Rs\.?\s*([\d,.]+)\s+From\s+HDFC\s+Bank\s+A\/C\s+[*X]*(\d{3,4})\s+To\s+(.+?)\s+On\s+(\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?)\s+Ref\s+(\d{12})/i
    );
    if (sent) {
      const amountPaise = parseAmountToPaise(sent[1]);
      const digits = sent[2];
      const payee = sent[3].trim();
      const date = resolveDate(sent[4], receivedAt);
      const refNo = sent[5];
      if (!amountPaise || !date) return null;

      return {
        issuer: 'hdfc',
        accountId: matchAccount('hdfc', digits, accounts),
        accountHint: { issuer: 'hdfc', digits, accountType: 'bank' },
        amountPaise,
        direction: 'debit',
        kind: isHouseholdName(payee, ctx.ownerNames || []) ? 'transfer' : 'spend',
        date,
        time: null,
        txnTs: null,
        merchantRaw: payee,
        mode: 'upi',
        refNo,
        availLimitPaise: null,
        dedupeKey: `ref:${refNo}`,
        linkHint: null,
        source: 'sms',
      };
    }

    // Layout A: Card UPI spend
    // "A transaction of Rs. <amt> was made using your HDFC Bank <PRODUCT> Credit Card at <PAYEE> via UPI <12 digits> on <dd/mm/yy> at <hh:mm>. Not you? Block your Card: <url> or SMS BLOCKPCC <digits> to <phone>"
    const match = flat.match(
      /A\s+transaction\s+of\s+(?:Rs\.?|INR)\s*([\d,.]+)\s+was\s+made\s+using\s+your\s+HDFC\s+Bank\s+(.+?)\s+Credit\s+Card\s+at\s+(.+?)\s+via\s+UPI\s+(\d{12})\s+on\s+(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})\s+at\s+(\d{1,2}:\d{2}(?::\d{2})?)/i
    );

    if (!match) {
      return null;
    }

    const amountPaise = parseAmountToPaise(match[1]);
    const product = match[2].trim();
    const merchantRaw = match[3].trim();
    const refNo = match[4].trim();
    const date = parseDateToken(match[5]);
    const time = parseTimeToken(match[6]);

    if (!amountPaise || !date || !time) {
      return null;
    }

    const txnTs = toTxnTs(date, time);

    // Account matching by product name (not digits)
    const cleanProduct = product.toLowerCase().replace(/\s+/g, ' ');
    const matchingAccounts = accounts.filter((acc) => {
      if (!acc.issuer || acc.issuer.toLowerCase() !== 'hdfc') return false;
      const accName = (acc.name || '').toLowerCase().replace(/\s+/g, ' ');
      return accName.includes(cleanProduct);
    });

    let accountId = null;
    if (matchingAccounts.length === 1) {
      accountId = matchingAccounts[0].id;
    }

    const dedupeKey = `ref:${refNo}`;

    return {
      issuer: 'hdfc',
      accountId,
      accountHint: { issuer: 'hdfc', digits: null, product },
      amountPaise,
      direction: 'debit',
      kind: 'spend',
      date,
      time,
      txnTs,
      merchantRaw,
      mode: 'upi',
      refNo,
      availLimitPaise: null,
      dedupeKey,
      linkHint: null,
      source: 'sms',
    };
  },
};

registerParser(hdfcParser);

