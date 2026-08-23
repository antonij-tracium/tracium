import type { SpanDetailId } from '../ids';
import type { AvailableTool } from './AvailableTool';
import type { TraceError } from './TraceError';

export interface SpanDetail {
  id: SpanDetailId;
  name: string;
  // 'internal' is the view's local fallback for structural spans the collector
  // left unclassified; the others mirror the wire-level Span.kind enum.
  type: 'agent' | 'llm' | 'tool' | 'chain' | 'retriever' | 'embedding' | 'internal';
  start: number;
  duration: number;
  depth: number;
  cost: number;
  // Cost of this span's whole subtree (itself + all descendants), supplied by
  // the API. childCount is the number of direct children; together they let the
  // timeline show a parent's rolled-up cost without re-summing on the client.
  subtreeCost?: number;
  childCount?: number;
  tokens: number;
  // Tokens (input + output) over this span's whole subtree, supplied by the
  // API. Mirrors subtreeCost; falls back to `tokens` for data that predates it.
  subtreeTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  status: 'ok' | 'failed';
  // This span's own error. The inspector falls back to the trace-level error
  // for data that predates the field.
  error?: TraceError;
  input?: string;
  output?: string;
  availableTools?: AvailableTool[];
  attributes: Record<string, string | number | boolean>;
}
