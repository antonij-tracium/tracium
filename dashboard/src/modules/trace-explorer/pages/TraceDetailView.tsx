import { useTrace } from '../hooks/useTrace';
import { toTraceView } from '../utils/toTraceView';
import { TraceView } from '../../trace-inspector';
import { Spinner, EmptyState } from '../../../common';

export interface TraceDetailViewProps {
  /** Trace selected from the overview activity feed / command palette. */
  traceId: string;
  setView: (v: string) => void;
}

/**
 * Connected trace detail — fetches the selected trace from the API, adapts it
 * to the shared view-model, and renders the same {@link TraceView} as the demo
 * page. Span input/output text and tool lists aren't in the API, so those
 * sections stay empty for live traces.
 */
export function TraceDetailView({ traceId, setView }: TraceDetailViewProps) {
  const { data, isLoading, error } = useTrace(traceId);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
        <Spinner size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, color: 'var(--error)' }}>
        Failed to load trace: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    );
  }

  if (!data) {
    return <EmptyState message="Trace not found" description="This trace is no longer available." />;
  }

  // Key by trace id so the view remounts per trace; otherwise its per-trace
  // state (selected span, collapsed set, tab) would persist when navigating
  // between two already-cached traces and leave the inspector showing a span
  // id that doesn't exist in the new trace.
  return <TraceView key={data.trace_id} trace={toTraceView(data)} setView={setView} />;
}

