// ---------------------------------------------------------------------------
// UsersPage — pure renderer for the user list: sortable, filterable table
// with a cost-share bar. It receives its rows as props (the live wrapper feeds
// telemetry-derived data, the demo feeds mock data) and never fetches.
// Inline styles only (no CSS modules).
//
// Health, growth ("growing") metrics, the at-risk attention banner, and the
// Export CSV / Register user actions are intentionally omitted from this
// build.
//
// Columns that aren't telemetry-derived (Region / Success / Last seen) only
// render when the rows carry that metadata — i.e. the demo dataset. The live,
// API-backed dataset shows the telemetry columns only.
// ---------------------------------------------------------------------------

import React, { useMemo, useState, type ReactNode } from 'react';
import { LastUpdated, Sparkline, fmtNum } from '../../../common';

// ---------------------------------------------------------------------------
// User row shape
// ---------------------------------------------------------------------------

export interface User {
  id: string;
  name: string;
  cost: number;
  runs: number;
  avg: number;
  trend: number[];
  // Non-telemetry metadata — present in the demo dataset only.
  region?: string;
  success?: number;
  lastSeen?: string;
}

// ---------------------------------------------------------------------------
// Demo dataset (used by the embedded auth preview). The signed-in dashboard
// renders UsersLivePage, which builds its rows from the metrics API.
// ---------------------------------------------------------------------------

const USERS: User[] = [
  { id: "tn_acme",      name: "Acme Robotics",       cost: 12.4421, runs: 58_022, avg: 0.000214, trend:[0.36,0.42,0.41,0.48,0.51,0.55,0.58,0.61,0.59,0.62,0.66,0.71], region: "us-east-1", success: 99.4, lastSeen: "12s ago" },
  { id: "tn_northwind", name: "Northwind Logistics", cost:  8.9024, runs: 41_318, avg: 0.000216, trend:[0.18,0.22,0.27,0.31,0.34,0.39,0.41,0.44,0.45,0.49,0.52,0.55], region: "us-east-1", success: 98.1, lastSeen: "1m ago" },
  { id: "tn_helix",     name: "Helix Health",        cost:  6.1102, runs: 28_104, avg: 0.000217, trend:[0.32,0.30,0.28,0.27,0.26,0.25,0.24,0.23,0.22,0.21,0.21,0.22], region: "eu-west-2", success: 99.6, lastSeen: "3m ago" },
  { id: "tn_lumen",     name: "Lumen Studio",        cost:  4.4081, runs: 21_890, avg: 0.000201, trend:[0.14,0.15,0.16,0.16,0.18,0.19,0.18,0.18,0.19,0.20,0.20,0.20], region: "us-west-2", success: 99.2, lastSeen: "8m ago" },
  { id: "tn_kestrel",   name: "Kestrel Finance",     cost:  3.2204, runs: 15_842, avg: 0.000203, trend:[0.10,0.12,0.13,0.14,0.14,0.15,0.16,0.16,0.17,0.18,0.18,0.19], region: "us-east-1", success: 99.0, lastSeen: "22m ago" },
  { id: "tn_polar",     name: "Polar Research",      cost:  1.8714, runs:  9_204, avg: 0.000203, trend:[0.07,0.08,0.08,0.08,0.09,0.08,0.09,0.08,0.08,0.09,0.09,0.09], region: "eu-west-2", success: 97.6, lastSeen: "1h ago" },
  { id: "tn_orbit",     name: "Orbit Labs",          cost:  0.9842, runs:  5_420, avg: 0.000182, trend:[0.13,0.12,0.11,0.10,0.09,0.08,0.07,0.06,0.06,0.05,0.05,0.04], region: "us-west-2", success: 94.2, lastSeen: "2h ago" },
  { id: "tn_sable",     name: "Sable Studios",       cost:  0.4830, runs:  4_423, avg: 0.000109, trend:[0.02,0.02,0.03,0.03,0.04,0.04,0.05,0.05,0.05,0.06,0.06,0.06], region: "us-east-1", success: 96.8, lastSeen: "5m ago" },
];

// Expose USERS so UserDetailPage and the embedded demo can share the data.
export { USERS };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function successColor(success: number): string {
  return success >= 99 ? "var(--foreground)" : success >= 97 ? "var(--warning)" : "var(--error)";
}

function pctDelta(curr: number, prev: number): string {
  if (prev <= 0) return '';
  const d = ((curr - prev) / prev) * 100;
  return (d >= 0 ? '+' : '') + d.toFixed(1) + '%';
}

// ---------------------------------------------------------------------------
// KPI strip
// ---------------------------------------------------------------------------

