import { describe, it, expect } from 'vitest';
import {
  validateAccountForm,
  buildAccountUpsert,
  buildArchive,
  buildRestore,
} from './accountForm.js';

describe('accountForm pure logic', () => {
  it('validates required fields and valid owners/types', () => {
    // Missing name
    const res1 = validateAccountForm({ name: '', owner: 'Me', type: 'card', issuer: 'Axis', digits: '1234' });
    expect(res1.ok).toBe(false);
    expect(res1.errors.name).toBeDefined();

    // Invalid owner
    const res2 = validateAccountForm({ name: 'My Card', owner: 'Friend', type: 'card', issuer: 'Axis', digits: '1234' });
    expect(res2.ok).toBe(false);
    expect(res2.errors.owner).toBeDefined();

    // Invalid type
    const res3 = validateAccountForm({ name: 'My Card', owner: 'Me', type: 'crypto', issuer: 'Axis', digits: '1234' });
    expect(res3.ok).toBe(false);
    expect(res3.errors.type).toBeDefined();

    // Valid card
    const res4 = validateAccountForm({ name: 'My Card', owner: 'Me', type: 'card', issuer: 'Axis', digits: '1234' });
    expect(res4.ok).toBe(true);
    expect(res4.value.digits).toBe('1234');

    // Valid cash with empty digits
    const res5 = validateAccountForm({ name: 'Cash Wallet', owner: 'Me', type: 'cash', issuer: '', digits: '' });
    expect(res5.ok).toBe(true);
    expect(res5.value.digits).toBeNull();
  });

  it('detects duplicate accounts matching issuer + last-3-digits across 3 vs 4 digits', () => {
    const existingAccounts = [
      { id: 'acc_1', name: 'Axis Old', issuer: 'Axis', lastDigits: '7068', archived: 0 },
    ];

    // Try to create an account with same issuer and 4 digits ending in 068
    const dup4 = validateAccountForm(
      { name: 'Axis New', owner: 'Me', type: 'card', issuer: 'Axis', digits: '2068' },
      existingAccounts
    );
    expect(dup4.ok).toBe(false);
    expect(dup4.errors.digits).toBe('An account with this issuer and digits already exists');

    // Try to create an account with same issuer and 3 digits "068"
    const dup3 = validateAccountForm(
      { name: 'Axis 3 Digits', owner: 'Me', type: 'card', issuer: 'Axis', digits: '068' },
      existingAccounts
    );
    expect(dup3.ok).toBe(false);
    expect(dup3.errors.digits).toBe('An account with this issuer and digits already exists');

    // Editing the same account should NOT trigger duplicate error
    const editSelf = validateAccountForm(
      { name: 'Axis Updated', owner: 'Me', type: 'card', issuer: 'Axis', digits: '7068' },
      existingAccounts,
      'acc_1'
    );
    expect(editSelf.ok).toBe(true);

    // Same digits but different issuer should NOT trigger duplicate
    const diffIssuer = validateAccountForm(
      { name: 'HDFC Card', owner: 'Me', type: 'card', issuer: 'HDFC', digits: '7068' },
      existingAccounts
    );
    expect(diffIssuer.ok).toBe(true);
  });

  it('ignores archived accounts during duplicate detection', () => {
    const existingAccounts = [
      { id: 'acc_archived', name: 'Old HDFC', issuer: 'HDFC', lastDigits: '3726', archived: 1 },
    ];

    const res = validateAccountForm(
      { name: 'New HDFC', owner: 'Me', type: 'card', issuer: 'HDFC', digits: '3726' },
      existingAccounts
    );
    expect(res.ok).toBe(true);
  });

  it('keeps aliases and unknown extra fields on buildAccountUpsert', () => {
    const existing = {
      id: 'acc_custom',
      accountId: 'acc_custom',
      name: 'Custom Card',
      owner: 'Me',
      type: 'card',
      issuer: 'ICICI',
      lastDigits: '3001',
      aliases: [{ issuer: 'ICICI', digits: '301' }],
      customNote: 'VIP tier',
      color: '#ff0000',
    };

    const formValue = {
      name: 'Custom Card Renamed',
      owner: 'Joint',
      type: 'card',
      issuer: 'ICICI',
      digits: '3001',
    };

    const upsertData = buildAccountUpsert(formValue, existing);
    expect(upsertData.id).toBe('acc_custom');
    expect(upsertData.name).toBe('Custom Card Renamed');
    expect(upsertData.owner).toBe('Joint');
    expect(upsertData.aliases).toEqual([{ issuer: 'ICICI', digits: '301' }]);
    expect(upsertData.customNote).toBe('VIP tier');
    expect(upsertData.color).toBe('#ff0000');
  });

  it('buildArchive and buildRestore set the archived flag', () => {
    const account = { id: 'acc_test', name: 'Test', owner: 'Me', type: 'bank', archived: 0 };

    const archived = buildArchive(account);
    expect(archived.archived).toBe(1);
    expect(archived.id).toBe('acc_test');

    const restored = buildRestore(archived);
    expect(restored.archived).toBe(0);
    expect(restored.id).toBe('acc_test');
  });
});

