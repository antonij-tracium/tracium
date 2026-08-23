import { HorizonStrip } from 'tracium-dashboard';

const data = [
  { label: 'Mon', errors: 0, total: 1200 },
  { label: 'Tue', errors: 3, total: 1440 },
  { label: 'Wed', errors: 1, total: 1310 },
  { label: 'Thu', errors: 12, total: 1580 },
  { label: 'Fri', errors: 28, total: 1620 },
  { label: 'Sat', errors: 4, total: 900 },
  { label: 'Sun', errors: 0, total: 1050 },
];

export const ErrorLoad = () => (
  <div style={{ width: 560 }}>
    <HorizonStrip data={data} />
  </div>
);
