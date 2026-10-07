import {
  CostBarChart,
  LatencyChart,
  HorizonStrip,
  MetaRow,
  RunsTable,
  StatTile,
  fmtCost,
  fmtNum,
  fmtPct,
  rangeLabel,
} from '../../../common';
import type { MetaRowProps, RunRow, StatTone } from '../../../common';
import type { CostPoint, LatencyPoint, ErrorPoint } from '../../../common/interfaces';
import { ERR_BAD, ERR_WARN } from '../utils';
import styles from './WorkflowDetailPage.module.css';

export interface WorkflowDetailPageProps {
  name: string;
  version?: string;
  description?: string;
  range: string;

  calls: number;
  completed: number;
  failed: number;
  cost: number;
  p95Ms: number | null;
  errorRate: number;
  configRows: MetaRowProps[];

  costSeries: CostPoint[];
  latencySeries: LatencyPoint[];
  errorSeries: ErrorPoint[];
  runs: RunRow[];

  setView: (v: string) => void;
  setSelected: (updater: (prev: Record<string, string>) => Record<string, string>) => void;
}

export function WorkflowDetailPage(props: WorkflowDetailPageProps) {
  const {
    name, version, description, range,
    calls, completed, failed, cost, p95Ms, errorRate,
    configRows, costSeries, latencySeries, errorSeries, runs,
    setView, setSelected,
  } = props;

  const totalFailures = errorSeries.reduce((s, d) => s + d.errors, 0);
  const errTone: StatTone = errorRate > ERR_BAD ? 'bad' : errorRate > ERR_WARN ? 'warn' : 'good';
  const windowLabel = rangeLabel(range);
  const hourly = range === '24h';

  const openTrace = (id: string) => {
    setSelected((s) => ({ ...s, traceId: id }));
    setView('trace');
  };

  return (
    <div style={{ padding: '32px 40px 64px', maxWidth: 1480, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, marginBottom: 22 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>{name}</h1>
            {version && (
              <span
                style={{
                  fontSize: 12.5,
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
            <p style={{ fontSize: 14.5, color: 'var(--muted)', margin: 0, maxWidth: 660, lineHeight: 1.55, textWrap: 'pretty' }}>
              {description}
            </p>
          )}
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 1fr)',
          borderTop: '1px solid var(--border)',
          borderBottom: '1px solid var(--border)',
          margin: '4px 0 32px',
        }}
      >
        <StatTile isFirst label="Total runs" value={fmtNum(calls)} sub={windowLabel} />
        <StatTile label="Completed" value={fmtNum(completed)} />
        <StatTile label="Failed" value={fmtNum(failed)} tone={failed > 0 ? errTone : undefined} />
        <StatTile label="Success rate" value={calls > 0 ? fmtPct((completed / calls) * 100) : '—'} tone={calls > 0 ? errTone : undefined} />
        <StatTile label="Total cost" value={fmtCost(cost)} sub={calls > 0 ? `${fmtCost(cost / calls)} / run avg` : undefined} />
        <StatTile label="p95 latency" value={p95Ms == null ? '—' : `${(p95Ms / 1000).toFixed(1)}s`} tone={p95Ms != null && p95Ms > 8000 ? 'warn' : undefined} />
      </div>

      <div
        className={styles.charts}
        style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', marginBottom: 44 }}
      >
        <div style={{ padding: '22px 26px 20px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>Spend</span>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground)', letterSpacing: '-0.01em' }}>{hourly ? 'Hourly' : 'Daily'} cost · {windowLabel}</span>
            </div>
            <span style={{ fontSize: 13, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{fmtCost(cost)} total</span>
          </div>
          <CostBarChart series={costSeries} height={210} />
        </div>
        <div className={styles.divided} style={{ padding: '22px 26px 20px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>Latency</span>
              <span style={{ fontSize: 15, fontWeight: 600, color: 'var(--foreground)', letterSpacing: '-0.01em' }}>Response time · p50 / p95 / p99</span>
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 12.5, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
              <span><span style={{ display: 'inline-block', width: 8, height: 2, background: 'var(--foreground)', opacity: 0.4, verticalAlign: 'middle', marginRight: 4 }} />p50</span>
              <span><span style={{ display: 'inline-block', width: 8, height: 2, background: 'var(--accent)', verticalAlign: 'middle', marginRight: 4 }} />p95</span>
              <span><span style={{ display: 'inline-block', width: 8, height: 2, background: 'var(--warning)', verticalAlign: 'middle', marginRight: 4 }} />p99</span>
            </div>
          </div>
          <LatencyChart series={latencySeries} height={210} />
        </div>
      </div>

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
            <span style={{ fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>Reliability</span>
            <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--foreground)', letterSpacing: '-0.01em' }}>Failed runs</span>
            <span style={{ fontSize: 13.5, color: 'var(--muted)' }}>Errors per {hourly ? 'hour' : 'day'} · {windowLabel}</span>
          </div>
          <span style={{ fontSize: 13, color: errorRate > ERR_BAD ? 'var(--error)' : 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
            {totalFailures} failures
          </span>
        </div>
        <HorizonStrip data={errorSeries} height={44} />
      </div>

      <div className={styles.split}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em', margin: '0 0 14px' }}>Recent runs</h2>
          <RunsTable runs={runs} onOpen={openTrace} />
        </div>

        <div>
          <div style={{ fontSize: 12, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)', marginBottom: 8 }}>
            Configuration
          </div>
          {configRows.map((row) => (
            <MetaRow key={row.label} {...row} />
          ))}
        </div>
      </div>
    </div>
  );
}
