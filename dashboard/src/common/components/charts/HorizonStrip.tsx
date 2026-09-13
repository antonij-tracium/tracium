import { useRef, useState } from 'react';
import type { ErrorPoint, ChartMarker } from '../../interfaces';
import { useResize } from '../../hooks/useResize';

export interface HorizonStripProps {
  data: ErrorPoint[];
  height?: number;
  // Optional in-place anomaly flags: each draws a highlight box around its cell.
  markers?: ChartMarker[];
}

export function HorizonStrip({ data, height = 40, markers = [] }: HorizonStripProps) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useResize(ref);
  const [hover, setHover] = useState<number | null>(null);

  const cellW = width / data.length;
  const maxErr = Math.max(...data.map((d) => d.errors), 1);

  return (
    <div ref={ref} style={{ width: '100%', position: 'relative' }}>
      {hover !== null && (() => {
        const d = data[hover];
        const rate = d.total > 0 ? (d.errors / d.total) * 100 : 0;
        return (
          <div
            style={{
              position: 'absolute',
              left: hover * cellW + cellW / 2,
              top: -8,
              transform: 'translate(-50%, -100%)',
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: '5px 9px',
              fontSize: 12,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
              zIndex: 1,
            }}
          >
            <strong>{d.errors}</strong> failed
            {d.total > 0 && <> · {rate.toFixed(1)}% of {d.total.toLocaleString()}</>}
          </div>
        );
      })()}
      <svg
        width={width}
        height={height}
        style={{ display: 'block' }}
        onMouseLeave={() => setHover(null)}
      >
        {data.map((d, i) => {
          const intensity = d.errors / maxErr;
          const color =
            intensity > 0.66
              ? 'var(--error)'
              : intensity > 0.33
                ? 'var(--warning)'
                : d.errors > 0
                  ? 'var(--accent)'
                  : 'var(--surface-alt)';
          return (
            <g key={i} onMouseEnter={() => setHover(i)}>
              <rect
                x={i * cellW + 3}
                y="0"
                width={cellW - 6}
                height={height}
                rx="5"
                fill={color}
                opacity={d.errors === 0 ? 0.18 : 0.25 + intensity * 0.6}
                stroke={hover === i ? color : 'transparent'}
                strokeWidth="1.5"
              />
              <text
                x={i * cellW + cellW / 2}
                y={height / 2 + 4}
                textAnchor="middle"
                fill="var(--foreground)"
                fontSize="12"
                fontWeight={intensity > 0.33 ? 600 : 400}
              >
                {d.errors}
              </text>
            </g>
          );
        })}
        {width > 0 &&
          markers.map((m) => {
            if (m.index < 0 || m.index >= data.length) return null;
            return (
              <rect
                key={`mk-${m.index}`}
                x={m.index * cellW + 2}
                y={-1}
                width={cellW - 4}
                height={height + 2}
                rx={6}
                fill="none"
                stroke={m.color}
                strokeWidth={1.5}
                style={{ cursor: m.onClick ? 'pointer' : 'default' }}
                onClick={m.onClick}
              >
                {m.label && <title>{m.label}</title>}
              </rect>
            );
          })}
      </svg>
      <div style={{ display: 'flex', marginTop: 6 }}>
        {data.map((d, i) => (
          <div
            key={i}
            style={{ flex: 1, textAlign: 'center', fontSize: 11, color: 'var(--muted)' }}
          >
            {d.label}
          </div>
        ))}
      </div>
    </div>
  );
}
