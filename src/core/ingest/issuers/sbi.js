import { parseAmountToPaise, parseDateToken, isHouseholdName } from '../normalize.js';
import { matchAccount } from '../accounts.js';
import { registerParser } from '../registry.js';

// SBI writes dates as 03Aug26 or 31/10/2026; the shared date parser expects separators.
function parseSbiDate(token) {
  const m = token.match(/^(\d{1,2})([a-zA-Z]{3})(\d{2,4})$/);
  return parseDateToken(m ? `${m[1]}-${m[2]}-${m[3]}` : token);
}

function buildTxn({ digits, amount, dateToken, party, refNo, direction, mode = 'upi', ctx }) {
  const amountPaise = parseAmountToPaise(amount);
  const date = parseSbiDate(dateToken);
  if (!amountPaise || !date) return null;

  const merchantRaw = party.trim() || 'UPI credit';
  const isHousehold = isHouseholdName(merchantRaw, ctx.ownerNames || []);
  const otherKind = direction === 'credit' ? 'income' : 'spend';

  return {
    issuer: 'sbi',
    accountId: matchAccount('sbi', digits, ctx.accounts || []),
    accountHint: { issuer: 'sbi', digits, accountType: 'bank' },
    amountPaise,
    direction,
    kind: isHousehold ? 'transfer' : otherKind,
    date,
    time: null,
    txnTs: null,
    merchantRaw,
    mode,
    refNo,
    availLimitPaise: null,
    dedupeKey: `ref:${refNo}`,
    linkHint: null,
    source: 'sms',
  };
}

const SBI_DATE = '(\\d{1,2}[a-zA-Z]{3}\\d{2,4})';

const DEBIT = new RegExp(`A\\/C\\s*[X*]*(\\d{3,4})\\s*-?\\s*debited\\s+by\\s+(?:Rs\\.?\\s*)?([\\d,.]+)\\s+on\\s+(?:date\\s+)?${SBI_DATE}\\s+(?:trf|transfer)\\s+to\\s+(.+?)\\s+Ref\\s*no\\.?\\s*(\\d{12})`, 'i');
const SHORT_DEBIT = new RegExp(`^Rs\\.?\\s*([\\d,.]+)\\s+(\\S+@\\S+)\\s+UPI\\s+frm\\s+A\\/c\\s*[X*]*(\\d{3,4})\\s+on\\s+${SBI_DATE}\\s+RefNo\\s+(\\d{12})`, 'i');
const CREDIT = new RegExp(`A\\/C\\s*[X*]*(\\d{3,4})\\s*-?\\s*credited\\s+by\\s+(?:Rs\\.?\\s*)?([\\d,.]+)\\s+on\\s+${SBI_DATE}\\s+transfer\\s+from\\s+(.+?)\\s+Ref\\s*No\\.?\\s*(\\d{12})`, 'i');
const UPI_CREDIT = new RegExp(`A\\/C\\s*[X*]*(\\d{3,4})\\s+credited\\s+by\\s+(?:Rs\\.?\\s*)?([\\d,.]+)\\s+on\\s+${SBI_DATE}\\s+by\\s*(.*?)\\s*\\(Ref\\s*no\\s+(\\d{12})\\)`, 'i');
const NEFT_CREDIT = /INR\s+([\d,.]+)\s+credited\s+to\s+your\s+A\/c\s+No\s+[X*]*(\d{3,4})\s+on\s+(\d{2}\/\d{2}\/\d{4})\s+through\s+NEFT\s+with\s+(.+?)\s+by\s+(.+?)\s*,\s*INFO/i;

export const sbiParser = {
  issuer: 'sbi',

  detect(flat) {
    return /\b(?:SBI|SBIN)\b/i.test(flat);
  },

  parse({ flat }, ctx = {}) {
    let m = flat.match(DEBIT);
    if (m) return buildTxn({ digits: m[1], amount: m[2], dateToken: m[3], party: m[4], refNo: m[5], direction: 'debit', ctx });

    m = flat.match(SHORT_DEBIT);
    if (m) return buildTxn({ digits: m[3], amount: m[1], dateToken: m[4], party: m[2], refNo: m[5], direction: 'debit', ctx });

    m = flat.match(CREDIT);
    if (m) return buildTxn({ digits: m[1], amount: m[2], dateToken: m[3], party: m[4], refNo: m[5], direction: 'credit', ctx });

    m = flat.match(UPI_CREDIT);
    if (m) return buildTxn({ digits: m[1], amount: m[2], dateToken: m[3], party: m[4], refNo: m[5], direction: 'credit', ctx });

    m = flat.match(NEFT_CREDIT);
    if (m) {
      const refNo = m[4].trim().split(/\s+/).pop();
      return buildTxn({ digits: m[2], amount: m[1], dateToken: m[3], party: m[5], refNo, direction: 'credit', mode: 'netbanking', ctx });
    }

    return null;
  },
};

// "Purchase - Systematic [U/s 80C of IT Act 1961 ]in Folio <n> in Fund : <name> for date <dd-Mon-yyyy> for amount of INR <amt> ..."
const SIP_ALLOTMENT = /Purchase\s*-\s*Systematic\s+(?:U\/s\s+\S+\s+of\s+IT\s+Act\s+\d+\s+)?in\s+Folio\s+(\d+)\s+in\s+Fund\s*:\s*(.+?)\s+for\s+date\s+(\d{2}-[a-zA-Z]{3}-\d{4})\s+for\s+amount\s+of\s+INR\s+([\d,.]+)/i;

export const sbiMfParser = {
  issuer: 'sbimf',

  detect(flat) {
    return /-\s*SBIMF\b/i.test(flat);
  },

  parse({ flat }, ctx = {}) {
    const m = flat.match(SIP_ALLOTMENT);
    if (!m) return null;
    const amountPaise = parseAmountToPaise(m[4]);
    const date = parseDateToken(m[3]);
    if (!amountPaise || !date) return null;

    const digits = m[1].slice(-4);
    const fund = m[2].trim();
    return {
      issuer: 'sbimf',
      accountId: matchAccount('sbimf', digits, ctx.accounts || []),
      accountHint: { issuer: 'sbimf', digits, accountType: 'bank' },
      amountPaise,
      direction: 'debit',
      kind: 'fixed',
      date,
      time: null,
      txnTs: null,
      merchantRaw: fund,
      mode: 'other',
      refNo: null,
      availLimitPaise: null,
      dedupeKey: `sip:${m[1]}|${fund.toUpperCase().replace(/[^A-Z0-9]/g, '')}|${date}|${amountPaise}`,
      linkHint: null,
      source: 'sms',
    };
  },
};

registerParser(sbiParser);
registerParser(sbiMfParser);