interface KpiProps {
  label: string;
  value: string;
  delta?: string;
  deltaTone?: "good" | "bad" | "neutral";
  hint: string;
  last?: boolean;
}

function Kpi({ label, value, delta, deltaTone = "neutral", hint, last = false }: KpiProps) {
  const deltaColor = deltaTone === "good" ? "var(--accent)" : deltaTone === "bad" ? "var(--warning)" : "var(--muted)";
  return (
    <div style={{
      paddingRight: last ? 0 : 24,
      borderRight: last ? "none" : "1px solid color-mix(in srgb, var(--border) 45%, transparent)",
    }}>
      <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 8, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 500, letterSpacing: "-0.02em", color: "var(--foreground)", fontVariantNumeric: "tabular-nums", lineHeight: 1, marginBottom: 6 }}>{value}</div>
      <div style={{ fontSize: 11.5, display: "flex", alignItems: "center", gap: 8 }}>
        {delta && <span style={{ color: deltaColor, fontWeight: 500 }}>{delta}</span>}
        <span style={{ color: "var(--muted)" }}>{hint}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cost share bar
// ---------------------------------------------------------------------------

const SHARE_PALETTE = ["var(--accent)", "#7aa5ff", "#c08aff", "#f5a524", "#5ec8b4", "#e76e8b", "#8b95a8", "color-mix(in srgb, var(--muted) 50%, transparent)"];

