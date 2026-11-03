/**
 * Masks sensitive personal and financial data in statement text lines.
 *
 * Masking rules:
 * - Always:
 *   - Address lines (starting with Address keywords or looking like a postal address with PIN) -> <address line>
 *   - Owner names (case-insensitive, all permutations of words) -> <NAME>
 *   - Emails -> <email>
 *   - URLs -> <url>
 *   - Phone numbers (10+ digits, optional +91) -> <phone>
 *   - PAN numbers (5 letters, 4 digits, 1 letter) -> <pan>
 *   - PIN codes (6 digits) -> <pin>
 *   - Card numbers (e.g. 16-digit / 4-group patterns): keeps last 4 digits, masks earlier digits with X
 *   - Other 5+ digit numbers: keeps last 2 digits, masks earlier digits with X
 * - Level "layout" (default):
 *   - Replaces each digit in amount tokens with 9, keeping separators (.,) and Dr/Cr indicators
 * - Level "amounts_kept":
 *   - Leaves amount tokens unmasked
 * - Dates:
 *   - Untouched in all levels
 * - Merchant text is kept
 * - Never throws, idempotent, handles empty input
 */

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Generate permutations of words in an array
function getPermutations(arr) {
  if (arr.length <= 1) return [arr];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const current = arr[i];
    const remaining = [...arr.slice(0, i), ...arr.slice(i + 1)];
    const perms = getPermutations(remaining);
    for (const p of perms) {
      result.push([current, ...p]);
    }
  }
  return result;
}

