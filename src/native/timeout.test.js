import { describe, it, expect, vi } from 'vitest';
import { withTimeout } from './timeout.js';

describe('withTimeout', () => {
  it('resolves value when promise resolves before timeout', async () => {
    const fastPromise = new Promise((resolve) => setTimeout(() => resolve('success'), 20));
    const result = await withTimeout(fastPromise, 200, 'Test step');
    expect(result).toBe('success');
  });

  it('rejects with step name in error message when timeout is exceeded', async () => {
    const slowPromise = new Promise((resolve) => setTimeout(() => resolve('slow'), 200));
    await expect(withTimeout(slowPromise, 20, 'Opening database')).rejects.toThrow(
      'Timeout during step: Opening database'
    );
  });

  it('propagates original error if promise rejects before timeout', async () => {
    const failingPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Underlying database failure')), 20)
    );
    await expect(withTimeout(failingPromise, 200, 'Opening database')).rejects.toThrow(
      'Underlying database failure'
    );
  });
});

