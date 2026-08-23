import { EmptyState } from 'tracium-dashboard';

export const Default = () => (
  <div style={{ width: 420 }}>
    <EmptyState message="No traces yet" description="Point your OTLP exporter at this endpoint to start seeing spans." />
  </div>
);

export const MessageOnly = () => (
  <div style={{ width: 420 }}>
    <EmptyState message="No results for this filter" />
  </div>
);
