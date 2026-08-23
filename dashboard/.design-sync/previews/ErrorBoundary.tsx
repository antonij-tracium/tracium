import { ErrorBoundary } from 'tracium-dashboard';

// Component that throws on render, so the boundary shows its fallback card.
function Boom(): React.ReactNode {
  throw new Error('Failed to load trace tr_9f2a: span stream closed');
}

export const Caught = () => (
  <div style={{ width: 420 }}>
    <ErrorBoundary>
      <Boom />
    </ErrorBoundary>
  </div>
);

export const HappyPath = () => (
  <div style={{ width: 420 }}>
    <ErrorBoundary>
      <div style={{ padding: 20, color: 'var(--foreground)', fontSize: 14 }}>
        Children render normally when nothing throws.
      </div>
    </ErrorBoundary>
  </div>
);
