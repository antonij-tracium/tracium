import { LatencyChart } from 'tracium-dashboard';

const series = [
  { label: 'Mon', p50: 0.8, p95: 1.9, p99: 3.1 },
  { label: 'Tue', p50: 0.7, p95: 2.1, p99: 3.6 },
  { label: 'Wed', p50: 0.9, p95: 1.7, p99: 2.8 },
  { label: 'Thu', p50: 1.1, p95: 2.4, p99: 4.2 },
  { label: 'Fri', p50: 0.6, p95: 1.5, p99: 2.4 },
  { label: 'Sat', p50: 0.5, p95: 1.2, p99: 2.0 },
  { label: 'Sun', p50: 0.7, p95: 1.8, p99: 3.0 },
];

export const Percentiles = () => (
  <div style={{ width: 560 }}>
    <LatencyChart series={series} />
  </div>
);
