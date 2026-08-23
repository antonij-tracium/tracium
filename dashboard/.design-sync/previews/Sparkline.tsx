import { Sparkline } from 'tracium-dashboard';

const row: React.CSSProperties = { display: 'flex', gap: 28, alignItems: 'center' };
const trend = [3, 5, 4, 8, 6, 9, 7, 11, 10, 14];

export const Trends = () => (
  <div style={row}>
    <Sparkline data={trend} />
    <Sparkline data={[...trend].reverse()} color="var(--error)" />
    <Sparkline data={[2, 4, 3, 6, 5, 7]} width={120} height={36} />
  </div>
);

export const WithGaps = () => (
  <Sparkline data={[4, 6, null, null, 5, 8, 7, null, 9]} width={160} height={40} />
);
