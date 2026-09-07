// A compact strip of outlier tallies (cost spikes / error spikes / volume
// shifts), shown under the KPI cards so the count of flagged buckets is visible
// at a glance. Clicking the strip jumps to the Outliers panel.

import type { Anomaly } from '../../interfaces';
import { anomalyChips } from '../../utils/anomalies';

interface OutlierChipsProps {
  anomalies: Anomaly[];
  onOpen?: () => void;
}

export function OutlierChips({ anomalies, onOpen }: OutlierChipsProps) {
  const chips = anomalyChips(anomalies);
  if (chips.length === 0) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>Outliers this window:</span>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {chips.map((c) => (
          <span
            key={c.key}
            style={{
              fontSize: 11,
              padding: '5px 10px',
              borderRadius: 20,
              background: c.tint,
              color: c.color,
              border: `1px solid ${c.border}`,
              whiteSpace: 'nowrap',
            }}
          >
            {c.label}
          </span>
        ))}
      </div>
      {onOpen && (
        <button
          onClick={onOpen}
          style={{
            marginLeft: 'auto',
            fontSize: 12,
            color: 'var(--muted)',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            padding: 0,
          }}
        >
          Review outliers →
        </button>
      )}
    </div>
  );
}
