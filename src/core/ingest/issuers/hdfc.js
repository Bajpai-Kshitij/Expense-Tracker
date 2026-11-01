import { parseAmountToPaise, parseDateToken, parseTimeToken, toTxnTs } from '../normalize.js';
import { registerParser } from '../registry.js';

export const hdfcParser = {
  issuer: 'hdfc',

  detect(flat) {
    return /hdfc\s*bank/i.test(flat);
  },

  parse({ lines, flat }, ctx = {}) {
    const accounts = ctx.accounts || [];

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

