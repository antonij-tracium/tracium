// ---------------------------------------------------------------------------
// AgentDetailPage — single-agent detail (from the agent.html design).
//
// Pure presentational component: it renders exactly the props it is handed. The
// demo (embedded) app assembles them from the mock AGENTS + AGENT_META via
// AgentDetailDemoPage; the signed-in app assembles them from the live metrics
// API via AgentDetailLivePage.
//
// Health/status and anomaly detection are intentionally omitted: no agent
// status pill, no "needs attention" banner, no anomaly markers on the charts.
// Run-level completed/failed (a trace outcome, not agent health) is kept.
// ---------------------------------------------------------------------------

import React from 'react';
import {
  CostBarChart,
  LatencyChart,
  HorizonStrip,
  StatusPill,
  RANGE_LABEL,
  fmtCost,
  fmtNum,
  fmtPct,
  fmtMs,
} from '../../../common';
import type { CostPoint, LatencyPoint, ErrorPoint } from '../../../common/interfaces';
import type { AgentRun } from '../interfaces';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** One row in the Configuration panel. Callers supply whatever they can source. */
export interface AgentConfigRow {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  accent?: boolean;
}

export interface AgentDetailPageProps {
  name: string;
  /** Version pill next to the title. Omitted on the live page (no config store). */
  version?: string;
  model: string;
  provider?: string;
  /** "Deployed …" suffix on the meta line. Omitted live. */
  deploy?: string;
  /** Agent description paragraph. Omitted live. */
  description?: string;

  /** Active time range id (24h/7d/30d) — drives every windowed label on the page. */
  range: string;

  calls: number;
  completed: number;
  failed: number;
  cost: number;
  /** p95 in ms, or null when undefined (no runs / not tracked). */
  p95Ms: number | null;
  /** Error rate as a fraction (0–1). */
  errorRate: number;

  configRows: AgentConfigRow[];

  costSeries: CostPoint[];
  latencySeries: LatencyPoint[];
  errorSeries: ErrorPoint[];
  runs: AgentRun[];

  setView: (v: string) => void;
  setSelected: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
}

// Error-rate thresholds (fractions): above 2% reads as an error, above 0.5% as
// a warning — matches the agents list.
const ERR_BAD = 0.02;
const ERR_WARN = 0.005;

// [Trace, Status, Started, Duration, Cost]
const RUNS_GRID = '1.4fr 110px 1fr 90px 80px';

type Tone = 'bad' | 'warn' | 'good' | undefined;

// ---------------------------------------------------------------------------
// Stat tile
// ---------------------------------------------------------------------------

function ADStat({
  label,
  value,
  sub,
  tone,
  isFirst,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: Tone;
  isFirst?: boolean;
}) {
  const color =
    tone === 'bad' ? 'var(--error)'
    : tone === 'warn' ? 'var(--warning)'
    : tone === 'good' ? 'var(--accent)'
    : 'var(--foreground)';
  return (
    <div style={{ padding: '16px 22px 18px', borderLeft: isFirst ? 'none' : '1px solid var(--border)' }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 500 }}>{label}</div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 500,
          letterSpacing: '-0.02em',
          color,
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1,
        }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Config key/value row
// ---------------------------------------------------------------------------

