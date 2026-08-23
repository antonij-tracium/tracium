import React, { useRef, useState } from 'react';
import type { CostPoint } from '../../interfaces';
import { useResize } from '../../hooks/useResize';

export interface CostBarChartProps {
  series: CostPoint[];
  height?: number;
}

export function CostBarChart({ series, height = 220 }: CostBarChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const width = useResize(ref);

  const max = (series.length ? Math.max(...series.map((d) => d.value)) : 0) * 1.1 || 1;
  const pad = { top: 20, right: 8, bottom: 32, left: 56 };
  const innerW = Math.max(1, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const gap = innerW / series.length;
  const barW = gap * 0.55;
  const ticks = 4;
  // Thin x-axis labels so they never overlap: keep every Nth label, where N is
  // chosen from how many fit at ~34px each (e.g. 30 daily buckets → every 3rd).
  const labelStep = Math.max(1, Math.ceil(34 / gap));

  return (
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <svg width={width} height={height} style={{ display: 'block' }}>
        {Array.from({ length: ticks + 1 }, (_, i) => {
          const v = (max / ticks) * i;
          const y = pad.top + innerH - (v / max) * innerH;
          return (
            <g key={i}>
              <line
                x1={pad.left}
                x2={width - pad.right}
                y1={y}
                y2={y}
                stroke="var(--chart-grid)"
              />
              <text
                x={pad.left - 10}
                y={y + 4}
                fill="var(--muted)"
                fontSize="11"
                textAnchor="end"
              >
                ${v.toFixed(2)}
              </text>
            </g>
          );
        })}

        {series.map((d, i) => {
          const x = pad.left + i * gap + (gap - barW) / 2;
          const h = (d.value / max) * innerH;
          const y = pad.top + innerH - h;
          const isHover = hover === i;
          return (
            <g
              key={i}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
              style={{ cursor: 'pointer' }}
            >
              {/* invisible hit area */}
              <rect
                x={pad.left + i * gap}
                y={pad.top}
                width={gap}
                height={innerH}
                fill="transparent"
              />
              <rect
                x={x}
                y={y}
                width={barW}
                height={Math.max(2, h)}
                rx={3}
                fill="var(--accent)"
                opacity={isHover ? 1 : 0.85}
              />
              {i % labelStep === 0 && (
                <text
                  x={x + barW / 2}
                  y={height - 10}
                  textAnchor="middle"
                  fill="var(--muted)"
                  fontSize="11"
                >
                  {d.label}
                </text>
              )}
            </g>
          );
        })}

        {hover !== null && (() => {
          const d = series[hover];
          const x = pad.left + hover * gap + gap / 2;
          const h = (d.value / max) * innerH;
          const y = pad.top + innerH - h;
          const tx = Math.min(Math.max(x, pad.left + 70), width - pad.right - 70);
          return (
            <g>
              <line
                x1={x}
                x2={x}
                y1={pad.top}
                y2={pad.top + innerH}
                stroke="var(--foreground)"
                strokeOpacity="0.12"
                strokeDasharray="3 3"
              />
              <g transform={`translate(${tx}, ${Math.max(y - 54, pad.top)})`}>
                <rect
                  x="-70"
                  y="0"
                  width="140"
                  height="44"
                  rx="8"
                  fill="var(--chart-tooltip-bg)"
                  stroke="var(--border)"
                />
                <text x="-58" y="18" fill="var(--muted)" fontSize="11">
                  {d.label}
                </text>
                <text
                  x="-58"
                  y="35"
                  fill="var(--foreground)"
                  fontSize="14"
                  fontWeight="600"
                >
                  ${d.value.toFixed(4)}
                </text>
              </g>
            </g>
          );
        })()}
      </svg>
    </div>
  );
}
