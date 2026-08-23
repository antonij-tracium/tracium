// Failures section — an inline horizon strip of error counts per day (when a
// daily series is available) with a summary line beneath it (total failed,
// worst agent). No card; the SectionRule provides the header and a
// shortcut into the agents view.

import { HorizonStrip, IconArrowRight } from '../../../common';
import type { ErrorPoint } from '../../../common/interfaces';
import { SectionRule } from './SectionRule';

interface FailuresBlockProps {
  series?: ErrorPoint[];
  totalFailed: number;
  worstAgent: string;
  onViewAgents: () => void;
  range?: string;
}

function SummaryStat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div>
      <span style={{ color: 'var(--muted)' }}>{label} </span>
      <span style={{ color: valueColor ?? 'var(--foreground)', fontWeight: valueColor ? 500 : 400, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </span>
    </div>
  );
}

function Divider() {
  return <div style={{ width: 1, height: 14, background: 'var(--border)' }} />;
}

export function FailuresBlock({ series, totalFailed, worstAgent, onViewAgents, range }: FailuresBlockProps) {
  const hourly = range === '24h';
  return (
    <div style={{ marginBottom: 44 }}>
      <SectionRule
        eyebrow="Reliability"
        title={hourly ? 'Failures by hour' : 'Failures by day'}
        subtitle={`Error count per ${hourly ? 'hour' : 'day'} across all agents · hover for rate`}
        right={
          <button
            onClick={onViewAgents}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              fontSize: 12,
              fontWeight: 500,
              color: 'var(--foreground)',
              padding: '5px 10px',
              border: '1px solid var(--border)',
              borderRadius: 7,
              background: 'transparent',
            }}
          >
            View agents <IconArrowRight size={12} />
          </button>
        }
      />
      {series && series.length > 0 && <HorizonStrip data={series} />}
      <div style={{ display: 'flex', gap: 36, alignItems: 'center', marginTop: series && series.length > 0 ? 20 : 0, fontSize: 12.5 }}>
        <SummaryStat label="Total failed" value={String(totalFailed)} valueColor="var(--error)" />
        <Divider />
        <SummaryStat label="Worst agent" value={worstAgent} />
      </div>
    </div>
  );
}
