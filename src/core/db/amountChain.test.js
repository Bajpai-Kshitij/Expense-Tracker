import { describe, it, expect, beforeEach } from 'vitest';
import { createSqljsAdapter } from './testing/sqljsAdapter.js';
import { migrate } from './migrations.js';
import { rebuildFromEvents } from './sync.js';
import { listExpenses, totals } from './queries.js';
import { validateExpenseForm, buildCreateData } from '../forms/expenseForm.js';
import { createEvent } from '../events/event.js';
import { createEmptyState, applyEvents } from '../events/reducer.js';
import { stateToRows } from './mapper.js';
import { formatPaise } from '../format/money.js';

describe('BUG 1: Amount chain end-to-end test', () => {
  let db;

  beforeEach(async () => {
    db = await createSqljsAdapter();
    await migrate(db);
  });

  it('preserves amount from form input "100" to database rows, listExpenses, totals, and UI formatPaise', async () => {
    // 1. Form input "100"
    const formInput = {
      amount: '100',
      date: '2026-11-01',
      direction: 'debit',
      kind: 'spend',
      merchant: 'Swiggy',
    };

    // 2. Validate form and parse rupees
    const validation = validateExpenseForm(formInput);
    expect(validation.errors).toEqual({});
    expect(validation.value.amount_paise).toBe(10000);

    // 3. Build create data
    const createData = buildCreateData(validation.value, { deviceId: 'dev_test' });
    expect(createData.amount_paise).toBe(10000);

    // 4. LogWriter event creation
    const event = createEvent({
      type: 'expense.created',
      dev: 'dev_test',
      seq: 1,
      ts: '2026-11-01T10:00:00.000Z',
      data: createData,
    });

    // 5. Reducer application
    const state = applyEvents(createEmptyState(), [event]);
    const expInState = state.expenses[createData.expenseId];
    expect(expInState).toBeDefined();

    // 6. Database rows mapping
    const rows = stateToRows(state);
    const expRow = rows.expenses.find((e) => e.id === createData.expenseId);
    expect(expRow).toBeDefined();
    // Proves the bug: mapper set amount_paise to null because it looked for amountPaise
    expect(expRow.amount_paise).toBe(10000);

    // 7. Persist to database read model
    await rebuildFromEvents(db, [event]);

    // 8. listExpenses and totals queries
    const expenseList = await listExpenses(db);
    expect(expenseList.length).toBe(1);
    expect(expenseList[0].amount_paise).toBe(10000);

    const totalsResult = await totals(db);
    expect(totalsResult.spendPaise).toBe(10000);
    expect(totalsResult.netPaise).toBe(10000);

    // 9. Formatted text displayed by list row component
    const displayedRowAmount = formatPaise(expenseList[0].amount_paise);
    expect(displayedRowAmount).toBe('₹100.00');

    const displayedTotal = formatPaise(totalsResult.netPaise);
    expect(displayedTotal).toBe('₹100.00');
  });
});
