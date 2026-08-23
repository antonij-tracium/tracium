import { CostBarChart } from 'tracium-dashboard';

const series = [
  { label: 'Mon', value: 1.82 }, { label: 'Tue', value: 2.41 },
  { label: 'Wed', value: 1.15 }, { label: 'Thu', value: 3.02 },
  { label: 'Fri', value: 2.68 }, { label: 'Sat', value: 0.94 },
  { label: 'Sun', value: 1.77 },
];

export const Daily = () => (
  <div style={{ width: 560 }}>
    <CostBarChart series={series} />
  </div>
);