function ADMetaRow({ label, value, mono, accent }: AgentConfigRow) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: 12,
        padding: '9px 0',
        borderBottom: '1px solid color-mix(in srgb, var(--border) 55%, transparent)',
      }}
    >
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
      <span
        title={typeof value === 'string' ? value : undefined}
        style={{
          fontSize: 12.5,
          color: accent ? 'var(--accent)' : 'var(--foreground)',
          fontWeight: 500,
          fontFamily: mono ? 'var(--font-mono)' : 'inherit',
          textAlign: 'right',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          maxWidth: '62%',
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// AgentDetailPage
// ---------------------------------------------------------------------------

export function AgentDetailPage(props: AgentDetailPageProps) {
  const {
    name, version, description, range,
    calls, completed, failed, cost, p95Ms, errorRate,
    configRows, costSeries, latencySeries, errorSeries, runs,
    setView, setSelected,
  } = props;

  const totalFailures = errorSeries.reduce((s, d) => s + d.errors, 0);
  const errTone: Tone = errorRate > ERR_BAD ? 'bad' : errorRate > ERR_WARN ? 'warn' : 'good';
  const rangeLabel = RANGE_LABEL[range] ?? RANGE_LABEL['7d'];
  const hourly = range === '24h';

  const openTrace = (id: string) => {
    setSelected((s) => ({ ...s, traceId: id }));
    setView('trace');
  };

  return (
    <div style={{ padding: '32px 40px 64px', maxWidth: 1480, margin: '0 auto' }}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, marginBottom: 22 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>{name}</h1>
            {version && (
              <span
                style={{
                  fontSize: 11.5,
                  padding: '3px 9px',
                  borderRadius: 6,
                  background: 'var(--surface-alt)',
                  border: '1px solid var(--border)',
                  color: 'var(--muted)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {version}
              </span>
            )}
          </div>
          {description && (
            <p style={{ fontSize: 13.5, color: 'var(--muted)', margin: 0, maxWidth: 660, lineHeight: 1.55, textWrap: 'pretty' }}>
              {description}
            </p>
          )}
        </div>
      </div>

      {/* ── Stats strip ────────────────────────────────────────────────── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 1fr)',
          borderTop: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
          margin: '4px 0 32px',
        }}
      >
        <ADStat isFirst label="Total runs" value={fmtNum(calls)} sub={rangeLabel} />
        <ADStat label="Completed" value={fmtNum(completed)} />
        <ADStat label="Failed" value={fmtNum(failed)} tone={failed > 0 ? errTone : undefined} />
        <ADStat label="Success rate" value={calls > 0 ? fmtPct((completed / calls) * 100) : '—'} tone={calls > 0 ? errTone : undefined} />
        <ADStat label="Total cost" value={fmtCost(cost)} sub={calls > 0 ? `${fmtCost(cost / calls)} / run avg` : undefined} />
        <ADStat label="p95 latency" value={p95Ms == null ? '—' : `${(p95Ms / 1000).toFixed(1)}s`} tone={p95Ms != null && p95Ms > 8000 ? 'warn' : undefined} />
      </div>

      {/* ── Charts row — single frame split by divider ─────────────────── */}
      <div
        className="ad-charts"
        style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', marginBottom: 44 }}
      >
        <div className="ad-chart-cell ad-chart-cell--first" style={{ padding: '22px 26px 20px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>Spend</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--foreground)', letterSpacing: '-0.01em' }}>{hourly ? 'Hourly' : 'Daily'} cost · {rangeLabel}</span>
            </div>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{fmtCost(cost)} total</span>
          </div>
          <CostBarChart series={costSeries} height={210} />
        </div>
        <div className="ad-chart-cell" style={{ padding: '22px 26px 20px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>Latency</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--foreground)', letterSpacing: '-0.01em' }}>Response time · p50 / p95 / p99</span>
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 11.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
              <span><span style={{ display: 'inline-block', width: 8, height: 2, background: 'var(--foreground)', opacity: 0.4, verticalAlign: 'middle', marginRight: 4 }} />p50</span>
              <span><span style={{ display: 'inline-block', width: 8, height: 2, background: 'var(--accent)', verticalAlign: 'middle', marginRight: 4 }} />p95</span>
              <span><span style={{ display: 'inline-block', width: 8, height: 2, background: 'var(--warning)', verticalAlign: 'middle', marginRight: 4 }} />p99</span>
            </div>
          </div>
          <LatencyChart series={latencySeries} height={210} />
        </div>
      </div>

      {/* ── Failed runs strip ──────────────────────────────────────────── */}
      <div style={{ marginBottom: 44 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'space-between',
            gap: 16,
            paddingBottom: 14,
            marginBottom: 22,
            borderBottom: '1px solid var(--border)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>Reliability</span>
            <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--foreground)', letterSpacing: '-0.01em' }}>Failed runs</span>
            <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Errors per {hourly ? 'hour' : 'day'} · {rangeLabel}</span>
          </div>
          <span style={{ fontSize: 12, color: errorRate > ERR_BAD ? 'var(--error)' : 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
            {totalFailures} failures
          </span>
        </div>
        <HorizonStrip data={errorSeries} height={44} />
      </div>

      {/* ── Recent runs + config ─────────────────────────────────── */}
      <div className="ad-split">
        {/* Recent runs */}
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em', margin: 0 }}>Recent runs</h2>
          </div>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: RUNS_GRID,
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
            <div style={{ padding: '32px 6px', fontSize: 13, color: 'var(--muted)' }}>No runs in this window.</div>
          ) : (
            runs.map((run, i) => (
              <button
                key={run.id}
                onClick={() => openTrace(run.id)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: RUNS_GRID,
                  gap: 12,
                  alignItems: 'center',
                  width: '100%',
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
                  <span style={{ fontSize: 12.5, fontFamily: 'var(--font-mono)', color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {run.id}
                  </span>
                  {run.err && (
                    <span style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--error)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {run.err}
                    </span>
                  )}
                </span>
                <StatusPill status={run.status} />
                <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{run.time}</span>
                <span style={{ fontSize: 12.5, textAlign: 'right', color: 'var(--foreground)', fontVariantNumeric: 'tabular-nums' }}>{fmtMs(run.duration)}</span>
                <span style={{ fontSize: 12.5, textAlign: 'right', color: 'var(--foreground)', fontVariantNumeric: 'tabular-nums' }}>{fmtCost(run.cost)}</span>
              </button>
            ))
          )}
        </div>

        {/* Config */}
        <div>
          <div style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: 8 }}>
            Configuration
          </div>
          {configRows.map((row) => (
            <ADMetaRow key={row.label} {...row} />
          ))}
        </div>
      </div>
    </div>
  );
}