export function maskStatementText(lines = [], opts = {}) {
  if (!Array.isArray(lines)) {
    return [];
  }

  const { ownerNames = [], level = 'layout' } = opts;
  const keepAmounts = level === 'amounts_kept';

  // Prepare owner name matchers
  const ownerNamePatterns = [];
  if (Array.isArray(ownerNames)) {
    for (const raw of ownerNames) {
      if (typeof raw !== 'string') continue;
      const trimmed = raw.trim();
      if (!trimmed) continue;

      const words = trimmed.split(/\s+/).filter(Boolean);
      if (words.length > 1) {
        // Build permutations for multi-word names (e.g. "Kshitij Bajpai", "Bajpai Kshitij")
        const perms = getPermutations(words);
        for (const p of perms) {
          const patternStr = '\\b' + p.map(escapeRegex).join('[\\s,⇥]+') + '\\b';
          ownerNamePatterns.push(new RegExp(patternStr, 'gi'));
        }
      } else if (words.length === 1 && words[0].length >= 3) {
        ownerNamePatterns.push(new RegExp('\\b' + escapeRegex(words[0]) + '\\b', 'gi'));
      }
    }
  }

  // Address line detection patterns
  const addressStartRegex = /^\s*(?:billing\s+address|residence\s+address|office\s+address|mailing\s+address|registered\s+address|permanent\s+address|address)\b/i;
  const pinCodeRegex = /\b[1-9][0-9]{5}\b/;
  const addressKeywordRegex = /\b(?:road|street|st\b|ave\b|avenue|nagar|marg|floor|plot|near|opposite|opp|colony|sector|block|enclave|lane|vihar|bhawan|building|apartment|flat|society|dist|district|state|po\b|post\s+office|city)\b/i;

  // Date patterns to protect from amount and digit masking
  const datePatterns = [
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,
    /\b\d{1,2}\.\d{1,2}\.\d{2,4}\b/g,
    /\b\d{1,2}[- ](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[- ]\d{2,4}\b/gi,
    /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{2,4}\b/gi,
    /\b\d{4}-\d{2}-\d{2}\b/g,
  ];

  return lines.map((lineObj) => {
    try {
      if (!lineObj || typeof lineObj !== 'object') {
        return lineObj;
      }
      const originalText = lineObj.text;
      if (typeof originalText !== 'string') {
        return { ...lineObj, text: '' };
      }

      // Check if already masked as address line
      if (originalText.trim() === '<address line>') {
        return { ...lineObj, text: '<address line>' };
      }

      // 1. Address line check
      if (addressStartRegex.test(originalText)) {
        return { ...lineObj, text: '<address line>' };
      }

      // Postal address check: contains PIN code AND address keywords (or address indicators)
      const hasPin = pinCodeRegex.test(originalText);
      if (hasPin && addressKeywordRegex.test(originalText)) {
        return { ...lineObj, text: '<address line>' };
      }

      let text = originalText;

      // 2. Protect dates so amount and digit masking never alters them
      const datePlaceholders = [];
      for (const dateRegex of datePatterns) {
        text = text.replace(dateRegex, (match) => {
          const idx = datePlaceholders.length;
          datePlaceholders.push(match);
          return `__STMT_DATE_${idx}__`;
        });
      }

      // 3. Emails
      text = text.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '<email>');

      // 4. URLs
      text = text.replace(/\b(?:https?:\/\/[^\s]+|www\.[^\s]+)/gi, '<url>');

      // 5. Phone numbers (10+ digits, optional +91, with optional spaces/dashes)
      text = text.replace(/(?:\+91[\s-]?)?[6-9]\d{9}\b/g, '<phone>');
      text = text.replace(/\b\d{10,12}\b/g, (match) => {
        // Only if not an amount without decimal
        return '<phone>';
      });

      // 6. PAN numbers (5 letters, 4 digits, 1 letter)
      text = text.replace(/\b[A-Za-z]{5}\d{4}[A-Za-z]\b/g, '<pan>');

      // 7. Owner names
      for (const pattern of ownerNamePatterns) {
        text = text.replace(pattern, '<NAME>');
      }

      // 8. Card numbers: keep last 4 digits
      // Patterns like: "4000 12XX XXXX 3765", "4000 1234 5678 3765", "4000123456783765", "XXXXXXXXXXXX3765"
      text = text.replace(/\b(?:\d{4}[ -]?|\d{2}XX[ -]?|XXXX[ -]?|[X\d]{4}[ -]?){3}(\d{4})\b/g, (match, last4) => {
        const hasSpaces = match.includes(' ');
        const hasDashes = match.includes('-');
        if (hasSpaces) {
          return `XXXX XXXX XXXX ${last4}`;
        }
        if (hasDashes) {
          return `XXXX-XXXX-XXXX-${last4}`;
        }
        return `XXXXXXXXXXXX${last4}`;
      });

      // 9. PIN codes (6 digits, not part of an amount or longer number)
      text = text.replace(/\b[1-9][0-9]{5}\b/g, (match) => {
        // Check if followed by .00 (amount)
        return '<pin>';
      });

      // 10. Runs of 5 or more digits that are not amounts: keep last 2 digits, replace rest with X
      // Avoid touching placeholders like __STMT_DATE_0__
      text = text.replace(/\b(\d{3,})(\d{2})\b/g, (match, prefix, suffix) => {
        // If it was already masked or matched elsewhere, replace earlier digits with X
        return 'X'.repeat(prefix.length) + suffix;
      });

      // 11. Amount tokens masking (if not keepAmounts)
      if (!keepAmounts) {
        // Amount token: optional currency prefix, digits with commas, decimal point and digits, optional Dr/Cr
        // Examples: "1,234.56", "1,00,000.00", "12,345.00 Dr", "500.00 Cr", "1234.56"
        text = text.replace(/(?:(?:Rs\.?|INR|₹)\s*)?([0-9][0-9,]*\.[0-9]{2})(\s*(?:Dr|Cr|dr|cr))?\b/g, (match, numStr, marker) => {
          // Replace each digit with 9 one for one, keeping separators
          const maskedNum = numStr.replace(/\d/g, '9');
          const prefix = match.startsWith('Rs') || match.startsWith('INR') || match.startsWith('₹')
            ? match.slice(0, match.indexOf(numStr))
            : '';
          return prefix + maskedNum + (marker || '');
        });
      }

      // 12. Restore protected dates
      text = text.replace(/__STMT_DATE_(\d+)__/g, (_, idx) => {
        return datePlaceholders[Number(idx)] || '';
      });

      return {
        ...lineObj,
        text,
      };
    } catch {
      // Never throw on random input
      return lineObj;
    }
  });
}
