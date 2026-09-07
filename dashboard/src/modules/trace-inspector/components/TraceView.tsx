import React, { useMemo, useState } from 'react';
import {
  IconX,
  StatusPill,
  fmtCost,
  fmtNum,
  fmtMs,
  useMaxWidth,
  BREAKPOINTS,
} from '../../../common';
import type { SpanDetail, AvailableTool, TraceDetail } from '../interfaces';
import type { TabId } from '../ids';
import { prettifyMaybeJson } from '../utils';

export interface TraceViewProps {
  trace: TraceDetail;
  setView: (v: string) => void;
}

// ---------------------------------------------------------------------------
// MiniStat
// ---------------------------------------------------------------------------

interface MiniStatProps {
  label: string;
  value: string | number;
  sub?: string;
  tone?: 'bad' | 'warn';
  isFirst?: boolean;
}

function MiniStat({ label, value, sub, tone, isFirst }: MiniStatProps) {
  const color = tone === 'bad' ? 'var(--error)' : tone === 'warn' ? 'var(--warning)' : 'var(--foreground)';
  return (
    <div style={{ padding: '16px 20px 18px', borderLeft: isFirst ? 'none' : '1px solid var(--border)' }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 500 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 500, letterSpacing: '-0.02em', color, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 6 }}>{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MetaRow
// ---------------------------------------------------------------------------

interface MetaRowProps {
  label: string;
  value: string | number | boolean | undefined;
  mono?: boolean;
}

/** Renders nothing when the value is absent, so the live view can drop fields it lacks. */
function MetaRow({ label, value, mono }: MetaRowProps) {
  if (value == null || value === '') return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
      gap: 12, padding: '8px 0',
      borderBottom: '1px solid color-mix(in srgb, var(--border) 55%, transparent)',
    }}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{label}</span>
      <span style={{
        fontSize: 12.5, color: 'var(--foreground)', fontWeight: 500,
        fontFamily: mono ? 'var(--font-mono)' : 'inherit',
        textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden',
        textOverflow: 'ellipsis', maxWidth: '70%',
      }} title={String(value)}>{String(value)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CodeBlock
// ---------------------------------------------------------------------------

function CodeBlock({ children, maxHeight = 220 }: { children: string; maxHeight?: number }) {
  return (
    <pre style={{
      margin: 0, padding: '14px 16px',
      background: 'color-mix(in srgb, var(--surface-alt) 60%, transparent)',
      border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
      borderRadius: 8,
      fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 1.55,
      color: 'var(--foreground)',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      maxHeight, overflowY: 'auto',
    }}>{children}</pre>
  );
}

// ---------------------------------------------------------------------------
// EmptyBlock — dashed placeholder for absent input/output
// ---------------------------------------------------------------------------

function EmptyBlock({ children }: { children: string }) {
  return (
    <div style={{ padding: '28px 18px', border: '1px dashed var(--border)', borderRadius: 10, color: 'var(--muted)', fontSize: 13, textAlign: 'center' }}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SectionLabel
// ---------------------------------------------------------------------------

function SectionLabel({ children, tone, style }: { children: string; tone?: 'error'; style?: React.CSSProperties }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em',
      color: tone === 'error' ? 'var(--error)' : 'var(--muted)', marginBottom: 8, ...style,
    }}>{children}</div>
  );
}

// ---------------------------------------------------------------------------
// SpanTypeTag
// ---------------------------------------------------------------------------

// Tag/dot colour per span role. Shared by SpanTypeTag, spanColor and the legend
// so a role reads the same everywhere. agent/internal stay muted in the
// timeline bar (see spanColor); the rest carry a distinct hue.
const TYPE_COLORS: Record<SpanDetail['type'], string> = {
  agent: 'var(--foreground)',
  llm: 'var(--accent)',
  tool: '#7aa5ff',
  chain: '#a78bfa',
  retriever: '#5ec5a8',
  embedding: '#e0a458',
  internal: 'var(--muted)',
};

function SpanTypeTag({ type }: { type: SpanDetail['type'] }) {
  const c = TYPE_COLORS[type] ?? TYPE_COLORS.internal;
  return (
    <span style={{
      fontSize: 10.5, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em',
      padding: '2px 7px', borderRadius: 4, color: c,
      background: `color-mix(in srgb, ${c} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${c} 22%, transparent)`,
    }}>{type}</span>
  );
}

/**
 * A span is a "parent" when it has direct children; its cost is then shown
 * rolled up over its whole subtree. The API supplies both `subtreeCost` and
 * `childCount`, so the client never re-sums the tree. `subtreeCost` falls back
 * to the span's own cost for data that predates the field.
 */
function isParentSpan(span: SpanDetail): boolean {
  return (span.childCount ?? 0) > 0;
}

function displayCost(span: SpanDetail): number {
  return span.subtreeCost ?? span.cost;
}

function displayTokens(span: SpanDetail): number {
  return span.subtreeTokens ?? span.tokens;
}

/**
 * Timeline bar colour for a span. Failed spans are always red. agent and
 * internal spans stay muted so the structural scaffolding recedes and the
 * billable/active roles (llm, tool, chain, retriever, embedding) stand out.
 */
function spanColor(span: SpanDetail): string {
  if (span.status === 'failed') return 'var(--error)';
  if (span.type === 'agent' || span.type === 'internal') return 'var(--muted)';
  return TYPE_COLORS[span.type] ?? 'var(--muted)';
}

// ---------------------------------------------------------------------------
// AvailableToolsList
// ---------------------------------------------------------------------------

function AvailableToolsList({ tools }: { tools: AvailableTool[] }) {
  const [showAll, setShowAll] = useState(false);
  const usedCount = tools.filter(t => t.used).length;
  const visible = showAll ? tools : tools.filter(t => t.used);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 11, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted)' }}>
            Available tools
          </span>
          <span style={{ fontSize: 11, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
            {usedCount} of {tools.length} used
          </span>
        </div>
        <div style={{ display: 'inline-flex', padding: 2, background: 'var(--surface-alt)', border: '1px solid var(--border)', borderRadius: 6 }}>
          {[{ id: false, label: 'Used' }, { id: true, label: 'All' }].map(opt => (
            <button key={String(opt.id)} onClick={() => setShowAll(opt.id)} style={{
              padding: '3px 10px', fontSize: 11.5, fontWeight: 500, border: 'none', borderRadius: 4,
              background: showAll === opt.id ? 'var(--surface)' : 'transparent',
              color: showAll === opt.id ? 'var(--foreground)' : 'var(--muted)',
              boxShadow: showAll === opt.id ? '0 0 0 1px var(--border)' : 'none',
              cursor: 'pointer', fontFamily: 'inherit',
            }}>{opt.label}</button>
          ))}
        </div>
      </div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface)', overflow: 'hidden' }}>
        {visible.length === 0 && (
          <div style={{ padding: '16px 14px', fontSize: 12.5, color: 'var(--muted)', textAlign: 'center' }}>
            No tools were called in this span.
          </div>
        )}
        {visible.map((tool, i) => (
          <div key={tool.name} style={{
            display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px',
            padding: '10px 12px',
            borderTop: i === 0 ? 'none' : '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
            opacity: tool.used ? 1 : 0.65,
          }}>
            <span style={{
              gridRow: '1 / span 2', alignSelf: 'center',
              width: 6, height: 6, borderRadius: '50%',
              background: tool.used ? 'var(--accent)' : 'var(--muted)',
              display: 'inline-block',
            }} />
            <span style={{ fontSize: 12.5, fontWeight: 500, fontFamily: 'var(--font-mono)', color: 'var(--foreground)' }}>
              {tool.name}
            </span>
            <span style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{tool.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SpanInspector
// ---------------------------------------------------------------------------

function SpanInspector({ span, error }: { span: SpanDetail | undefined; error: TraceDetail['error'] }) {
  if (!span) return null;
  // Prefer the span's own error; fall back to the trace-level error only for
  // data that predates per-span errors, so selecting one failed span never
  // shows another span's message.
  const spanError = span.error ?? error;
  const showError = span.status === 'failed' && spanError;
  // For a parent, lead with the subtree total and footnote its own cost.
  const isParent = isParentSpan(span);
  const cost = displayCost(span);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <SpanTypeTag type={span.type} />
          <StatusPill status={span.status === 'ok' ? 'completed' : 'failed'} />
        </div>
        <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--foreground)', letterSpacing: '-0.01em', wordBreak: 'break-word' }}>
          {span.name}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{span.id}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ padding: '12px 14px', borderRight: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>Duration</div>
          <div style={{ fontSize: 18, fontWeight: 500, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.015em' }}>{fmtMs(span.duration)}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>starts at +{fmtMs(span.start)}</div>
        </div>
        <div style={{ padding: '12px 14px' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>{isParent ? 'Cost (subtree)' : 'Cost'}</div>
          <div style={{ fontSize: 18, fontWeight: 500, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.015em' }}>
            {cost > 0 ? fmtCost(cost) : '—'}
          </div>
          {isParent ? (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
              {span.cost > 0 ? `${fmtCost(span.cost)} self · ` : ''}{span.childCount} child span{span.childCount! > 1 ? 's' : ''}
            </div>
          ) : span.tokens > 0 && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3, fontVariantNumeric: 'tabular-nums' }}>
              {fmtNum(span.inputTokens ?? span.tokens)} in{span.outputTokens ? ` · ${fmtNum(span.outputTokens)} out` : ''}
            </div>
          )}
        </div>
      </div>

      {showError && (
        <div>
          <SectionLabel tone="error">{spanError.code ? `Error · HTTP ${spanError.code}` : 'Error'}</SectionLabel>
          <div style={{ fontSize: 12.5, color: 'var(--foreground)', marginBottom: 10, lineHeight: 1.5 }}>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--error)' }}>{spanError.type}</span>
            {spanError.message && <span style={{ color: 'var(--muted)' }}> · </span>}
            {spanError.message}
          </div>
          {spanError.stack && <CodeBlock maxHeight={140}>{spanError.stack}</CodeBlock>}
        </div>
      )}

      {span.input && (
        <div>
          <SectionLabel>Input</SectionLabel>
          <CodeBlock>{prettifyMaybeJson(span.input)}</CodeBlock>
        </div>
      )}

      {span.output && (
        <div>
          <SectionLabel>Output</SectionLabel>
          <CodeBlock>{prettifyMaybeJson(span.output)}</CodeBlock>
        </div>
      )}

      {span.availableTools && span.availableTools.length > 0 && (
        <AvailableToolsList tools={span.availableTools} />
      )}

      {Object.keys(span.attributes).length > 0 && (
        <div>
          <SectionLabel style={{ marginBottom: 4 }}>Attributes</SectionLabel>
          <div>
            {Object.entries(span.attributes).map(([k, v]) => (
              <MetaRow key={k} label={k} value={v} mono />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// HeaderButton
// ---------------------------------------------------------------------------

function HeaderButton({ children, primary, onClick }: { children: React.ReactNode; primary?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick} style={{
      fontSize: 12.5, fontWeight: 500, padding: '7px 12px', borderRadius: 8,
      display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
      fontFamily: 'inherit', whiteSpace: 'nowrap',
      background: primary ? 'var(--accent)' : 'transparent',
      border: `1px solid ${primary ? 'var(--accent)' : 'var(--border)'}`,
      color: primary ? 'var(--accent-contrast)' : 'var(--foreground)',
    }}>{children}</button>
  );
}

// ---------------------------------------------------------------------------
// TraceView — the shared presentational trace detail page
// ---------------------------------------------------------------------------

export function TraceView({ trace: t, setView }: TraceViewProps) {
  // Guard against zero-duration traces (single instantaneous span) so the
  // timeline's percentage math never divides by zero and emits NaN positions.
  const totalDuration = t.duration || 1;
  const firstFailed = t.spans.find(s => s.status === 'failed');
  const [activeSpanId, setActiveSpanId] = useState<string>(firstFailed?.id ?? t.spans[0]?.id ?? '');
  const [tab, setTab] = useState<TabId>('timeline');
  const [shared, setShared] = useState<'idle' | 'copied' | 'failed'>('idle');
  // Parent span ids whose subtrees are hidden. Empty by default → fully expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const handleShare = () => {
    // clipboard is unavailable in non-secure contexts; only claim success once
    // the write actually resolves so the button never lies about copying.
    Promise.resolve(navigator.clipboard?.writeText(window.location.href) ?? Promise.reject())
      .then(() => setShared('copied'))
      .catch(() => setShared('failed'));
    setTimeout(() => setShared('idle'), 2000);
  };

  const toggleCollapse = (id: string) =>
    setCollapsed(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Select a span and make sure it is visible: spans are in tree pre-order, so
  // a span's ancestors are the nearest preceding spans at each shallower depth.
  // Expanding them (dropping their ids from `collapsed`) un-hides the target row
  // so the timeline selection matches what the inspector shows.
  const revealSpan = (id: string) => {
    const idx = t.spans.findIndex(s => s.id === id);
    if (idx >= 0) {
      const ancestors: string[] = [];
      let depth = t.spans[idx].depth;
      for (let i = idx - 1; i >= 0 && depth > 0; i--) {
        if (t.spans[i].depth < depth) {
          ancestors.push(t.spans[i].id);
          depth = t.spans[i].depth;
        }
      }
      if (ancestors.length > 0) {
        setCollapsed(prev => {
          const next = new Set(prev);
          ancestors.forEach(a => next.delete(a));
          return next;
        });
      }
    }
    setActiveSpanId(id);
    setTab('timeline');
  };

  // The spans array is in tree pre-order, so a span's descendants are the
  // contiguous run of deeper-depth spans that follow it. A span is "hidden"
  // when it falls under a collapsed parent. Hidden rows stay mounted and
  // animate to zero height (see the row wrapper below), so collapsing reads as
  // a smooth slide rather than an abrupt jump.
  const hiddenIds = useMemo(() => {
    const hidden = new Set<string>();
    let hideBelow: number | null = null;
    for (const span of t.spans) {
      if (hideBelow !== null) {
        if (span.depth > hideBelow) { hidden.add(span.id); continue; }
        hideBelow = null;
      }
      if (collapsed.has(span.id) && isParentSpan(span)) hideBelow = span.depth;
    }
    return hidden;
  }, [t.spans, collapsed]);

  const activeSpan = t.spans.find(s => s.id === activeSpanId);
  const failedCount = t.spans.filter(s => s.status === 'failed').length;

  const ticks = 5;
  const tickValues = Array.from({ length: ticks + 1 }, (_, i) => (totalDuration / ticks) * i);

  // Header subtitle: status pill + whatever runtime facts the data carries.
  const subtitle = [
    t.version && { text: t.version },
    t.model && { text: t.model, mono: true },
    t.environment && { text: t.environment },
  ].filter(Boolean) as { text: string; mono?: boolean }[];

  const tabs: { id: TabId; label: string }[] = [
    { id: 'timeline', label: 'Timeline' },
    { id: 'input', label: 'Input' },
    { id: 'output', label: 'Output' },
    { id: 'metadata', label: 'Metadata' },
    { id: 'raw', label: 'Raw JSON' },
  ];

  // Below the tablet breakpoint the span inspector drops below the timeline
  // instead of sitting in a fixed 420px rail.
  const stackInspector = useMaxWidth(BREAKPOINTS.tablet);

  return (
    <div style={{ padding: 'clamp(20px, 4vw, 32px) clamp(16px, 4vw, 40px) 64px', maxWidth: 1480, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 24 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 12, flexWrap: 'wrap' }}>
            <span onClick={() => setView('agents')} style={{ color: 'var(--muted)', cursor: 'pointer' }}>Agents</span>
            <span style={{ color: 'var(--muted)', opacity: 0.4 }}>/</span>
            <span style={{ color: 'var(--muted)' }}>{t.agent}</span>
            <span style={{ color: 'var(--muted)', opacity: 0.4 }}>/</span>
            <span style={{ color: 'var(--foreground)', fontFamily: 'var(--font-mono)' }}>{t.id}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <StatusPill status={t.status} />
            {subtitle.map((p, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span style={{ color: 'var(--muted)', opacity: 0.4 }}>·</span>}
                <span style={{ fontSize: 12, color: 'var(--muted)', fontFamily: p.mono ? 'var(--font-mono)' : 'inherit' }}>{p.text}</span>
              </React.Fragment>
            ))}
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', margin: '0 0 6px', color: 'var(--foreground)' }}>{t.agent}</h1>
          {t.startedAt && (
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              {t.startedAt}{t.endedAt && <> <span style={{ opacity: 0.4 }}>→</span> {t.endedAt}</>}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <HeaderButton onClick={handleShare}>{shared === 'copied' ? 'Link copied' : shared === 'failed' ? 'Copy failed' : 'Share'}</HeaderButton>
        </div>
      </div>

      {/* Error banner */}
      {t.error && (
        <div style={{
          padding: '14px 0',
          borderTop: '1px solid color-mix(in srgb, var(--error) 28%, transparent)',
          borderBottom: '1px solid color-mix(in srgb, var(--error) 28%, transparent)',
          marginBottom: 28, display: 'flex', alignItems: 'flex-start', gap: 12,
        }}>
          <span style={{
            display: 'grid', placeItems: 'center',
            width: 28, height: 28, borderRadius: 8,
            background: 'color-mix(in srgb, var(--error) 18%, transparent)',
            color: 'var(--error)', flexShrink: 0,
          }}>
            <IconX size={14} />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13.5, fontWeight: 500, color: 'var(--foreground)', marginBottom: 4 }}>
              {t.error.code && <>HTTP {t.error.code} · </>}<span style={{ fontFamily: 'var(--font-mono)' }}>{t.error.type}</span>
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>{t.error.message}</div>
          </div>
          {firstFailed && (
            <button
              onClick={() => revealSpan(firstFailed.id)}
              style={{
                fontSize: 12, fontWeight: 500, color: 'var(--error)', padding: '5px 10px',
                border: '1px solid color-mix(in srgb, var(--error) 28%, transparent)', borderRadius: 7,
                background: 'transparent', whiteSpace: 'nowrap', cursor: 'pointer', fontFamily: 'inherit',
              }}
            >Jump to failing span →</button>
          )}
        </div>
      )}

      {/* Stats strip */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', margin: '4px 0 36px' }}>
        <MiniStat isFirst label="Duration"      value={fmtMs(t.duration)} />
        <MiniStat label="Total cost"    value={fmtCost(t.totalCost)} />
        <MiniStat label="Input tokens"  value={fmtNum(t.inputTokens)} sub={t.cachedTokens != null ? `${fmtNum(t.cachedTokens)} cached` : undefined} />
        <MiniStat label="Output tokens" value={fmtNum(t.outputTokens)} />
        <MiniStat label="Spans"         value={t.spans.length} sub={`${failedCount} failed`} tone={failedCount > 0 ? 'bad' : undefined} />
        <MiniStat label="Model"         value={t.model ? t.model.replace('claude-', '') : '—'} sub={t.provider} />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
        {tabs.map(tb => (
          <button key={tb.id} onClick={() => setTab(tb.id)} style={{
            padding: '10px 14px', fontSize: 13, fontWeight: 500,
            color: tab === tb.id ? 'var(--foreground)' : 'var(--muted)',
            background: 'transparent', border: 'none',
            borderBottom: '2px solid ' + (tab === tb.id ? 'var(--accent)' : 'transparent'),
            marginBottom: -1, cursor: 'pointer', fontFamily: 'inherit',
          }}>{tb.label}</button>
        ))}
      </div>

      {/* Tab: timeline */}
      {tab === 'timeline' && (
        <div style={{ display: 'grid', gridTemplateColumns: stackInspector ? '1fr' : '1fr 420px', gap: 32, alignItems: 'start' }}>
          <div style={{ minWidth: 0, overflowX: 'auto' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(220px, 1.5fr) 70px 64px 72px 2fr',
              minWidth: 560,
              gap: 14, padding: '10px 4px',
              fontSize: 11, color: 'var(--muted)', fontWeight: 500,
              textTransform: 'uppercase', letterSpacing: '0.06em',
              borderBottom: '1px solid var(--border)',
            }}>
              <span>Span</span>
              <span style={{ textAlign: 'right' }}>Duration</span>
              <span style={{ textAlign: 'right' }}>Tokens</span>
              <span style={{ textAlign: 'right' }}>Cost</span>
              <div style={{ position: 'relative', height: 16 }}>
                {tickValues.map((v, i) => (
                  <span key={i} style={{
                    position: 'absolute', left: (v / totalDuration) * 100 + '%',
                    transform: 'translateX(-50%)', fontSize: 10.5, color: 'var(--muted)',
                    opacity: 0.7, whiteSpace: 'nowrap',
                  }}>{fmtMs(v)}</span>
                ))}
              </div>
            </div>

            {t.spans.map((span, i) => {
              const hidden = hiddenIds.has(span.id);
              return (
                <div
                  key={span.id}
                  aria-hidden={hidden || undefined}
                  style={{
                    display: 'grid',
                    gridTemplateRows: hidden ? '0fr' : '1fr',
                    opacity: hidden ? 0 : 1,
                    pointerEvents: hidden ? 'none' : 'auto',
                    transition: 'grid-template-rows 0.32s ease, opacity 0.26s ease',
                  }}
                >
                  <div style={{ overflow: 'hidden', minHeight: 0 }}>
                    <SpanRow
                      span={span}
                      isLast={i === t.spans.length - 1}
                      isActive={activeSpanId === span.id}
                      isCollapsed={collapsed.has(span.id)}
                      isHidden={hidden}
                      totalDuration={totalDuration}
                      tickValues={tickValues}
                      onSelect={() => setActiveSpanId(span.id)}
                      onToggleCollapse={() => toggleCollapse(span.id)}
                    />
                  </div>
                </div>
              );
            })}

            <div style={{
              display: 'flex', alignItems: 'center', gap: 18,
              padding: '14px 4px 0', borderTop: '1px solid var(--border)',
              fontSize: 12, color: 'var(--muted)', marginTop: 6,
            }}>
              <LegendDot color={TYPE_COLORS.llm} label="LLM" />
              <LegendDot color={TYPE_COLORS.tool} label="Tool" />
              <LegendDot color={TYPE_COLORS.chain} label="Chain" />
              <LegendDot color={TYPE_COLORS.retriever} label="Retriever" />
              <LegendDot color={TYPE_COLORS.embedding} label="Embedding" />
              <LegendDot color={TYPE_COLORS.internal} label="Internal" />
              <LegendDot color="var(--error)" label="Failed" />
              <span style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
                {t.spans.length} spans · {fmtMs(totalDuration)} total
              </span>
            </div>
          </div>

          {/* Inspector panel */}
          <div style={{
            position: 'sticky', top: 90,
            paddingLeft: 24, borderLeft: '1px solid var(--border)',
            maxHeight: 'calc(100vh - 120px)', overflowY: 'auto',
          }}>
            <SpanInspector span={activeSpan} error={t.error} />
          </div>
        </div>
      )}

      {/* Tab: input */}
      {tab === 'input' && (
        <div style={{ maxWidth: 820 }}>
          <SectionLabel style={{ marginBottom: 10 }}>Agent input</SectionLabel>
          {t.input ? <CodeBlock maxHeight={500}>{prettifyMaybeJson(t.input)}</CodeBlock> : <EmptyBlock>No input recorded for this trace.</EmptyBlock>}
        </div>
      )}

      {/* Tab: output */}
      {tab === 'output' && (
        <div style={{ maxWidth: 820 }}>
          <SectionLabel style={{ marginBottom: 10 }}>Agent output</SectionLabel>
          {t.output
            ? <CodeBlock maxHeight={500}>{prettifyMaybeJson(t.output)}</CodeBlock>
            : <EmptyBlock>{t.status === 'failed' ? 'No output — trace failed before completion.' : 'No output recorded for this trace.'}</EmptyBlock>}
        </div>
      )}

      {/* Tab: metadata */}
      {tab === 'metadata' && (
        <div style={{ display: 'grid', gridTemplateColumns: stackInspector ? '1fr' : '1fr 1fr', gap: 40, maxWidth: 1040 }}>
          <div>
            <SectionLabel>Identity</SectionLabel>
            <MetaRow label="trace.id" value={t.id} mono />
            <MetaRow label="agent" value={t.agent} />
            <MetaRow label="agent.version" value={t.version} />
            <MetaRow label="session.id" value={t.sessionId} mono />
            <MetaRow label="user.id" value={t.user} mono />
            <SectionLabel style={{ margin: '24px 0 8px' }}>Timing</SectionLabel>
            <MetaRow label="started_at" value={t.startedAt} />
            <MetaRow label="ended_at" value={t.endedAt} />
            <MetaRow label="duration" value={fmtMs(t.duration)} />
          </div>
          <div>
            <SectionLabel>Runtime</SectionLabel>
            <MetaRow label="llm.model" value={t.model} mono />
            <MetaRow label="llm.provider" value={t.provider} />
            <MetaRow label="environment" value={t.environment} />
            <MetaRow label="region" value={t.region} />
            <MetaRow label="sdk" value={t.sdk} mono />
            {t.tags && t.tags.length > 0 && (
              <>
                <SectionLabel style={{ margin: '24px 0 8px' }}>Tags</SectionLabel>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '4px 0' }}>
                  {t.tags.map(tag => (
                    <span key={tag} style={{
                      fontSize: 11.5, padding: '3px 10px', borderRadius: 999,
                      color: 'var(--muted)', border: '1px solid var(--border)', background: 'transparent',
                    }}>{tag}</span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Tab: raw */}
      {tab === 'raw' && (
        <div style={{ maxWidth: 1040 }}>
          <SectionLabel style={{ marginBottom: 10 }}>Raw trace document</SectionLabel>
          <CodeBlock maxHeight={600}>{JSON.stringify(t, null, 2)}</CodeBlock>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SpanRow — one timeline row (label, metrics, gantt bar)
// ---------------------------------------------------------------------------

interface SpanRowProps {
  span: SpanDetail;
  isLast: boolean;
  isActive: boolean;
  isCollapsed: boolean;
  isHidden: boolean;
  totalDuration: number;
  tickValues: number[];
  onSelect: () => void;
  onToggleCollapse: () => void;
}

function SpanRow({ span, isLast, isActive, isCollapsed, isHidden, totalDuration, tickValues, onSelect, onToggleCollapse }: SpanRowProps) {
  const color = spanColor(span);
  const leftPct = (span.start / totalDuration) * 100;
  const widthPct = Math.max(0.4, (span.duration / totalDuration) * 100);
  // Parents show their subtree total; leaves show their own cost.
  const isParent = isParentSpan(span);
  const rowCost = displayCost(span);
  const rowTokens = displayTokens(span);
  return (
    <button
      onClick={onSelect}
      tabIndex={isHidden ? -1 : undefined}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(220px, 1.5fr) 70px 64px 72px 2fr',
        minWidth: 560,
        gap: 14, width: '100%', padding: '11px 4px',
        textAlign: 'left', border: 'none',
        borderBottom: isLast ? 'none' : '1px solid color-mix(in srgb, var(--border) 50%, transparent)',
        alignItems: 'center',
        background: isActive
          ? 'color-mix(in srgb, var(--accent-soft) 100%, transparent)'
          : span.status === 'failed'
          ? 'color-mix(in srgb, var(--error) 5%, transparent)'
          : 'transparent',
        borderLeft: '2px solid ' + (isActive ? 'var(--accent)' : 'transparent'),
        cursor: 'pointer', fontFamily: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: span.depth * 16, minWidth: 0 }}>
        {isParent ? (
          <span
            role="button"
            aria-label={isCollapsed ? 'Expand child spans' : 'Collapse child spans'}
            aria-expanded={!isCollapsed}
            title={isCollapsed ? `Show ${span.childCount} hidden child span${span.childCount! > 1 ? 's' : ''}` : 'Hide child spans'}
            onClick={(e) => { e.stopPropagation(); onToggleCollapse(); }}
            style={{
              display: 'grid', placeItems: 'center', width: 16, height: 16, flexShrink: 0,
              borderRadius: 4, color: 'var(--muted)', cursor: 'pointer',
            }}
          >
            <span style={{
              fontSize: 9, lineHeight: 1,
              transform: isCollapsed ? 'rotate(-90deg)' : 'none',
              transition: 'transform 0.12s ease',
            }}>▼</span>
          </span>
        ) : (
          <span style={{ width: 16, flexShrink: 0, textAlign: 'center', color: 'var(--muted)', fontSize: 12, opacity: 0.5 }}>
            {span.depth > 0 ? '└' : ''}
          </span>
        )}
        <span style={{ display: 'inline-block', width: 7, height: 7, background: color, borderRadius: 2, flexShrink: 0 }} />
        <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{span.name}</span>
        <SpanTypeTag type={span.type} />
      </div>
      <span style={{ fontSize: 12.5, textAlign: 'right', color: 'var(--foreground)', fontVariantNumeric: 'tabular-nums' }}>{fmtMs(span.duration)}</span>
      <span
        title={isParent ? `Subtree total over ${span.childCount} child span${span.childCount! > 1 ? 's' : ''}` : undefined}
        style={{ fontSize: 12.5, textAlign: 'right', color: rowTokens > 0 ? 'var(--foreground)' : 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}
      >
        {rowTokens > 0 ? fmtNum(rowTokens) : '—'}
      </span>
      <span
        title={isParent ? `Subtree total over ${span.childCount} child span${span.childCount! > 1 ? 's' : ''}` : undefined}
        style={{ fontSize: 12.5, textAlign: 'right', color: rowCost > 0 ? 'var(--foreground)' : 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}
      >
        {rowCost > 0 ? fmtCost(rowCost) : '—'}
      </span>
      <div style={{
        position: 'relative', height: 22,
        background: 'color-mix(in srgb, var(--border) 55%, transparent)',
        borderRadius: 4, overflow: 'hidden',
      }}>
        {tickValues.slice(1, -1).map((v, ti) => (
          <span key={ti} style={{
            position: 'absolute', top: 0, bottom: 0,
            left: (v / totalDuration) * 100 + '%',
            width: 1, background: 'color-mix(in srgb, var(--foreground) 4%, transparent)',
          }} />
        ))}
        <div style={{
          position: 'absolute', top: 0, bottom: 0,
          left: leftPct + '%', width: widthPct + '%',
          background: color, opacity: 0.9, borderRadius: 3,
          display: 'flex', alignItems: 'center', paddingLeft: 6,
        }}>
          {widthPct > 14 && (
            <span style={{ fontSize: 10.5, color: 'var(--accent-contrast)', fontWeight: 500, whiteSpace: 'nowrap' }}>
              {fmtMs(span.duration)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// LegendDot
// ---------------------------------------------------------------------------

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 9, height: 9, background: color, borderRadius: 2, display: 'inline-block' }} />
      {label}
    </span>
  );
}

