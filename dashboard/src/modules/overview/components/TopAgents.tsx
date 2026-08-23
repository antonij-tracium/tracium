// Most-used agents — a flat, clickable list (no card). Each row shows the agent
// name, a thin volume bar scaled to the busiest agent, an optional trend
// sparkline, and its call count + cost. The caller passes agents already
// sorted/sliced to the rows it wants shown.

import { Sparkline, fmtNum, fmtCost, RANGE_LABEL } from '../../../common';
import { SectionRule } from './SectionRule';

export interface TopAgentRow {
  name: string;
  calls: number;
  cost: number;
  trend?: number[];
}

export function TopAgents({
  agents,
  onSelectAgent,
  range = '7d',
}: {
  agents: TopAgentRow[];
  onSelectAgent: (name: string) => void;
  range?: string;
}) {
  const maxCalls = Math.max(...agents.map((a) => a.calls), 1);

  return (
    <div>
      <SectionRule eyebrow="Volume" title="Most used agents" subtitle={`By call count, ${RANGE_LABEL[range] ?? RANGE_LABEL['7d']}`} />
      <div style={{ margin: '-4px 0' }}>
        {agents.map((a, i) => {
          const pct = (a.calls / maxCalls) * 100;
          const tone = 'var(--accent)';
          return (
            <button
              key={a.name}
              onClick={() => onSelectAgent(a.name)}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto',
                alignItems: 'center',
                gap: 18,
                width: '100%',
                padding: '14px 4px',
                border: 'none',
                textAlign: 'left',
                borderBottom:
                  i < agents.length - 1 ? '1px solid color-mix(in srgb, var(--border) 55%, transparent)' : 'none',
                background: 'transparent',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--surface-alt) 60%, transparent)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--foreground)' }}>{a.name}</span>
                </div>
                <div
                  style={{
                    position: 'relative',
                    height: 2,
                    background: 'color-mix(in srgb, var(--border) 80%, transparent)',
                    borderRadius: 2,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{ position: 'absolute', inset: 0, width: pct + '%', background: tone, opacity: 0.7, borderRadius: 2 }}
                  />
                </div>
              </div>
              {a.trend ? <Sparkline data={a.trend} width={60} height={24} color={tone} fillOpacity={0.06} /> : <span />}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 2, minWidth: 84 }}>
                <span style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--foreground)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtNum(a.calls)}
                </span>
                <span style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{fmtCost(a.cost)}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
