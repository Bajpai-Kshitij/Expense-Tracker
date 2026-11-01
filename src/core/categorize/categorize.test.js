import { describe, it, expect } from 'vitest';
import { compilePattern } from './pattern.js';
import { suggestRule } from './suggest.js';
import {
  categorize,
  findSimilar,
  planReapply,
  applyPlan,
} from './categorize.js';
import { buildCreateData } from '../forms/expenseForm.js';

describe('PHASE P6 - Categorization and Pattern Matching', () => {
  describe('compilePattern', () => {
    it('handles valid words, special characters escaping, valid regex, invalid regex, empty, too long, nested quantifiers; never throws', () => {
      // 1. Valid words
      const r1 = compilePattern({ pattern: 'SWIGGY|ZOMATO', mode: 'words' });
      expect(r1.ok).toBe(true);
      expect(r1.regex.test('swiggy india')).toBe(true);
      expect(r1.regex.test('Zomato order')).toBe(true);

      // 2. Escaped special characters in words mode
      const r2 = compilePattern({ pattern: 'c++|a.b|price$5', mode: 'words' });
      expect(r2.ok).toBe(true);
      expect(r2.regex.test('learn c++ today')).toBe(true);
      expect(r2.regex.test('axb')).toBe(false); // dot must not be a wildcard
      expect(r2.regex.test('a.b')).toBe(true);
      expect(r2.regex.test('price$5')).toBe(true);

      // 3. Valid regex
      const r3 = compilePattern({ pattern: '^uber.*trip', mode: 'regex' });
      expect(r3.ok).toBe(true);
      expect(r3.regex.test('uber premier trip')).toBe(true);
      expect(r3.regex.test('other uber trip')).toBe(false);

      // 4. Invalid regex
      const r4 = compilePattern({ pattern: '[unclosed(bracket', mode: 'regex' });
      expect(r4.ok).toBe(false);
      expect(typeof r4.reason).toBe('string');

      // 5. Empty
      expect(compilePattern({ pattern: '' }).ok).toBe(false);
      expect(compilePattern({ pattern: '   ' }).ok).toBe(false);
      expect(compilePattern(null).ok).toBe(false);
      expect(compilePattern(undefined).ok).toBe(false);

      // 6. Too long (> 200 chars)
      const longPattern = 'a'.repeat(201);
      const r6 = compilePattern({ pattern: longPattern });
      expect(r6.ok).toBe(false);
      expect(r6.reason).toContain('200');

      // 7. Nested quantifier ReDoS protection
      const r7 = compilePattern({ pattern: '(a+)+', mode: 'regex' });
      expect(r7.ok).toBe(false);
      expect(r7.reason).toContain('Nested quantifiers');

      const r8 = compilePattern({ pattern: '(.*)*', mode: 'regex' });
      expect(r8.ok).toBe(false);
    });
  });

  describe('suggestRule', () => {
    it('extracts uppercase 1-2 words from merchant names according to the spec inputs', () => {
      expect(suggestRule('SWIGGY PVT.')).toEqual({ pattern: 'SWIGGY', mode: 'words' });
      expect(suggestRule('SWIGGY*ORDER 8841')).toEqual({ pattern: 'SWIGGY', mode: 'words' });
      expect(suggestRule('MYNTRA DESI')).toEqual({ pattern: 'MYNTRA DESI', mode: 'words' });
      expect(suggestRule('DISTRICT MO')).toEqual({ pattern: 'DISTRICT MO', mode: 'words' });
      expect(suggestRule('AMAZON PAY IN E')).toEqual({ pattern: 'AMAZON PAY', mode: 'words' });
      expect(suggestRule('blinkit.payu@hdfcbank')).toEqual({ pattern: 'BLINKIT', mode: 'words' });
      expect(suggestRule('paytm.d94102895@pty')).toEqual({ pattern: 'PAYTM', mode: 'words' });
      expect(suggestRule('POLICYBAZAAR')).toEqual({ pattern: 'POLICYBAZAAR', mode: 'words' });
      expect(suggestRule('12345')).toBeNull();
      expect(suggestRule('')).toBeNull();
      expect(suggestRule(null)).toBeNull();
    });
  });

  describe('categorize logic', () => {
    const categories = {
      cat_food: { id: 'cat_food', name: 'Food', archived: false },
      cat_groceries: { id: 'cat_groceries', name: 'Groceries', archived: false },
      cat_travel: { id: 'cat_travel', name: 'Travel', archived: false },
      cat_archived: { id: 'cat_archived', name: 'Old Category', archived: true },
    };

    it('First match wins and priority ordering, including ties broken by id', () => {
      const brands = [
        { id: 'b_zomato', name: 'Zomato', pattern: 'ZOMATO', priority: 10, categoryId: 'cat_food' },
      ];

      const rules = [
        { id: 'r_rule_b', priority: 20, field: 'merchant', pattern: 'ZOMATO', categoryId: 'cat_food' },
        { id: 'r_rule_a', priority: 20, field: 'merchant', pattern: 'ZOMATO', categoryId: 'cat_groceries' },
        { id: 'r_rule_first', priority: 10, field: 'merchant', pattern: 'ZOMATO', categoryId: 'cat_travel' },
      ];

      // Lower priority wins (10 vs 20) -> cat_travel
      const res1 = categorize({ merchantRaw: 'ZOMATO ORDER' }, { brands, rules, categories });
      expect(res1.brand).toBe('Zomato');
      expect(res1.categoryId).toBe('cat_travel');
      expect(res1.matchedRuleId).toBe('r_rule_first');

      // Tie breaker by id ('r_rule_a' vs 'r_rule_b' at priority 20)
      const rulesTied = [
        { id: 'r_rule_b', priority: 20, field: 'merchant', pattern: 'ZOMATO', categoryId: 'cat_food' },
        { id: 'r_rule_a', priority: 20, field: 'merchant', pattern: 'ZOMATO', categoryId: 'cat_groceries' },
      ];
      const res2 = categorize({ merchantRaw: 'ZOMATO ORDER' }, { brands, rules: rulesTied, categories });
      expect(res2.categoryId).toBe('cat_groceries');
      expect(res2.matchedRuleId).toBe('r_rule_a');
    });

    it('tests each rule condition independently: field, accountId, direction, min/max amount, active false', () => {
      // 1. Field: brand
      const brands = [{ id: 'b_uber', name: 'Uber', pattern: 'UBER', priority: 10 }];
      const ruleOnBrand = [{ id: 'r_b', field: 'brand', pattern: 'Uber', categoryId: 'cat_travel' }];
      const resBrand = categorize({ merchantRaw: 'UBER INDIA RIDES' }, { brands, rules: ruleOnBrand, categories });
      expect(resBrand.brand).toBe('Uber');
      expect(resBrand.categoryId).toBe('cat_travel');

      // 2. Field: note
      const ruleOnNote = [{ id: 'r_n', field: 'note', pattern: 'lunch', categoryId: 'cat_food' }];
      const resNote = categorize({ merchantRaw: 'Unknown Cafe', note: 'Office team lunch' }, { rules: ruleOnNote, categories });
      expect(resNote.categoryId).toBe('cat_food');

      // 3. Field: rawText
      const ruleOnRaw = [{ id: 'r_raw', field: 'rawText', pattern: 'SMS_TRANSACTION_PAYMENT', categoryId: 'cat_food' }];
      // When rawText is absent, rule does not match
      const resRawAbsent = categorize({ merchantRaw: 'Store' }, { rules: ruleOnRaw, categories });
      expect(resRawAbsent.categoryId).toBeNull();
      // When rawText is present, rule matches
      const resRawPresent = categorize({ merchantRaw: 'Store', rawText: 'SMS_TRANSACTION_PAYMENT completed' }, { rules: ruleOnRaw, categories });
      expect(resRawPresent.categoryId).toBe('cat_food');

      // 4. Condition: accountId
      const ruleAcc = [{ id: 'r_acc', field: 'merchant', pattern: 'SHELL', accountId: 'acc_icici', categoryId: 'cat_travel' }];
      const resWrongAcc = categorize({ merchantRaw: 'SHELL', accountId: 'acc_hdfc' }, { rules: ruleAcc, categories });
      expect(resWrongAcc.categoryId).toBeNull();
      const resRightAcc = categorize({ merchantRaw: 'SHELL', accountId: 'acc_icici' }, { rules: ruleAcc, categories });
      expect(resRightAcc.categoryId).toBe('cat_travel');

      // 5. Condition: direction
      const ruleDir = [{ id: 'r_dir', field: 'merchant', pattern: 'REFUND', direction: 'credit', categoryId: 'cat_food' }];
      const resWrongDir = categorize({ merchantRaw: 'REFUND', direction: 'debit' }, { rules: ruleDir, categories });
      expect(resWrongDir.categoryId).toBeNull();
      const resRightDir = categorize({ merchantRaw: 'REFUND', direction: 'credit' }, { rules: ruleDir, categories });
      expect(resRightDir.categoryId).toBe('cat_food');

      // 6. Condition: min/max amount
      const ruleAmount = [{ id: 'r_amt', field: 'merchant', pattern: 'RESTAURANT', minPaise: 10000, maxPaise: 50000, categoryId: 'cat_food' }];
      expect(categorize({ merchantRaw: 'RESTAURANT', amountPaise: 5000 }, { rules: ruleAmount, categories }).categoryId).toBeNull();
      expect(categorize({ merchantRaw: 'RESTAURANT', amountPaise: 60000 }, { rules: ruleAmount, categories }).categoryId).toBeNull();
      expect(categorize({ merchantRaw: 'RESTAURANT', amountPaise: 25000 }, { rules: ruleAmount, categories }).categoryId).toBe('cat_food');

      // 7. Active false (disabled)
      const ruleDisabled = [{ id: 'r_dis', field: 'merchant', pattern: 'CAFE', active: false, categoryId: 'cat_food' }];
      expect(categorize({ merchantRaw: 'CAFE' }, { rules: ruleDisabled, categories }).categoryId).toBeNull();
    });

    it('Brand fallback category is used only when no rule matches; a rule overrides the brand category', () => {
      const brands = [
        { id: 'b_swiggy', name: 'Swiggy', pattern: 'SWIGGY', categoryId: 'cat_food' },
      ];
      const rules = [
        { id: 'r_swiggy_groceries', field: 'merchant', pattern: 'SWIGGY INSTAMART', categoryId: 'cat_groceries' },
      ];

      // 1. Matches rule: rule category wins over brand fallback
      const res1 = categorize({ merchantRaw: 'SWIGGY INSTAMART' }, { brands, rules, categories });
      expect(res1.brand).toBe('Swiggy');
      expect(res1.categoryId).toBe('cat_groceries');

      // 2. No rule matches: brand fallback is used
      const res2 = categorize({ merchantRaw: 'SWIGGY RESTAURANT' }, { brands, rules, categories });
      expect(res2.brand).toBe('Swiggy');
      expect(res2.categoryId).toBe('cat_food');
    });

    it('Kind override from rule and from brand; kind stays null when neither sets it', () => {
      const brandsWithKind = [{ id: 'b_ins', name: 'PolicyBazaar', pattern: 'POLICYBAZAAR', categoryId: 'cat_travel', kind: 'fixed' }];
      const brandsNoKind = [{ id: 'b_uber', name: 'Uber', pattern: 'UBER', categoryId: 'cat_travel' }];
      const ruleWithKind = [{ id: 'r_sub', field: 'merchant', pattern: 'NETFLIX', categoryId: 'cat_travel', kind: 'fixed' }];

      expect(categorize({ merchantRaw: 'POLICYBAZAAR' }, { brands: brandsWithKind, categories }).kind).toBe('fixed');
      expect(categorize({ merchantRaw: 'NETFLIX' }, { rules: ruleWithKind, categories }).kind).toBe('fixed');
      expect(categorize({ merchantRaw: 'UBER' }, { brands: brandsNoKind, categories }).kind).toBeNull();
    });

    it('Archived or missing category target is skipped', () => {
      const rules = [
        { id: 'r_missing', priority: 1, field: 'merchant', pattern: 'STORE', categoryId: 'cat_non_existent' },
        { id: 'r_archived', priority: 2, field: 'merchant', pattern: 'STORE', categoryId: 'cat_archived' },
        { id: 'r_valid', priority: 3, field: 'merchant', pattern: 'STORE', categoryId: 'cat_food' },
      ];

      const res = categorize({ merchantRaw: 'STORE' }, { rules, categories });
      expect(res.categoryId).toBe('cat_food');
      expect(res.matchedRuleId).toBe('r_valid');
    });

    it('Text longer than 200 characters is truncated without error', () => {
      const veryLongMerchant = 'SWIGGY ' + 'A'.repeat(500);
      const brands = [{ id: 'b_swiggy', name: 'Swiggy', pattern: 'SWIGGY', categoryId: 'cat_food' }];
      const res = categorize({ merchantRaw: veryLongMerchant }, { brands, categories });
      expect(res.brand).toBe('Swiggy');
      expect(res.categoryId).toBe('cat_food');
    });
  });

  describe('findSimilar', () => {
    it('findSimilar counts only unlocked uncategorized matches', () => {
      const expenses = [
        { id: 'e1', status: 'active', category_id: null, category_locked: 0, merchant_raw: 'SWIGGY ORDER 1' },
        { id: 'e2', status: 'active', category_id: null, category_locked: 0, merchant_raw: 'SWIGGY ORDER 2' },
        { id: 'e3', status: 'active', category_id: 'cat_food', category_locked: 1, merchant_raw: 'SWIGGY ORDER 3' }, // already categorized
        { id: 'e4', status: 'active', category_id: null, category_locked: 1, merchant_raw: 'SWIGGY ORDER 4' }, // locked
        { id: 'e5', status: 'deleted', category_id: null, category_locked: 0, merchant_raw: 'SWIGGY ORDER 5' }, // deleted
        { id: 'e6', status: 'active', category_id: null, category_locked: 0, merchant_raw: 'UBER RIDE' }, // no match
      ];

      const similarIds = findSimilar(expenses, { pattern: 'SWIGGY', mode: 'words' });
      expect(similarIds).toEqual(['e1', 'e2']);
    });
  });

  describe('planReapply and applyPlan', () => {
    const categories = {
      cat_food: { id: 'cat_food', name: 'Food' },
    };
    const brands = [{ id: 'b_swiggy', name: 'Swiggy', pattern: 'SWIGGY', categoryId: 'cat_food' }];

    it('Locked and already-categorized expenses are untouched by planReapply; deleted expenses are ignored; a second run yields zero updates', () => {
      const expenses = [
        { id: 'e1', status: 'active', category_id: null, category_locked: 0, merchant_raw: 'SWIGGY 100', brand: null },
        { id: 'e2', status: 'active', category_id: 'cat_travel', category_locked: 0, merchant_raw: 'SWIGGY 200', brand: 'Swiggy' }, // already categorized
        { id: 'e3', status: 'active', category_id: null, category_locked: 1, merchant_raw: 'SWIGGY 300', brand: null }, // locked
        { id: 'e4', status: 'deleted', category_id: null, category_locked: 0, merchant_raw: 'SWIGGY 400', brand: null }, // deleted
      ];

      const plan1 = planReapply(expenses, { brands, categories });
      expect(plan1.updates).toHaveLength(1);
      expect(plan1.updates[0].expenseId).toBe('e1');
      expect(plan1.updates[0].patch).toEqual({
        category_id: 'cat_food',
        brand: 'Swiggy',
      });

      // Apply the patch to e1 in memory and re-run
      const updatedExpenses = expenses.map((exp) =>
        exp.id === 'e1' ? { ...exp, ...plan1.updates[0].patch } : exp
      );

      // Pure and idempotent: second run yields ZERO updates
      const plan2 = planReapply(updatedExpenses, { brands, categories });
      expect(plan2.updates).toHaveLength(0);
    });

    it('applyPlan writes patches through LogWriter in one writeMany call', async () => {
      const mockWriter = {
        written: [],
        async writeMany(events) {
          this.written = events;
          return events;
        },
      };

      const plan = {
        updates: [
          { expenseId: 'e1', patch: { category_id: 'cat_food', brand: 'Swiggy' } },
          { expenseId: 'e2', patch: { category_id: 'cat_groceries' } },
        ],
      };

      const res = await applyPlan({ plan, writer: mockWriter });
      expect(res).toHaveLength(2);
      expect(mockWriter.written).toHaveLength(2);
      expect(mockWriter.written[0].type).toBe('expense.updated');
      expect(mockWriter.written[0].data.patch.category_id).toBe('cat_food');
    });
  });

  describe('Form creation integration', () => {
    it('A manual create with Uncategorized and a matching merchant is auto-categorized and not locked; a manual create with an explicit category is locked', () => {
      const categories = {
        cat_food: { id: 'cat_food', name: 'Food' },
      };
      const brands = [{ id: 'b_swiggy', name: 'Swiggy', pattern: 'SWIGGY', categoryId: 'cat_food' }];

      // Case 1: Uncategorized merchant matching Swiggy -> auto-categorized, category_locked = 0
      const autoData = buildCreateData(
        {
          amount_paise: 25000,
          date: '2026-10-31',
          merchant_raw: 'Swiggy Restaurant',
          category_id: null,
        },
        { deviceId: 'dev-1', brands, categories }
      );
      expect(autoData.category_id).toBe('cat_food');
      expect(autoData.brand).toBe('Swiggy');
      expect(autoData.category_locked).toBe(0); // Not locked!

      // Case 2: Explicit category chosen by hand -> category_locked = 1
      const manualData = buildCreateData(
        {
          amount_paise: 25000,
          date: '2026-10-31',
          merchant_raw: 'Swiggy Restaurant',
          category_id: 'cat_food',
        },
        { deviceId: 'dev-1', brands, categories }
      );
      expect(manualData.category_id).toBe('cat_food');
      expect(manualData.category_locked).toBe(1); // Locked!
    });
  });
});

