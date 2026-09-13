// Breakdown — the "who's driving cost" table. One sortable grid shared by the
// user and workflow tabs. Each numeric column carries its own up/down red/green
// change vs the previous period (MetricCell + DeltaTag).
//
// The Avg column reports cost per 1,000 runs — sub-cent per-run figures compress
// to a comparable two-decimal dollar value instead of a noisy six-decimal one.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Sparkline,
  IconArrowUp,
  IconArrowDown,
  IconChevron,
  IconCheck,
  IconSearch,
  costFormatter,
  fmtNum,
} from '../../../common';
import type { UserSummary, WorkflowSummary, AttributeSummary } from '../interfaces';
import styles from './Breakdown.module.css';

export type BreakdownTab = 'user' | 'workflow' | 'attribute';
export type SortKey = 'name' | 'runs' | 'avg' | 'cost';

export type BreakdownRowData = UserSummary | WorkflowSummary | AttributeSummary;

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

const USER_COLS: ColDef[] = [
  { key: 'name',  label: 'User',   w: 'minmax(220px, 1.4fr)', sortable: true,  align: 'left'  },
  { key: 'trend', label: 'Trend',    w: '78px',                  sortable: false, align: 'left'  },
  { key: 'runs',  label: 'Runs',     w: '110px',                 sortable: true,  align: 'right' },
  { key: 'avg',   label: 'Avg / 1K', w: '116px',                 sortable: true,  align: 'right' },
  { key: 'cost',  label: 'Cost',     w: '118px',                 sortable: true,  align: 'right' },
  { key: 'share', label: 'Share',    w: 'minmax(140px, 1fr)',    sortable: false, align: 'left'  },
];

const WORKFLOW_COLS: ColDef[] = [
  { key: 'name',  label: 'Workflow',    w: 'minmax(220px, 1.4fr)', sortable: true,  align: 'left'  },
  { key: 'runs',  label: 'Runs',     w: '110px',                 sortable: true,  align: 'right' },
  { key: 'avg',   label: 'Avg / 1K', w: '116px',                 sortable: true,  align: 'right' },
  { key: 'cost',  label: 'Cost',     w: '118px',                 sortable: true,  align: 'right' },
  { key: 'share', label: 'Share',    w: 'minmax(140px, 1fr)',    sortable: false, align: 'left'  },
];

// Attribute allocation shares the workflow layout (no trend column); only the name
// header differs — it's labelled with the chosen attribute key (e.g. "team").
const ATTRIBUTE_COLS: ColDef[] = [
  { key: 'name',  label: 'Value',    w: 'minmax(220px, 1.4fr)', sortable: true,  align: 'left'  },
  { key: 'runs',  label: 'Runs',     w: '110px',                 sortable: true,  align: 'right' },
  { key: 'avg',   label: 'Avg / 1K', w: '116px',                 sortable: true,  align: 'right' },
  { key: 'cost',  label: 'Cost',     w: '118px',                 sortable: true,  align: 'right' },
  { key: 'share', label: 'Share',    w: 'minmax(140px, 1fr)',    sortable: false, align: 'left'  },
];

interface AttributeTabConfig {
  keys: string[];
  value: string;
  onSelect: (k: string) => void;
}

export function TabPill({
  tab,
  setTab,
  tabs,
  attribute,
}: {
  tab: BreakdownTab;
  setTab: (t: BreakdownTab) => void;
  tabs: TabDef[];
  // When provided (and it has keys), appends the "By attribute" dropdown tab —
  // the third selector in "Who's driving cost". Sits in the same tab row so it
  // aligns with the fixed user/workflow tabs.
  attribute?: AttributeTabConfig;
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
      {attribute && attribute.keys.length > 0 && (
        <AttributeTab
          keys={attribute.keys}
          value={attribute.value}
          active={tab === 'attribute'}
          onSelect={attribute.onSelect}
        />
      )}
    </div>
  );
}

function isUserSummary(row: BreakdownRowData): row is UserSummary {
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
  row: BreakdownRowData;
  kind: BreakdownTab;
  sharePct: number;
  isTop: boolean;
  isLast: boolean;
  tmpl: string;
}

