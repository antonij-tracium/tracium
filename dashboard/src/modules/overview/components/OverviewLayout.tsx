// Editorial overview shell — a centered column that stacks the masthead and the
// inline sections (each owns its own spacing), then ends in a two-column flow of
// the activity feed and the agents list. The feed side is configurable via
// tweaks; the busier column gets slightly more width.

import React from 'react';
import { useMaxWidth, BREAKPOINTS } from '../../../common';

interface OverviewLayoutProps {
  masthead: React.ReactNode;
  kpis: React.ReactNode;
  // Optional outlier surfaces: a chip strip under the KPIs and a distribution
  // panel after the charts. Omitted (e.g. 24h, where detection is unavailable),
  // the layout renders exactly as before.
  outlierChips?: React.ReactNode;
  charts: React.ReactNode;
  outliers?: React.ReactNode;
  failures: React.ReactNode;
  feedPosition: 'left' | 'right';
  feed: React.ReactNode;
  agents: React.ReactNode;
}

export function OverviewLayout({
  masthead,
  kpis,
  outlierChips,
  charts,
  outliers,
  failures,
  feedPosition,
  feed,
  agents,
}: OverviewLayoutProps) {
  const [first, second] = feedPosition === 'left' ? [feed, agents] : [agents, feed];
  const stacked = useMaxWidth(BREAKPOINTS.tablet);

  return (
    <div style={{ padding: 'clamp(20px, 4vw, 32px) clamp(16px, 4vw, 40px) 64px', maxWidth: 1480, margin: '0 auto' }}>
      {masthead}
      {kpis}
      {outlierChips}
      {charts}
      {outliers}
      {failures}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: stacked
            ? '1fr'
            : feedPosition === 'left' ? '1fr 1.15fr' : '1.15fr 1fr',
          gap: stacked ? 32 : 56,
          alignItems: 'start',
        }}
      >
        {first}
        {second}
      </div>
    </div>
  );
}
