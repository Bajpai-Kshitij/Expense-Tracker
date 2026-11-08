import React from 'react';

/**
 * Pure helper to format error messages safely without crashing.
 * @param {any} error
 * @returns {string}
 */
export function formatErrorMessage(error) {
  if (!error) return 'An unexpected error occurred.';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message || error.name || 'An unexpected error occurred.';
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

/**
 * ErrorBoundary component that catches render errors, prevents full app crashes,
 * and shows a fallback UI with "Something went wrong", the error message,
 * a "Try again" button, and a "Back to Home" button.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onGoHome) {
      this.props.onGoHome();
    }
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return typeof this.props.fallback === 'function'
          ? this.props.fallback({
              error: this.state.error,
              reset: this.handleReset,
              goHome: this.handleGoHome,
            })
          : this.props.fallback;
      }

      return (
        <div
          className="card"
          style={{
            margin: '16px',
            padding: '20px',
            borderLeft: '4px solid var(--danger, #ef4444)',
            background: 'var(--bg-card, #1e293b)',
          }}
        >
          <h3 style={{ margin: '0 0 8px 0', color: 'var(--danger, #ef4444)', fontSize: '1.1rem' }}>
            Something went wrong
          </h3>
          <p
            style={{
              margin: '0 0 16px 0',
              fontSize: '0.85rem',
              color: 'var(--text-secondary, #94a3b8)',
              wordBreak: 'break-word',
            }}
          >
            {formatErrorMessage(this.state.error)}
          </p>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              className="btn btn-primary"
              onClick={this.handleReset}
            >
              Try again
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={this.handleGoHome}
            >
              Back to Home
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
