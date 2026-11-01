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
    id: 'marketing',
    test: (flat) => {
      const hasPromo = /\b(?:offer|cashback|reward\s+points|t&c)\b/i.test(flat);
      if (!hasPromo) return false;
      const hasTxnWording = /\b(?:spent|debited|credited|withdrawn)\b/i.test(flat);
      return !hasTxnWording;
    },
  },
];

