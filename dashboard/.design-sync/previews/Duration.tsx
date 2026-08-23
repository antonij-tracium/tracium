import { Duration } from 'tracium-dashboard';

// Tracium is a dark-themed DS; render on the app surface so the tokens read true.
const panel: React.CSSProperties = {
  display: 'inline-flex', flexDirection: 'column', gap: 8,
  padding: '18px 22px', borderRadius: 10,
  background: 'var(--surface)', border: '1px solid var(--border)',
  fontSize: 14, color: 'var(--foreground)',
};

export const Scale = () => (
  <div style={panel}>
    <span>Sub-second&nbsp;&nbsp;<Duration ms={420} /></span>
    <span>Seconds&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<Duration ms={4200} /></span>
    <span>Minutes&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;<Duration ms={95000} /></span>
  </div>
);
