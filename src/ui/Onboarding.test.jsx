import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Onboarding, { STEPS } from './Onboarding.jsx';
import {
  setOnboardingProgressListener,
  logStepStart,
  logStepFinish,
  logStepError,
} from '../native/onboardingProgress.js';

describe('Onboarding Component', () => {
  it('defines the required 4 steps in exact order', () => {
    expect(STEPS).toEqual([
      'Opening database',
      'Creating device file',
      'First sync',
      'Seeding',
    ]);
  });

  it('renders initial welcome screen and disabled Get Started button when folder is not picked', () => {
    const html = renderToStaticMarkup(
      <Onboarding onComplete={() => {}} isRepickMode={false} currentLabel="Me" />
    );

    expect(html).toContain('Welcome to Expense Tracker');
    expect(html).toContain('Pick Shared Folder');
    expect(html).toContain('Get Started');
    expect(html).toContain('disabled');
  });

  it('renders restore mode title when isRepickMode is true', () => {
    const html = renderToStaticMarkup(
      <Onboarding onComplete={() => {}} isRepickMode={true} currentLabel="Me" />
    );

    expect(html).toContain('Folder Access Lost');
    expect(html).toContain('Restore Folder Access');
  });

  it('notifies progress listener with step start, finish, and error without personal data', () => {
    const updates = [];
    setOnboardingProgressListener((update) => {
      updates.push(update);
    });

    logStepStart('Opening database');
    logStepFinish('Opening database');
    logStepStart('Creating device file');
    logStepError('Creating device file', new Error('Timeout during step: Creating device file'));

    expect(updates).toEqual([
      { step: 'Opening database', status: 'running' },
      { step: 'Opening database', status: 'completed' },
      { step: 'Creating device file', status: 'running' },
      { step: 'Creating device file', status: 'failed', error: 'Timeout during step: Creating device file' },
    ]);

    setOnboardingProgressListener(null);
  });

  it('renders step error banner and Retry button when initialError is provided', () => {
    const html = renderToStaticMarkup(
      <Onboarding
        onComplete={() => {}}
        isRepickMode={false}
        currentLabel="Me"
        initialError='Step "Opening database" failed: cannot start a transaction within a transaction'
      />
    );

    expect(html).toContain('Step &quot;Opening database&quot; failed: cannot start a transaction within a transaction');
    expect(html).toContain('Retry');
    expect(html).not.toContain('Configuring...');
  });
});

