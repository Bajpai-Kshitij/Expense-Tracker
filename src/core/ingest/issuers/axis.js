import { parseAmountToPaise, parseDateToken, parseTimeToken, toTxnTs } from '../normalize.js';
import { matchAccount } from '../accounts.js';
import { formatAccountKey, formatCompactDateTime } from '../keys.js';
import { registerParser } from '../registry.js';

export const axisParser = {
  issuer: 'axis',

  detect(flat) {
    return /axis\s*bank/i.test(flat);
  },

  parse({ lines, flat }, ctx = {}) {
    const accounts = ctx.accounts || [];

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

