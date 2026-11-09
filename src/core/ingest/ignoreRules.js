/**
 * Ordered list of ignore rules evaluated BEFORE any issuer parser.
 * Any match flags the SMS as "ignored" with the rule's ID as the reason.
 */

export const IGNORE_RULES = [
  {
    id: 'otp',
    test: (flat) => /\b(?:secret\s+)?otp\b|one\s+time\s+password/i.test(flat),
  },
  {
    id: 'not_completed',
    test: (flat) => /was\s+not\s+completed/i.test(flat),
  },
  {
    id: 'refund_or_cancelled',
    test: (flat) =>
      /refund(?:\s+of.*)?\s+has\s+been\s+initiated|will\s+be\s+refunded|ticket\s+cancelled/i.test(flat),
  },
  {
    id: 'charge_revision',
    test: (flat) =>
      /charges\s+for\s+your.*have\s+been\s+revised|schedule\s+of\s+charges/i.test(flat),
  },
  {
    id: 'card_anniversary',
    test: (flat) =>
      /before\s+your\s+card\s+anniversary|as\s+on\s+\d{2}[-/]\d{2}[-/]\d{4}.*anniversary/i.test(flat),
  },
  {
    id: 'third_party_confirmation',
    test: (flat) =>
      /policybazaar/i.test(flat) && /has\s+been\s+successfully\s+debited/i.test(flat),
  },
  {
    id: 'due_or_standing_instruction',
    test: (flat) => {
      const isDueOrReminder =
        /\bis\s+due\b|\bto\s+be\s+debited\b|\bwill\s+be\s+debited\b|standing\s+instruction|minimum\s+due/i.test(
          flat
        );
      if (!isDueOrReminder) return false;
      // Exclude if it has actual past transaction wording ("spent" or "credited")
      const hasActualTxnWording = /\b(?:spent|credited)\b/i.test(flat);
      return !hasActualTxnWording;
    },
  },
  {
    // Carries no date, reference or payee; the bank's own debit SMS is the real record.
    id: 'first_upi_notice',
    test: (flat) => /\b1st\s+UPI\s+Txn\b/i.test(flat),
  },
  {
    // Other funds' confirmations. SBIMF SIP allotments are read as Fixed, because the bank
    // sends a debit SMS for only some SIPs.
    id: 'mutual_fund_confirmation',
    test: (flat) => /units\s+have\s+been\s+allotted/i.test(flat) && !/-\s*SBIMF/i.test(flat),
  },
  {
    // A biller's receipt for a payment the bank already reported.
    id: 'biller_receipt',
    test: (flat) => /payment\s+of\s+(?:rs\.?|inr)\s*[\d,.]+\s+for\s+your\s+jio/i.test(flat),
  },
  {
    // Repeats an "ACH-DR" debit SMS (every one in a real inbox had a matching debit).
    id: 'nach_notice',
    test: (flat) => /^NACH\s+debit\s+towards/i.test(flat),
  },
  {
    id: 'statement_or_bill_notice',
    test: (flat) =>
      /\bstatement\b.*\b(?:generated|ready)\b|\be-?statement\b|\bbill\s+due\s+by\b|\bstatement\s+total\s+amount\s+due\b/i.test(flat),
  },
  {
    id: 'limit_offer',
    test: (flat) => /increasing\s+the\s+limit|credit\s+limit\s+can\s+be/i.test(flat),
  },
  {
    id: 'future_autodebit_notice',
    test: (flat) => /will\s+be\s+auto\s+debited|auto-?debit\s+will\s+be\s+initiated|\bis\s+scheduled\s+on\b/i.test(flat),
  },
  {
    // The EMI lines arrive through the card statement.
    id: 'emi_conversion_notice',
    test: (flat) => /\binto\s+EMI\b/i.test(flat),
  },
  {
    id: 'sweep_liquidation_notice',
    test: (flat) => /will\s+be\s+liquidated/i.test(flat),
  },
  {
    id: 'marketing',
    test: (flat) => {
      const hasPromo = /\b(?:offer|cashback|reward\s+points|t&c)\b/i.test(flat);
      if (!hasPromo) return false;
      const hasTxnWording = /\b(?:spent|debited|credited|withdrawn)\b/i.test(flat);
      return !hasTxnWording;
    },
  },
];

