// Breakdown — the "who's driving cost" table. One sortable grid shared by the
// tenant and agent tabs. Each numeric column carries its own up/down red/green
// change vs the previous period (MetricCell + DeltaTag); the plan badge renders
// only when a tenant row carries a plan (demo data does; live telemetry doesn't).
//
// The Avg column reports cost per 1,000 runs — sub-cent per-run figures compress
// to a comparable two-decimal dollar value instead of a noisy six-decimal one.

import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import { Sparkline, IconArrowUp, IconArrowDown, costFormatter, fmtNum } from '../../../common';
import type { TenantSummary, AgentSummary } from '../interfaces';
import styles from './Breakdown.module.css';

export type BreakdownTab = 'tenant' | 'agent';
export type SortKey = 'name' | 'runs' | 'avg' | 'cost';

export interface TabDef {
  id: BreakdownTab;
  label: string;
  count: number;
}

interface ColDef {
  key: string;
  label: string;
  w: string;
  sortable: boolean;
  align: 'left' | 'right';
}

const TENANT_COLS: ColDef[] = [
  { key: 'name',  label: 'Tenant',   w: 'minmax(220px, 1.4fr)', sortable: true,  align: 'left'  },
  { key: 'trend', label: 'Trend',    w: '78px',                  sortable: false, align: 'left'  },
  { key: 'runs',  label: 'Runs',     w: '110px',                 sortable: true,  align: 'right' },
  { key: 'avg',   label: 'Avg / 1K', w: '116px',                 sortable: true,  align: 'right' },
  { key: 'cost',  label: 'Cost',     w: '118px',                 sortable: true,  align: 'right' },
  { key: 'share', label: 'Share',    w: 'minmax(140px, 1fr)',    sortable: false, align: 'left'  },
];

const AGENT_COLS: ColDef[] = [
  { key: 'name',  label: 'Agent',    w: 'minmax(220px, 1.4fr)', sortable: true,  align: 'left'  },
  { key: 'runs',  label: 'Runs',     w: '110px',                 sortable: true,  align: 'right' },
  { key: 'avg',   label: 'Avg / 1K', w: '116px',                 sortable: true,  align: 'right' },
  { key: 'cost',  label: 'Cost',     w: '118px',                 sortable: true,  align: 'right' },
  { key: 'share', label: 'Share',    w: 'minmax(140px, 1fr)',    sortable: false, align: 'left'  },
];

export function TabPill({
  tab,
  setTab,
  tabs,
}: {
  tab: BreakdownTab;
  setTab: (t: BreakdownTab) => void;
  tabs: TabDef[];
}) {
  return (
    <div className={styles.tabs}>
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setTab(t.id)}
          className={`${styles.tab} ${tab === t.id ? styles.active : ''}`}
        >
          {t.label}
          <span className={styles.tabCount}>{t.count}</span>
        </button>
      ))}
    </div>
  );
}

function isTenantSummary(row: TenantSummary | AgentSummary): row is TenantSummary {
  return 'id' in row;
}

// pctChange returns the signed % change; 0 when there's no baseline.
function pctChange(curr: number, prev: number): number {
  if (!prev) return 0;
  return ((curr - prev) / prev) * 100;
}

