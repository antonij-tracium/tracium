import React from 'react';

export interface SparklineProps {
  // null entries are gaps (no data): the point keeps its x-slot so the spark
  // stays aligned with sibling sparks, but the line breaks rather than dipping.
  data: (number | null)[];
  width?: number;
  height?: number;
  color?: string;
  fillOpacity?: number;
}

export function Sparkline({
  data,
  width = 80,
  height = 24,
  color = 'var(--accent)',
  fillOpacity = 0.12,
}: SparklineProps) {
  if (!data) return null;
  const present = data.filter((v): v is number => v != null);
  if (present.length < 2) return null;

  const max = Math.max(...present);
  const min = Math.min(...present);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  // Break the line (and its area fill) into segments wherever a null interrupts
  // the series, so a gap shows as empty space instead of a line to the floor.
  const segments: { x: number; y: number }[][] = [];
  let seg: { x: number; y: number }[] = [];
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (v == null) {
      if (seg.length) segments.push(seg);
      seg = [];
      continue;
    }
    seg.push({ x: i * step, y: height - ((v - min) / range) * (height - 2) - 1 });
  }
  if (seg.length) segments.push(seg);

  const linePath = (s: { x: number; y: number }[]) =>
    s.map((p, i) => (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');

  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      {segments.map((s, i) => {
        const d = linePath(s);
        return (
          <g key={i}>
            <path
              d={`${d} L${s[s.length - 1].x.toFixed(1)},${height} L${s[0].x.toFixed(1)},${height} Z`}
              fill={color}
              fillOpacity={fillOpacity}
            />
            <path
              d={d}
              stroke={color}
              strokeWidth="1.4"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>
        );
      })}
    </svg>
  );
}
