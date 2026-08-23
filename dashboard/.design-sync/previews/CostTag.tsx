import { CostTag } from 'tracium-dashboard';

// Tracium is a dark-themed DS; render on the app surface so the tokens read true.
const panel: React.CSSProperties = {
  display: 'inline-flex', flexDirection: 'column', gap: 8,
  padding: '18px 22px', borderRadius: 10,
  background: 'var(--surface)', border: '1px solid var(--border)',
  fontSize: 14, color: 'var(--foreground)',
};

export const Scale = () => (
  <div style={panel}>
    <span>Tiny&nbsp;&nbsp;&nbsp;<CostTag usd={0.0004} /></span>
    <span>Small&nbsp;&nbsp;<CostTag usd={0.0182} /></span>
    <span>Medium&nbsp;<CostTag usd={1.24} /></span>
    <span>Large&nbsp;&nbsp;<CostTag usd={438.9} /></span>
  </div>
);
