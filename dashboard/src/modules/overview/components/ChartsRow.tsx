// Cost + latency charts sharing a single bounded frame, split by a vertical
// rule rather than rendered as two cards. Each half has an eyebrow/title and an
// inline legend. Both series carry a `label` per point so the shared chart
// components can render them directly.

import React from 'react';
import { CostBarChart, LatencyChart, useMaxWidth, BREAKPOINTS, isLongRange } from '../../../common';
import type { CostPoint, LatencyPoint } from '../../../common/interfaces';

interface ChartsRowProps {
  costSeries: CostPoint[];
  latSeries: LatencyPoint[];
  range?: string;
}

function PanelHeader({ eyebrow, title, legend }: { eyebrow: string; title: string; legend: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 18 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 500,
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            color: 'var(--muted)',
          }}
        >
          {eyebrow}
        </span>
        <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--foreground)', letterSpacing: '-0.01em' }}>
          {title}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 14, fontSize: 12, color: 'var(--muted)' }}>{legend}</div>
    </div>
  );
}

function LegendItem({ swatch, children }: { swatch: React.ReactNode; children: React.ReactNode }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {swatch}
      {children}
    </span>
  );
}

export function ChartsRow({ costSeries, latSeries, range }: ChartsRowProps) {
  const stacked = useMaxWidth(BREAKPOINTS.tablet);
  const costTitle = range === '24h' ? 'Hourly cost' : 'Daily cost';
  // Latency is served from raw spans only; long ranges read the daily rollup,
  // which can't reconstruct per-trace durations, so the latency panel is omitted
  // and the cost chart takes the full width.
  const latencyAvailable = !isLongRange(range ?? '');
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: stacked || !latencyAvailable ? '1fr' : '1fr 1fr',
        borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
        marginBottom: 44,
      }}
    >
      <div
        style={{
          padding: '24px 28px 22px',
          borderRight: stacked || !latencyAvailable ? 'none' : '1px solid var(--border)',
          borderBottom: stacked && latencyAvailable ? '1px solid var(--border)' : 'none',
          minWidth: 0,
        }}
      >
        <PanelHeader eyebrow="Spend" title={costTitle} legend={null} />
        <CostBarChart series={costSeries} />
      </div>

      {latencyAvailable && (
        <div style={{ padding: '24px 28px 22px', minWidth: 0 }}>
          <PanelHeader
            eyebrow="Latency"
            title="Response time · p50 / p95 / p99"
            legend={
              <>
                <LegendItem swatch={<span style={{ width: 10, height: 2, background: 'var(--foreground)', opacity: 0.5 }} />}>
                  p50
                </LegendItem>
                <LegendItem swatch={<span style={{ width: 10, height: 2, background: 'var(--accent)' }} />}>p95</LegendItem>
                <LegendItem swatch={<span style={{ width: 10, height: 2, borderTop: '2px dashed var(--warning)' }} />}>
                  p99
                </LegendItem>
              </>
            }
          />
          <LatencyChart series={latSeries} />
        </div>
      )}
    </div>
  );
}
