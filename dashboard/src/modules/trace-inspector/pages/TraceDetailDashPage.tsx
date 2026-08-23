import { TraceView } from '../components';
import { TRACE_DETAIL } from '../data';

export interface TraceDetailDashPageProps {
  setView: (v: string) => void;
}

/**
 * Demo trace detail page. Feeds the shared {@link TraceView} with static mock
 * data — it exists only to bring the logged-out auth preview to life. The live,
 * API-backed counterpart is trace-explorer's TraceDetailView.
 */
export function TraceDetailDashPage({ setView }: TraceDetailDashPageProps) {
  return <TraceView trace={TRACE_DETAIL} setView={setView} />;
}

export default TraceDetailDashPage;
