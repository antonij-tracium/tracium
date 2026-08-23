import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('ErrorBoundary caught error:', error, info);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: '24px',
            border: '1px solid color-mix(in srgb, var(--error) 40%, transparent)',
            borderRadius: '8px',
            backgroundColor: 'color-mix(in srgb, var(--error) 10%, transparent)',
            color: 'var(--error)',
          }}
        >
          <p style={{ fontWeight: 600, margin: '0 0 8px' }}>Something went wrong</p>
          <p style={{ fontSize: '13px', margin: 0, fontFamily: 'monospace' }}>
            {this.state.error?.message}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}
