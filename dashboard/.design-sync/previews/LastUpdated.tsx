import { LastUpdated } from 'tracium-dashboard';

const col: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 14, alignItems: 'flex-start' };

export const Tones = () => (
  <div style={col}>
    <LastUpdated label="Updated just now" tone="live" />
    <LastUpdated label="Updated 4m ago" tone="stale" />
    <LastUpdated label="Failed to sync" tone="error" />
    <LastUpdated label="Syncing…" tone="syncing" />
  </div>
);

export const Derived = () => (
  <LastUpdated at={Date.now() - 42_000} />
);
