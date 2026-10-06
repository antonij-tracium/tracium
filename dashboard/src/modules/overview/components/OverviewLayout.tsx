// Editorial overview shell — a centered column that stacks the masthead and the
// inline sections (each owns its own spacing), then ends in a two-column flow of
// the workflows list and the activity feed.

import React from 'react';
import { useMaxWidth, BREAKPOINTS } from '../../../common';

interface OverviewLayoutProps {
  masthead: React.ReactNode;
  setupChecks?: React.ReactNode;
  kpis: React.ReactNode;
  // Optional outlier surfaces: a chip strip under the KPIs and a distribution
  // panel after the charts. Omitted (e.g. 24h, where detection is unavailable),
  // the layout renders exactly as before.
  outlierChips?: React.ReactNode;
  charts: React.ReactNode;
  outliers?: React.ReactNode;
  failures: React.ReactNode;
  feed: React.ReactNode;
  workflows: React.ReactNode;
}

export function OverviewLayout({
  masthead,
  setupChecks,
  kpis,
  outlierChips,
  charts,
  outliers,
  failures,
  feed,
  workflows,
}: OverviewLayoutProps) {
  const stacked = useMaxWidth(BREAKPOINTS.tablet);

  return (
    <div style={{ padding: 'clamp(20px, 4vw, 32px) clamp(16px, 4vw, 40px) 64px', maxWidth: 1480, margin: '0 auto' }}>
      {masthead}
      {setupChecks}
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
            : '1.15fr 1fr',
          gap: stacked ? 32 : 56,
          alignItems: 'start',
        }}
      >
        {workflows}
        {feed}
      </div>
    </div>
  );
}
