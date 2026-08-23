// KPI strip — one seamless bar bounded by rules, with the cells divided by
// hairlines rather than rendered as separate cards. Each cell carries a label,
// a large value, an optional inline sparkline, a signed delta (the leading
// +/- drives the arrow + tone) and an optional hint.

import { Sparkline, IconArrowUp, IconArrowDown, IconArrowRight, useMaxWidth, BREAKPOINTS } from '../../../common';
import type { DeltaType } from '../interfaces';

export interface KpiItem {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: DeltaType;
  sparkData?: (number | null)[]; // null entries render as gaps (see Sparkline)
  sparkColor?: string;
  hint?: string;
}

function deltaColorFor(tone?: DeltaType): string {
  if (tone === 'good') return 'var(--accent)';
  if (tone === 'bad') return 'var(--error)';
  return 'var(--muted)';
}

export function KpiStrip({ items }: { items: KpiItem[] }) {
  const narrow = useMaxWidth(BREAKPOINTS.mobile);
  // Below the breakpoint the seamless bar wraps to two columns instead of
  // squeezing every cell into a sliver.
  const cols = narrow ? 2 : items.length;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        borderTop: '1px solid var(--border)',
        borderBottom: '1px solid var(--border)',
        margin: '4px 0 32px',
      }}
    >
      {items.map((it, i) => {
        const deltaColor = deltaColorFor(it.deltaTone);
        const delta = it.delta ?? '';
        return (
          <div
            key={it.label}
            style={{
              padding: '20px 24px 22px',
              borderLeft: i % cols !== 0 ? '1px solid var(--border)' : 'none',
              borderTop: i >= cols ? '1px solid var(--border)' : 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              minWidth: 0,
            }}
          >
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 500 }}>{it.label}</span>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
              <span
                style={{
                  fontSize: 30,
                  fontWeight: 500,
                  letterSpacing: '-0.025em',
                  color: 'var(--foreground)',
                  fontVariantNumeric: 'tabular-nums',
                  lineHeight: 1,
                }}
              >
                {it.value}
              </span>
              {it.sparkData && (
                <Sparkline
                  data={it.sparkData}
                  width={72}
                  height={24}
                  color={it.sparkColor ?? 'var(--accent)'}
                  fillOpacity={0.08}
                />
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              {(delta || it.deltaTone === 'neutral') && (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: deltaColor, fontWeight: 500 }}>
                  {delta.startsWith('+') ? (
                    <IconArrowUp size={11} />
                  ) : delta.startsWith('-') ? (
                    <IconArrowDown size={11} />
                  ) : it.deltaTone === 'neutral' ? (
                    <IconArrowRight size={11} />
                  ) : null}
                  {delta.replace(/^[+-]/, '')}
                </span>
              )}
              {it.hint && <span style={{ color: 'var(--muted)' }}>{it.hint}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
