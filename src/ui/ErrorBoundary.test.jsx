import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ErrorBoundary, { formatErrorMessage } from './ErrorBoundary.jsx';

describe('ErrorBoundary pure logic & rendering', () => {
  it('formatErrorMessage safely extracts error message', () => {
    expect(formatErrorMessage(null)).toBe('An unexpected error occurred.');
    expect(formatErrorMessage('Custom text error')).toBe('Custom text error');
    expect(formatErrorMessage(new Error('Sample error failure'))).toBe('Sample error failure');
    expect(formatErrorMessage({ detail: 'bad payload' })).toBe('{"detail":"bad payload"}');
  });

  it('renders children when no error occurs', () => {
    const html = renderToStaticMarkup(
      <ErrorBoundary>
        <div id="test-child">Normal content</div>
      </ErrorBoundary>
    );
    expect(html).toContain('Normal content');
    expect(html).not.toContain('Something went wrong');
  });

  it('getDerivedStateFromError captures error into state', () => {
    const err = new Error('Test crash');
    const state = ErrorBoundary.getDerivedStateFromError(err);
    expect(state).toEqual({ hasError: true, error: err });
  });

  it('renders fallback UI with message, Try again, and Back to Home when hasError is true', () => {
    const boundary = new ErrorBoundary({ onGoHome: () => {}, onReset: () => {} });
    boundary.state = { hasError: true, error: new Error('Critical queue failure') };

    const rendered = boundary.render();
    const html = renderToStaticMarkup(rendered);

    expect(html).toContain('Something went wrong');
    expect(html).toContain('Critical queue failure');
    expect(html).toContain('Try again');
    expect(html).toContain('Back to Home');
  });
});
