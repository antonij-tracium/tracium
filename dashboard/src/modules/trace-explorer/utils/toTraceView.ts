import type { TraceDetail as LiveTrace, Span as LiveSpan } from '../interfaces';
import type { TraceDetail, SpanDetail } from '../../trace-inspector';

/** "Apr 18, 2026 · 7:41:17 AM" from epoch milliseconds. */
function formatTime(ms: number): string {
  const d = new Date(ms);
  const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  return `${date} · ${time}`;
}

/** A span is an LLM call when it carries a model or any token usage. */
function isLlmSpan(span: LiveSpan): boolean {
  return !!span.model || span.input_tokens > 0 || span.output_tokens > 0;
}

/**
 * Resolve a span's role. The collector classifies most spans from
 * instrumentation attributes the dashboard never sees (OpenInference /
 * Traceloop / GenAI), so its `kind` wins when present. Otherwise we fall back
 * to structural inference: the root is the agent; a span with a model/tokens is
 * an LLM call; a non-LLM span directly under an LLM call is the tool it invoked;
 * anything else is a structural/internal span (e.g. an OpenLLMetry workflow).
 */
function spanType(span: LiveSpan, isRoot: boolean, parent: LiveSpan | undefined): SpanDetail['type'] {
  if (span.kind) return span.kind;
  if (isRoot) return 'agent';
  if (isLlmSpan(span)) return 'llm';
  return parent && isLlmSpan(parent) ? 'tool' : 'internal';
}

/** Only attach attributes the API actually carries — `MetaRow` drops empties anyway. */
function spanAttributes(span: LiveSpan): SpanDetail['attributes'] {
  return Object.fromEntries(
    Object.entries({
      'llm.model': span.model,
      'llm.model_normalized': span.model_normalized,
      'finish_reason': span.finish_reason,
    }).filter(([, v]) => v != null && v !== ''),
  );
}

/**
 * Adapts a live, flat trace document into the rich shape the shared `TraceView`
 * renders. Fields the API doesn't carry (agent input/output text, per-span
 * tool lists, session/region/sdk metadata) are left undefined and `TraceView`
 * omits their UI.
 */
export function toTraceView(trace: LiveTrace): TraceDetail {
  const byId = new Map(trace.spans.map(s => [s.span_id, s]));
  const isRoot = (s: LiveSpan) => !s.parent_span_id || !byId.has(s.parent_span_id);

  const depthOf = (s: LiveSpan): number => {
    let depth = 0;
    let cur = s;
    while (!isRoot(cur) && depth < 64) {
      cur = byId.get(cur.parent_span_id)!;
      depth++;
    }
    return depth;
  };

  // Emit spans in tree pre-order so every parent renders immediately above its
  // children. The API orders by start_time_ms alone, which ties when a parent
  // and child start in the same millisecond (e.g. an explicit span wrapping an
  // auto-instrumented LLM call) and can put the child above its parent.
  const childrenOf = new Map<string, LiveSpan[]>();
  for (const s of trace.spans) {
    const key = isRoot(s) ? '' : s.parent_span_id;
    (childrenOf.get(key) ?? childrenOf.set(key, []).get(key)!).push(s);
  }
  for (const group of childrenOf.values()) {
    group.sort((a, b) => a.start_time_ms - b.start_time_ms);
  }

  const ordered: LiveSpan[] = [];
  const seen = new Set<string>();
  const visit = (s: LiveSpan) => {
    if (seen.has(s.span_id)) return; // guard against malformed cyclic parent links
    seen.add(s.span_id);
    ordered.push(s);
    for (const child of childrenOf.get(s.span_id) ?? []) visit(child);
  };
  for (const r of childrenOf.get('') ?? []) visit(r);
  // Any span unreachable from a root (e.g. a parent-link cycle) still renders.
  for (const s of trace.spans) if (!seen.has(s.span_id)) ordered.push(s);

  const spans: SpanDetail[] = ordered.map(s => ({
    id: s.span_id as unknown as SpanDetail['id'],
    name: s.name,
    type: spanType(s, isRoot(s), byId.get(s.parent_span_id)),
    start: s.start_time_ms - trace.start_time_ms,
    duration: s.duration_ms,
    depth: depthOf(s),
    cost: s.cost_usd,
    subtreeCost: s.subtree_cost_usd,
    childCount: (childrenOf.get(s.span_id) ?? []).length,
    tokens: s.input_tokens + s.output_tokens,
    // Sum only when both fields are present; a partial sum would yield NaN and
    // defeat the `?? tokens` fallback for data that predates the subtree fields.
    subtreeTokens: s.subtree_input_tokens != null && s.subtree_output_tokens != null
      ? s.subtree_input_tokens + s.subtree_output_tokens
      : undefined,
    inputTokens: s.input_tokens,
    outputTokens: s.output_tokens,
    status: s.error_type || s.error_message ? 'failed' : 'ok',
    error: s.error_type || s.error_message
      ? { type: s.error_type || 'error', message: s.error_message || '', code: '', stack: '' }
      : undefined,
    attributes: spanAttributes(s),
    input: s.input,
    output: s.output,
    availableTools: s.available_tools,
  }));

  const failing = trace.spans.find(s => s.error_type || s.error_message);
  // The agent-level Input/Output tabs mirror the root span's content. But many
  // instrumentations (e.g. OpenLLMetry workflow/task decorators) make the root a
  // structural span with no LLM content, while the actual prompt/completion live
  // on child gen_ai spans. Fall back to the earliest input and latest output that
  // were actually recorded so the tabs aren't empty for those traces.
  const root = trace.spans.find(isRoot);
  const byStart = [...trace.spans].sort((a, b) => a.start_time_ms - b.start_time_ms);
  const traceInput = root?.input || byStart.find(s => s.input)?.input;
  const traceOutput = root?.output || [...byStart].reverse().find(s => s.output)?.output;

  return {
    id: trace.trace_id as unknown as TraceDetail['id'],
    agent: trace.name || 'Untitled trace',
    status: trace.has_error ? 'failed' : 'completed',
    startedAt: formatTime(trace.start_time_ms),
    endedAt: formatTime(trace.end_time_ms),
    duration: trace.duration_ms,
    totalCost: trace.total_cost_usd,
    inputTokens: trace.spans.reduce((sum, s) => sum + s.input_tokens, 0),
    outputTokens: trace.spans.reduce((sum, s) => sum + s.output_tokens, 0),
    model: trace.spans.find(s => s.model)?.model ?? '',
    input: traceInput,
    output: traceOutput ?? null,
    spans,
    error: failing
      ? { type: failing.error_type || 'error', message: failing.error_message || '', code: '', stack: '' }
      : null,
  };
}
