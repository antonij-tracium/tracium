import type { Trace } from './Trace';
import type { Span } from './Span';

export interface TraceDetail extends Trace {
  spans: Span[];
}