function ShareBar({ users, totalCost }: { users: User[]; totalCost: number }) {
  return (
    <div>
      <div style={{
        display: "flex", height: 28,
        borderRadius: 5, overflow: "hidden",
        border: "1px solid color-mix(in srgb, var(--border) 60%, transparent)",
        background: "var(--surface-alt)",
      }}>
        {users.map((t, i) => {
          const pct = totalCost > 0 ? (t.cost / totalCost) * 100 : 0;
          if (pct < 0.5) return null;
          return (
            <div key={t.id} title={`${t.name} — $${t.cost.toFixed(2)} (${pct.toFixed(1)}%)`} style={{
              width: pct + "%",
              background: SHARE_PALETTE[i % SHARE_PALETTE.length],
              opacity: 0.85,
              borderRight: i < users.length - 1 ? "1px solid color-mix(in srgb, #000 30%, transparent)" : "none",
              cursor: "pointer",
            }}/>
          );
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "10px 18px", marginTop: 14, fontSize: 11.5 }}>
        {users.slice(0, 6).map((t, i) => {
          const pct = totalCost > 0 ? (t.cost / totalCost) * 100 : 0;
          return (
            <span key={t.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--muted)" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: SHARE_PALETTE[i % SHARE_PALETTE.length], opacity: 0.85 }}/>
              <span style={{ color: "var(--foreground)", fontWeight: 500 }}>{t.name}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{pct.toFixed(1)}%</span>
            </span>
          );
        })}
        {users.length > 6 && (
          <span style={{ color: "var(--muted)", display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: "color-mix(in srgb, var(--muted) 50%, transparent)" }}/>
            +{users.length - 6} smaller
          </span>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

type UserSortKey = 'name' | 'region' | 'runs' | 'cost' | 'avg' | 'success' | 'lastSeen';

interface SortState { key: UserSortKey; dir: 'asc' | 'desc' }

interface ColDef {
  key: UserSortKey | 'trend';
  label: string;
  width: string;
  align: 'left' | 'right';
  sortKey?: UserSortKey;
  meta?: boolean; // requires non-telemetry metadata to render
  cell: (t: User) => ReactNode;
}

const COLUMNS: ColDef[] = [
  {
    key: "name", label: "User", width: "minmax(180px, 1.4fr)", align: "left", sortKey: "name",
    cell: t => (
      <div style={{ display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
        <span style={{ fontSize: 13.5, fontWeight: 500, color: "var(--foreground)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.name}</span>
        <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--muted)" }}>{t.id}</span>
      </div>
    ),
  },
  {
    key: "region", label: "Region", width: "84px", align: "left", sortKey: "region", meta: true,
    cell: t => <div style={{ fontSize: 12, color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{t.region}</div>,
  },
  {
    key: "runs", label: "Runs", width: "80px", align: "right", sortKey: "runs",
    cell: t => <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 13, color: "var(--foreground)" }}>{fmtNum(t.runs)}</div>,
  },
  {
    key: "trend", label: "Trend", width: "78px", align: "left",
    cell: t => <div><Sparkline data={t.trend} width={74} height={22} color="var(--accent)" fillOpacity={0.08} /></div>,
  },
  {
    key: "cost", label: "Cost", width: "90px", align: "right", sortKey: "cost",
    cell: t => <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 13, color: "var(--foreground)", fontWeight: 500 }}>${t.cost.toFixed(2)}</div>,
  },
  {
    key: "avg", label: "Avg cost", width: "96px", align: "right", sortKey: "avg",
    cell: t => <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 12, color: "var(--muted)" }}>${t.avg.toFixed(6)}</div>,
  },
  {
    key: "success", label: "Success", width: "76px", align: "right", sortKey: "success", meta: true,
    cell: t => <div style={{ textAlign: "right", fontVariantNumeric: "tabular-nums", fontSize: 12.5, color: successColor(t.success ?? 0) }}>{(t.success ?? 0).toFixed(1)}%</div>,
  },
  {
    key: "lastSeen", label: "Last seen", width: "84px", align: "right", sortKey: "lastSeen", meta: true,
    cell: t => <div style={{ textAlign: "right", fontSize: 11.5, color: "var(--muted)", fontVariantNumeric: "tabular-nums" }}>{t.lastSeen}</div>,
  },
];

function SortableHeader({ label, sortKey, current, onSort, align }: {
  label: string; sortKey: UserSortKey; current: SortState; onSort: (k: UserSortKey) => void; align: 'left' | 'right';
}) {
  const active = current.key === sortKey;
  return (
    <button onClick={() => onSort(sortKey)} style={{
      display: "flex", alignItems: "center", gap: 4,
      justifyContent: align === "right" ? "flex-end" : "flex-start",
      width: "100%",
      padding: 0, border: "none", background: "transparent",
      color: active ? "var(--foreground)" : "var(--muted)",
      fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase",
      cursor: "pointer",
    }}>
      <span>{label}</span>
      <span style={{ opacity: active ? 1 : 0, fontSize: 9, color: "var(--accent)" }}>{current.dir === "desc" ? "▼" : "▲"}</span>
    </button>
  );
}

function HeaderCell({ col, sort, onSort }: { col: ColDef; sort: SortState; onSort: (k: UserSortKey) => void }) {
  if (col.sortKey) {
    return <SortableHeader label={col.label} sortKey={col.sortKey} current={sort} onSort={onSort} align={col.align} />;
  }
  return (
    <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>{col.label}</span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export interface UsersPageProps {
  users: User[];
  /** Human label for the period the data covers, e.g. "Apr 1 – Apr 30". */
  periodLabel: string;
  /** Previous-period totals; when present, the KPI strip shows deltas. */
  comparison?: { runs: number; cost: number };
  /** Epoch ms of the last successful fetch; drives the live "Updated …" badge. Omitted for demo data. */
  updatedAt?: number;
  setView: (v: string) => void;
  setSelected: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
}

export function UsersPage({ users, periodLabel, comparison, updatedAt, setView, setSelected }: UsersPageProps) {
  const hasMeta = users.some(t => t.region != null);

  const [search, setSearch] = useState<string>("");
  const [sort, setSort] = useState<SortState>({ key: "cost", dir: "desc" });
  const [hoverId, setHoverId] = useState<string | null>(null);

  const handleSort = (key: UserSortKey) => {
    setSort(s => s.key === key ? { key, dir: s.dir === "desc" ? "asc" : "desc" } : { key, dir: "desc" });
  };

  const visibleCols = useMemo(() => COLUMNS.filter(c => !c.meta || hasMeta), [hasMeta]);
  const cols = visibleCols.map(c => c.width).join(" ");
  const minWidth = hasMeta ? 900 : 560;

  const filtered = useMemo(() => {
    let r = users;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      r = r.filter(t => t.name.toLowerCase().includes(q) || t.id.toLowerCase().includes(q));
    }
    return r;
  }, [users, search]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === "string" && typeof bv === "string") {
        return sort.dir === "desc" ? bv.localeCompare(av) : av.localeCompare(bv);
      }
      if (typeof av === "number" && typeof bv === "number") {
        return sort.dir === "desc" ? bv - av : av - bv;
      }
      return 0;
    });
    return arr;
  }, [filtered, sort]);

  const totalCost = users.reduce((s, t) => s + t.cost, 0);
  const totalRuns = users.reduce((s, t) => s + t.runs, 0);
  const sortedByCost = useMemo(() => [...users].sort((a, b) => b.cost - a.cost), [users]);

  return (
    <div style={{ padding: "clamp(20px, 4vw, 32px) clamp(16px, 4vw, 36px) 64px", maxWidth: 1440, margin: "0 auto" }}>
      {/* Header */}
      <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 24, paddingBottom: 28, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: "-0.02em", margin: 0, color: "var(--foreground)" }}>Users</h1>
          <p style={{ fontSize: 13.5, color: "var(--muted)", margin: "2px 0 0" }}>
            {periodLabel} · {users.length} active users · ${totalCost.toFixed(2)} this period
          </p>
        </div>
        {updatedAt != null && <LastUpdated at={updatedAt} />}
      </header>

      {/* KPI strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 28, paddingTop: 4, paddingBottom: 28, borderBottom: "1px solid color-mix(in srgb, var(--border) 50%, transparent)" }}>
        <Kpi label="Active users" value={users.length.toString()} hint="this period" />
        <Kpi
          label="Total runs"
          value={fmtNum(totalRuns)}
          delta={comparison ? pctDelta(totalRuns, comparison.runs) : undefined}
          deltaTone="good"
          hint={fmtNum(totalRuns) + " total"}
        />
        <Kpi
          label="Spend"
          value={"$" + totalCost.toFixed(2)}
          delta={comparison ? pctDelta(totalCost, comparison.cost) : undefined}
          deltaTone={comparison && totalCost > comparison.cost ? "bad" : "good"}
          hint={"$" + (users.length > 0 ? totalCost / users.length : 0).toFixed(2) + " / user"}
          last
        />
      </div>

      {/* Cost share */}
      <div style={{
        paddingTop: 36, paddingBottom: 44,
        borderBottom: "1px solid color-mix(in srgb, var(--border) 50%, transparent)",
      }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 20 }}>
          <h2 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: "var(--foreground)" }}>Cost share</h2>
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0 }}>Top 3 users drive {totalCost > 0 ? ((sortedByCost.slice(0, 3).reduce((s, t) => s + t.cost, 0) / totalCost) * 100).toFixed(0) : "0"}% of spend this period.</p>
        </div>
        <ShareBar users={sortedByCost} totalCost={totalCost} />
      </div>

      {/* Table section */}
      <section style={{ paddingTop: 44 }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, paddingBottom: 18, flexWrap: "wrap" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            <h2 style={{ fontSize: 19, fontWeight: 600, letterSpacing: "-0.018em", margin: 0, color: "var(--foreground)" }}>All users</h2>
            <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>{sorted.length} of {users.length} shown · click a row to drill in.</p>
          </div>
          {/* Search */}
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            padding: "6px 10px",
            border: "1px solid var(--border)",
            borderRadius: 6, background: "var(--surface-alt)",
            width: 280,
          }}>
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" style={{ color: "var(--muted)" }}><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search user name or ID…"
              style={{
                flex: 1, background: "transparent", border: "none", outline: "none",
                color: "var(--foreground)", fontSize: 12.5,
                fontFamily: "inherit",
              }}
            />
            {search && (
              <button onClick={() => setSearch("")} style={{ background: "transparent", border: "none", color: "var(--muted)", cursor: "pointer", padding: 0, fontSize: 14, lineHeight: 1 }}>×</button>
            )}
          </div>
        </header>

        {/* Table */}
        <div style={{ overflowX: "auto" }}>
          {/* Header row */}
          <div style={{
            display: "grid", gridTemplateColumns: cols, minWidth, gap: 16,
            alignItems: "center", padding: "0 4px 10px",
            borderBottom: "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
          }}>
            {visibleCols.map(c => <HeaderCell key={c.key} col={c} sort={sort} onSort={handleSort} />)}
          </div>

          {/* Rows */}
          {sorted.length === 0 ? (
            <div style={{ padding: "60px 0", textAlign: "center", color: "var(--muted)", fontSize: 13 }}>
              No users match this filter.
            </div>
          ) : sorted.map(t => (
            <div
              key={t.id}
              onMouseEnter={() => setHoverId(t.id)}
              onMouseLeave={() => setHoverId(null)}
              onClick={() => { setSelected(s => ({ ...s, user: t.id })); setView("user"); }}
              style={{
                display: "grid", gridTemplateColumns: cols, minWidth, gap: 16,
                alignItems: "center", padding: "14px 4px",
                borderBottom: "1px solid color-mix(in srgb, var(--border) 30%, transparent)",
                cursor: "pointer",
                background: hoverId === t.id ? "color-mix(in srgb, var(--foreground) 2%, transparent)" : "transparent",
              }}
            >
              {visibleCols.map(c => <React.Fragment key={c.key}>{c.cell(t)}</React.Fragment>)}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: 16, fontSize: 12, color: "var(--muted)" }}>
          <span>Showing {sorted.length} of {users.length} users</span>
        </div>
      </section>
    </div>
  );
}
