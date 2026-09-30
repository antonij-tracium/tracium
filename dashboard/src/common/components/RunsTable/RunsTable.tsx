import { StatusPill } from '../StatusPill';
import { fmtCost, fmtMs } from '../../utils/formatters';

export interface RunRow {
  id: string;
  /** Shown above the id when the rows span several workflows. */
  name?: string;
  status: 'completed' | 'failed';
  /** Human-relative start time, e.g. "2m ago". */
  time: string;
  duration: number;
  cost: number;
  err?: string | null;
}

export interface RunsTableProps {
  runs: RunRow[];
  onOpen: (id: string) => void;
  emptyText?: string;
}

// [Trace, Status, Started, Duration, Cost]
const GRID = '1.4fr 110px 1fr 90px 80px';
const MIN_WIDTH = 560;

const ellipsis = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } as const;
const numeric = { fontSize: 12.5, textAlign: 'right', color: 'var(--foreground)', fontVariantNumeric: 'tabular-nums' } as const;

export function RunsTable({ runs, onOpen, emptyText = 'No runs in this window.' }: RunsTableProps) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: GRID,
          minWidth: MIN_WIDTH,
          gap: 12,
          padding: '0 6px 10px',
          borderBottom: '1px solid var(--border)',
          fontSize: 11,
          color: 'var(--muted)',
          fontWeight: 500,
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
        }}
      >
        <span>Trace</span>
        <span>Status</span>
        <span>Started</span>
        <span style={{ textAlign: 'right' }}>Duration</span>
        <span style={{ textAlign: 'right' }}>Cost</span>
      </div>
      {runs.length === 0 ? (
        <div style={{ padding: '32px 6px', fontSize: 13, color: 'var(--muted)' }}>{emptyText}</div>
      ) : (
        runs.map((run, i) => (
          <button
            key={run.id}
            onClick={() => onOpen(run.id)}
            style={{
              display: 'grid',
              gridTemplateColumns: GRID,
              gap: 12,
              alignItems: 'center',
              width: '100%',
              minWidth: MIN_WIDTH,
              font: 'inherit',
              color: 'inherit',
              padding: '12px 6px',
              border: 'none',
              textAlign: 'left',
              borderBottom: i < runs.length - 1 ? '1px solid color-mix(in srgb, var(--border) 50%, transparent)' : 'none',
              background: 'transparent',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--surface-alt) 60%, transparent)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
          >
            <span style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
              {run.name && (
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)', ...ellipsis }}>{run.name}</span>
              )}
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: run.name ? 11 : 12.5,
                  color: run.name ? 'var(--muted)' : 'var(--foreground)',
                  ...ellipsis,
                }}
              >
                {run.id}
              </span>
              {run.err && (
                <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--error)', ...ellipsis }}>
                  {run.err}
                </span>
              )}
            </span>
            <StatusPill status={run.status} />
            <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{run.time}</span>
            <span style={numeric}>{fmtMs(run.duration)}</span>
            <span style={numeric}>{fmtCost(run.cost)}</span>
          </button>
        ))
      )}
    </div>
  );
}
