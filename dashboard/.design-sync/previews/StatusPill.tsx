import { StatusPill } from 'tracium-dashboard';

const row: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' };

export const States = () => (
  <div style={row}>
    <StatusPill status="completed" />
    <StatusPill status="failed" />
    <StatusPill status="warning" />
    <StatusPill status="healthy" />
    <StatusPill status="critical" />
  </div>
);

export const CustomLabel = () => (
  <div style={row}>
    <StatusPill status="ok">Live</StatusPill>
    <StatusPill status="failed">3 errors</StatusPill>
    <StatusPill status="unknown">draining</StatusPill>
  </div>
);