function BreakdownRow({ row, kind, sharePct, isTop, isLast, tmpl }: BreakdownRowProps) {
  const user = isUserSummary(row) ? row : null;

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
          className={`${styles.subline} ${isTop ? styles.indented : ''} ${kind === 'workflow' ? styles.mono : ''}`}
        >
          {user && user.id && user.id !== row.name && <span>{user.id}</span>}
          {kind === 'workflow' && <span>{(row as WorkflowSummary).model}</span>}
        </span>
      </div>

      {/* Trend column (user only) */}
      {kind === 'user' && user && (
        <div>
          <Sparkline
            data={user.trend}
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
  rows: BreakdownRowData[];
  totalCost: number;
  kind: BreakdownTab;
  sortBy: SortKey;
  setSortBy: (k: SortKey) => void;
  // For kind="attribute", the header label of the name column — the chosen
  // attribute key (e.g. "team"). Ignored for the user/workflow tabs.
  nameLabel?: string;
}

export function Breakdown({ rows, totalCost, kind, sortBy, setSortBy, nameLabel }: BreakdownProps) {
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
    top75Set.add(isUserSummary(r) ? r.id : r.name);
    if (cum >= cumThresh) break;
  }

  const baseCols =
    kind === 'user' ? USER_COLS : kind === 'workflow' ? WORKFLOW_COLS : ATTRIBUTE_COLS;
  // The attribute tab labels its name column with the chosen key.
  const cols =
    kind === 'attribute' && nameLabel
      ? baseCols.map((c) => (c.key === 'name' ? { ...c, label: nameLabel } : c))
      : baseCols;
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
        const rowId = isUserSummary(row) ? row.id : row.name;
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

// AttributeTab is the third selector in the "Who's driving cost" tab row: a
// tab-styled trigger that, unlike the fixed user/workflow tabs, opens a searchable
// popover over every custom attribute the instrumentation tags spans with
// (team, user.id, environment, …). Picking a key both activates the attribute
// view and chooses the dimension. `active` mirrors the user/workflow tabs'
// selected styling. Closes on outside-click or Escape.
function AttributeTab({
  keys,
  value,
  active,
  onSelect,
}: {
  keys: string[];
  value: string;
  active: boolean;
  onSelect: (k: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);

  // Focus the filter and reset the query each time the popover opens.
  useEffect(() => {
    if (open) {
      setQuery('');
      inputRef.current?.focus();
    }
  }, [open]);

  const q = query.trim().toLowerCase();
  const matches = q ? keys.filter((k) => k.toLowerCase().includes(q)) : keys;

  const select = (k: string) => {
    onSelect(k);
    setOpen(false);
  };

  const label = active && value ? value : 'By attribute';

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        className={`${styles.tab} ${active ? styles.active : ''}`}
      >
        {label}
        <IconChevron
          size={11}
          style={{ color: 'var(--muted)', transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .14s' }}
        />
      </button>

      {open && (
        <div
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 60,
            minWidth: 240, maxWidth: 360,
            background: 'var(--surface)', border: '1px solid var(--border-strong)',
            borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.5)', overflow: 'hidden',
            animation: 'fadeIn .12s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', borderBottom: '1px solid var(--border)' }}>
            <IconSearch size={14} style={{ color: 'var(--muted)', flexShrink: 0 }} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
                if (e.key === 'Enter' && matches.length > 0) select(matches[0]);
              }}
              placeholder="Search attributes…"
              style={{
                flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
                color: 'var(--foreground)', fontSize: 13, fontFamily: 'inherit',
              }}
            />
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto', padding: '4px 0' }}>
            {matches.length === 0 && (
              <div style={{ padding: '10px 12px', fontSize: 12.5, color: 'var(--muted)' }}>No matching attributes</div>
            )}
            {matches.map((k) => {
              const isActive = active && k === value;
              return (
                <div
                  key={k}
                  onClick={() => select(k)}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--surface-alt)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = isActive ? 'var(--surface-active)' : 'transparent'; }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '7px 12px', cursor: 'pointer',
                    background: isActive ? 'var(--surface-active)' : 'transparent',
                    fontSize: 13, color: 'var(--foreground)',
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{k}</span>
                  {isActive && <IconCheck size={13} style={{ color: 'var(--accent)', flexShrink: 0 }} />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
