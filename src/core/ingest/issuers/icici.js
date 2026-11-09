import { parseAmountToPaise, parseDateToken, isHouseholdName } from '../normalize.js';
import { matchAccount } from '../accounts.js';
import { formatAccountKey } from '../keys.js';
import { registerParser } from '../registry.js';

export const iciciParser = {
  issuer: 'icici',

  detect(flat) {
    return /icici\s*bank/i.test(flat);
  },

  parse({ lines, flat }, ctx = {}) {
    const accounts = ctx.accounts || [];
    const ownerNames = ctx.ownerNames || [];

    // "<INR|Rs> <amt> spent on ICICI Bank Card XX<4 digits> on <dd-Mon-yy> at <MERCHANT>. Avl Lmt: <INR|Rs> <amt>."
    const spentOn = flat.match(
      /(?:INR|Rs\.?)\s*(\d[\d,]*(?:\.\d+)?)\s+spent\s+on\s+ICICI\s+Bank\s+Card\s+XX(\d{4})\s+on\s+(\d{1,2}[-/][a-zA-Z]{3}[-/]\d{2,4})\s+at\s+(.*?)\.\s*Avl\s+Lmt:?\s*(?:INR|Rs\.?)\s*(\d[\d,]*(?:\.\d+)?)/i
    );
    if (spentOn) {
      const amountPaise = parseAmountToPaise(spentOn[1]);
      const digits = spentOn[2];
      const date = parseDateToken(spentOn[3]);
      const availLimitPaise = parseAmountToPaise(spentOn[5]);
      if (amountPaise && date) {
        const accountId = matchAccount('icici', digits, accounts);
        const accountKey = formatAccountKey(accountId, 'icici', digits);
        return {
          issuer: 'icici',
          accountId,
          accountHint: { issuer: 'icici', digits },
          amountPaise,
          direction: 'debit',
          kind: 'spend',
          date,
          time: null,
          txnTs: null,
          merchantRaw: spentOn[4].trim(),
          mode: 'card',
          refNo: null,
          availLimitPaise,
          dedupeKey: `fp:${accountKey}|${amountPaise}|${date.replace(/-/g, '')}|avl${availLimitPaise}`,
          linkHint: null,
          source: 'sms',
        };
      }
    }

    // "ICICI Bank Acc XX<digits> debited Rs. <amt> on <dd-Mon-yy> InfoATD*Auto Debi.Avl Bal ..." is a card bill auto debit.
    // Other Info codes (BIL*BPAY and so on) name no payee, so they stay in Review.
    const autoDebit = flat.match(
      /ICICI\s+Bank\s+Acc\s+XX(\d{3,4})\s+debited\s+Rs\.?\s*(\d[\d,]*(?:\.\d+)?)\s+on\s+(\d{1,2}[-/][a-zA-Z]{3}[-/]\d{2,4})\s+InfoATD\*/i
    );
    if (autoDebit) {
      const digits = autoDebit[1];
      const amountPaise = parseAmountToPaise(autoDebit[2]);
      const date = parseDateToken(autoDebit[3]);
      if (amountPaise && date) {
        const accountId = matchAccount('icici', digits, accounts);
        return {
          issuer: 'icici',
          accountId,
          accountHint: { issuer: 'icici', digits, accountType: 'bank' },
          amountPaise,
          direction: 'debit',
          kind: 'transfer',
          date,
          time: null,
          txnTs: null,
          merchantRaw: 'Card auto debit',
          mode: 'other',
          refNo: null,
          availLimitPaise: null,
          dedupeKey: `fp:${formatAccountKey(accountId, 'icici', digits)}|${amountPaise}|${date.replace(/-/g, '')}|atd`,
          linkHint: null,
          source: 'sms',
        };
      }
    }

    // "Payment of INR <amt> has been received on your ICICI Bank Credit Card Account <n>xxx<4 digits> on <dd-Mon-yy>."
    const cardPayment = flat.match(
      /Payment\s+of\s+(?:INR|Rs\.?)\s*(\d[\d,]*(?:\.\d+)?)\s+has\s+been\s+received\s+on\s+your\s+ICICI\s+Bank\s+Credit\s+Card\s+Account\s+\S*?(\d{4})\s+on\s+(\d{1,2}[-/][a-zA-Z]{3}[-/]\d{2,4})/i
    );
    if (cardPayment) {
      const amountPaise = parseAmountToPaise(cardPayment[1]);
      const digits = cardPayment[2];
      const date = parseDateToken(cardPayment[3]);
      if (amountPaise && date) {
        const accountId = matchAccount('icici', digits, accounts);
        return {
          issuer: 'icici',
          accountId,
          accountHint: { issuer: 'icici', digits },
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
          dedupeKey: `fp:${formatAccountKey(accountId, 'icici', digits)}|${amountPaise}|${date.replace(/-/g, '')}|payrecv`,
          linkHint: { type: 'card_payment', side: 'card', cardLast4: digits },
          source: 'sms',
        };
      }
    }

    // Layout A: Card Spend
    // "INR <amt> spent using ICICI Bank Card XX<4 digits> on <dd-Mon-yy> on <MERCHANT>. Avl Limit: INR <amt>. If not you, call ..."
    const spendMatch = flat.match(
      /(?:INR|Rs\.?)\s*([\d,.]+)\s+spent\s+using\s+ICICI\s+Bank\s+Card\s+XX(\d{4})\s+on\s+(\d{1,2}[-/][a-zA-Z]{3}[-/]\d{2,4})\s+on\s+(.*?)(?:\.\s*Avl\s+Limit:?\s*(?:INR|Rs\.?)\s*([\d,.]+))/i
    );
    if (spendMatch) {
      const amountPaise = parseAmountToPaise(spendMatch[1]);
      const digits = spendMatch[2];
      const date = parseDateToken(spendMatch[3]);
      const merchantRaw = spendMatch[4].trim().replace(/\.+$/, '').trim();
      const availLimitPaise = parseAmountToPaise(spendMatch[5]);

      if (amountPaise && date) {
        const accountId = matchAccount('icici', digits, accounts);
        const accountKey = formatAccountKey(accountId, 'icici', digits);
        const yyyymmdd = date.replace(/-/g, '');
        const avlPart = availLimitPaise !== null ? `|avl${availLimitPaise}` : '';
        const dedupeKey = `fp:${accountKey}|${amountPaise}|${yyyymmdd}${avlPart}`;

        return {
          issuer: 'icici',
          accountId,
          accountHint: { issuer: 'icici', digits },
          amountPaise,
          direction: 'debit',
          kind: 'spend',
          date,
          time: null,
          txnTs: null,
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

    // Layout B: Savings Account Debit through UPI
    // "ICICI Bank Acct XX<3 or 4 digits> debited for Rs <amt> on <dd-Mon-yy>; <PAYEE> credited. UPI:<12 digits>. Call ..."
    const upiMatch = flat.match(
      /ICICI\s+Bank\s+Acct\s+XX(\d{3,4})\s+debited\s+for\s+(?:Rs\.?|INR)\s*([\d,.]+)\s+on\s+(\d{1,2}[-/][a-zA-Z]{3}[-/]\d{2,4})[;,]\s+(.*?)\s+credited\.\s+UPI:?\s*(\d{12})/i
    );
    if (upiMatch) {
      const digits = upiMatch[1];
      const amountPaise = parseAmountToPaise(upiMatch[2]);
      const date = parseDateToken(upiMatch[3]);
      const payee = upiMatch[4].trim();
      const refNo = upiMatch[5].trim();

      if (amountPaise && date) {
        const accountId = matchAccount('icici', digits, accounts);
        const isWallet = /^amazon\s+pay/i.test(payee);
        const isHousehold = isHouseholdName(payee, ownerNames);
        const kind = (isWallet || isHousehold) ? 'transfer' : 'spend';

        return {
          issuer: 'icici',
          accountId,
          accountHint: { issuer: 'icici', digits },
          amountPaise,
          direction: 'debit',
          kind,
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
    }

    // Layout C: Savings Account Debit, UPI Mandate
    // "Rs <amt> debited from ICICI Bank Savings Account XX<3 or 4 digits> on <dd-Mon-yy> towards <NAME> for UPI Mandate AutoPay Retrieval Ref No.<12 digits>"
    const mandateMatch = flat.match(
      /(?:Rs\.?|INR)\s*([\d,.]+)\s+debited\s+from\s+ICICI\s+Bank\s+Savings\s+Account\s+XX(\d{3,4})\s+on\s+(\d{1,2}[-/][a-zA-Z]{3}[-/]\d{2,4})\s+towards\s+(.*?)\s+for\s+(?:UPI\s+Mandate|MERCHANTMANDATE|Subscription\s+for)\s+AutoPay\s+Retrieval\s+Ref\s+No\.?\s*(\d{12})/i
    );
    if (mandateMatch) {
      const amountPaise = parseAmountToPaise(mandateMatch[1]);
      const digits = mandateMatch[2];
      const date = parseDateToken(mandateMatch[3]);
      const name = mandateMatch[4].trim();
      const refNo = mandateMatch[5].trim();

      if (amountPaise && date) {
        const accountId = matchAccount('icici', digits, accounts);
        const isSelf = isHouseholdName(name, ownerNames);
        const kind = isSelf ? 'transfer' : 'fixed';

        return {
          issuer: 'icici',
          accountId,
          accountHint: { issuer: 'icici', digits },
          amountPaise,
          direction: 'debit',
          kind,
          date,
          time: null,
          txnTs: null,
          merchantRaw: name,
          mode: 'upi',
          refNo,
          availLimitPaise: null,
          dedupeKey: `ref:${refNo}`,
          linkHint: null,
          source: 'sms',
        };
      }
    }

    // Layout D: Card Refund / Credit
    // "<MERCHANT> refund of Rs <amt> credited to ICICI Bank Credit Card XX<4 digits> on <dd-MON-yy>. Revised total due Rs <amt>, minimum due Rs <amt>"
    const refundMatch = flat.match(
      /(.*?)\s+refund\s+of\s+(?:Rs\.?|INR)\s*([\d,.]+)\s+credited\s+to\s+ICICI\s+Bank\s+Credit\s+Card\s+XX(\d{4})\s+on\s+(\d{1,2}[-/][a-zA-Z]{3}[-/]\d{2,4})/i
    );
    if (refundMatch) {
      const merchantRaw = refundMatch[1].trim();
      const amountPaise = parseAmountToPaise(refundMatch[2]);
      const digits = refundMatch[3];
      const date = parseDateToken(refundMatch[4]);

      if (amountPaise && date && merchantRaw) {
        const accountId = matchAccount('icici', digits, accounts);
        const accountKey = formatAccountKey(accountId, 'icici', digits);
        const yyyymmdd = date.replace(/-/g, '');
        const cleanMerchant = merchantRaw.toLowerCase().replace(/[^a-z0-9]/g, '');
        const dedupeKey = `fp:${accountKey}|${amountPaise}|${yyyymmdd}|credit|${cleanMerchant}`;

        return {
          issuer: 'icici',
          accountId,
          accountHint: { issuer: 'icici', digits },
          amountPaise,
          direction: 'credit',
          kind: 'spend',
          date,
          time: null,
          txnTs: null,
          merchantRaw,
          mode: 'card',
          refNo: null,
          availLimitPaise: null,
          dedupeKey,
          linkHint: null,
          source: 'sms',
        };
      }
    }

    // Layout E: Card Bill Payment Received
    // "Dear Customer, thank you for your payment of INR <amt> towards ICICI Bank Credit Card Account XX<4 digits> through Auto Debit from Account XX<3 or 4 digits> on <dd-Mon-yy>"
    const payRecvMatch = flat.match(
      /thank\s+you\s+for\s+your\s+payment\s+of\s+(?:INR|Rs\.?)\s*([\d,.]+)\s+towards\s+ICICI\s+Bank\s+Credit\s+Card\s+Account\s+XX(\d{4})\s+through\s+Auto\s+Debit\s+from\s+Account\s+XX(\d{3,4})\s+on\s+(\d{1,2}[-/][a-zA-Z]{3}[-/]\d{2,4})/i
    );
    if (payRecvMatch) {
      const amountPaise = parseAmountToPaise(payRecvMatch[1]);
      const cardDigits = payRecvMatch[2];
      const fromAccountDigits = payRecvMatch[3];
      const date = parseDateToken(payRecvMatch[4]);

      if (amountPaise && date) {
        const accountId = matchAccount('icici', cardDigits, accounts);
        const accountKey = formatAccountKey(accountId, 'icici', cardDigits);
        const yyyymmdd = date.replace(/-/g, '');
        const dedupeKey = `fp:${accountKey}|${amountPaise}|${yyyymmdd}|payrecv`;

        return {
          issuer: 'icici',
          accountId,
          accountHint: { issuer: 'icici', digits: cardDigits },
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
            cardLast4: cardDigits,
            fromAccountDigits,
          },
          source: 'sms',
        };
      }
    }

    // Layout F: Savings Account UPI Credit
    // "Dear Customer, Acct XX<3 or 4 digits> is credited with Rs <amt> on <dd-Mon-yy> from <NAME>. UPI:<12 digits>-ICICI Bank."
    const upiCreditMatch = flat.match(
      /Dear\s+Customer,\s+Acct\s+XX(\d{3,4})\s+is\s+credited\s+with\s+(?:Rs\.?|INR)\s*([\d,.]+)\s+on\s+(\d{1,2}[-/][a-zA-Z]{3}[-/]\d{2,4})\s+from\s+(.*?)\.\s+UPI:?\s*(\d{12})-ICICI\s+Bank/i
    );
    if (upiCreditMatch) {
      const digits = upiCreditMatch[1];
      const amountPaise = parseAmountToPaise(upiCreditMatch[2]);
      const date = parseDateToken(upiCreditMatch[3]);
      const merchantRaw = upiCreditMatch[4].trim();
      const refNo = upiCreditMatch[5].trim();

      if (amountPaise && date) {
        const accountId = matchAccount('icici', digits, accounts);
        const isHousehold = isHouseholdName(merchantRaw, ownerNames);
        const kind = isHousehold ? 'transfer' : 'income';

        return {
          issuer: 'icici',
          accountId,
          accountHint: { issuer: 'icici', digits },
          amountPaise,
          direction: 'credit',
          kind,
          date,
          time: null,
          txnTs: null,
          merchantRaw,
          mode: 'upi',
          refNo,
          availLimitPaise: null,
          dedupeKey: `ref:${refNo}`,
          linkHint: null,
          source: 'sms',
        };
      }
    }

    return null;
  },
};

registerParser(iciciParser);

