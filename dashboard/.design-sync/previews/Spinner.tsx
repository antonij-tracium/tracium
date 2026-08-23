import { Spinner } from 'tracium-dashboard';

const row: React.CSSProperties = { display: 'flex', gap: 24, alignItems: 'center' };

export const Sizes = () => (
  <div style={row}>
    <Spinner size={16} />
    <Spinner size={24} />
    <Spinner size={40} />
  </div>
);