// DeltaTag — up arrow + green when the metric rose, down arrow + red when it fell.
function DeltaTag({ pct }: { pct: number }) {
  const up = pct >= 0;
  return (
    <span className={`${styles.deltaTag} ${up ? styles.up : styles.down}`}>
      {up ? <IconArrowUp size={9} /> : <IconArrowDown size={9} />}
      {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

type MetricVariant = 'runs' | 'avg' | 'cost';

// MetricCell — right-aligned value with its delta tag stacked beneath.
function MetricCell({
  value,
  pct,
  variant,
}: {
  value: string;
  pct: number;
  variant: MetricVariant;
}) {
  return (
    <div className={styles.metricCell}>
      <span className={`${styles.metricValue} ${styles[variant]}`}>{value}</span>
      <DeltaTag pct={pct} />
    </div>
  );
}

interface BreakdownRowProps {
  row: TenantSummary | AgentSummary;
  kind: BreakdownTab;
  sharePct: number;
  isTop: boolean;
  isLast: boolean;
  tmpl: string;
}

function BreakdownRow({ row, kind, sharePct, isTop, isLast, tmpl }: BreakdownRowProps) {
  const tenant = isTenantSummary(row) ? row : null;

  // Per-column change vs the previous period
  const runsPct = pctChange(row.runs, row.runsPrev);
  const costPct = pctChange(row.cost, row.costPrev);
  const avgPrev = row.runsPrev ? row.costPrev / row.runsPrev : 0;
  const avgPct = pctChange(row.avg, avgPrev);

  // Falling cost reads calmer (muted); flat/rising uses the accent.
  const barColor = costPct < 0 ? 'var(--muted)' : 'var(--accent)';

  return (
    <div
      className={`${styles.row} ${isLast ? styles.last : ''}`}
      style={{ gridTemplateColumns: tmpl } as CSSProperties}
    >
      {/* Name column */}
      <div className={styles.nameCell}>
        <div className={styles.nameTop}>
          {isTop && <span className={styles.topDot} title="Top 75% of spend" />}
          <span className={styles.nameText}>{row.name}</span>
        </div>
        <span
          className={`${styles.subline} ${isTop ? styles.indented : ''} ${kind === 'agent' ? styles.mono : ''}`}
        >
          {tenant ? (
            <>
              {tenant.plan && (
                <span
                  className={`${styles.planBadge} ${tenant.plan === 'Scale' ? styles.scale : ''}`}
                >
                  {tenant.plan}
                </span>
              )}
              {tenant.id && tenant.id !== row.name && <span>{tenant.id}</span>}
            </>
          ) : (
            <span>{(row as AgentSummary).model}</span>
          )}
        </span>
      </div>

      {/* Trend column (tenant only) */}
      {kind === 'tenant' && tenant && (
        <div>
          <Sparkline
            data={tenant.trend}
            width={66}
            height={20}
            color={barColor}
            fillOpacity={0.05}
          />
        </div>
      )}

      {/* Runs */}
      <MetricCell value={fmtNum(row.runs)} pct={runsPct} variant="runs" />

      {/* Avg cost per 1,000 runs */}
      <MetricCell value={costFormatter.format(row.avg * 1000)} pct={avgPct} variant="avg" />

      {/* Cost */}
      <MetricCell value={costFormatter.format(row.cost)} pct={costPct} variant="cost" />

      {/* Share bar */}
      <div className={styles.shareCell}>
        <div className={styles.shareTrack}>
          <div
            className={styles.shareFill}
            style={{ '--pct': sharePct + '%', '--bar-color': barColor } as CSSProperties}
          />
        </div>
        <span className={styles.sharePct}>{sharePct.toFixed(1)}%</span>
      </div>
    </div>
  );
}

export interface BreakdownProps {
  rows: (TenantSummary | AgentSummary)[];
  totalCost: number;
  kind: BreakdownTab;
  sortBy: SortKey;
  setSortBy: (k: SortKey) => void;
}

export function Breakdown({ rows, totalCost, kind, sortBy, setSortBy }: BreakdownProps) {
  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      const aVal = a[sortBy as keyof typeof a] as number;
      const bVal = b[sortBy as keyof typeof b] as number;
      return bVal - aVal;
    });
  }, [rows, sortBy]);

  // Compute the set of rows making up the top 75% of spend (the dot marker).
  const cumThresh = totalCost * 0.75;
  let cum = 0;
  const sortedDesc = [...rows].sort((a, b) => b.cost - a.cost);
  const top75Set = new Set<string>();
  for (const r of sortedDesc) {
    cum += r.cost;
    top75Set.add(isTenantSummary(r) ? r.id : r.name);
    if (cum >= cumThresh) break;
  }

  const cols = kind === 'tenant' ? TENANT_COLS : AGENT_COLS;
  const tmpl = cols.map((c) => c.w).join(' ');

  return (
    <div className={styles.scroll}>
      {/* Header row */}
      <div className={styles.headRow} style={{ gridTemplateColumns: tmpl } as CSSProperties}>
        {cols.map((c) => (
          <button
            key={c.key}
            onClick={() => c.sortable && setSortBy(c.key as SortKey)}
            disabled={!c.sortable}
            className={`${styles.headCell} ${styles[c.align]} ${c.sortable ? styles.sortable : ''} ${sortBy === c.key ? styles.active : ''}`}
          >
            {c.label}
            {c.sortable && sortBy === c.key && <IconArrowDown size={9} />}
          </button>
        ))}
      </div>

      {/* Data rows */}
      {sorted.map((row, i) => {
        const sharePct = totalCost ? (row.cost / totalCost) * 100 : 0;
        const rowId = isTenantSummary(row) ? row.id : row.name;
        return (
          <BreakdownRow
            key={rowId}
            row={row}
            kind={kind}
            sharePct={sharePct}
            isTop={top75Set.has(rowId)}
            isLast={i === sorted.length - 1}
            tmpl={tmpl}
          />
        );
      })}
    </div>
  );
}
