import { Badge } from 'tracium-dashboard';

const row: React.CSSProperties = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' };

export const Variants = () => (
  <div style={row}>
    <Badge label="default" />
    <Badge label="200 OK" variant="success" />
    <Badge label="rate limited" variant="error" />
  </div>
);

export const InContext = () => (
  <div style={row}>
    <Badge label="gpt-4o" />
    <Badge label="streaming" variant="success" />
    <Badge label="timeout" variant="error" />
    <Badge label="cache hit" variant="success" />
  </div>
);
