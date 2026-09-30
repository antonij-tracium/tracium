// Shared time-range metadata for the overview and usage views.

// Ranges served from the daily rollup on the API side (windows > 30d). The rollup
// can't reconstruct per-trace durations, so latency is unavailable at these ranges
// (the latency panel and KPI tile are hidden). Keep this in sync with the API's
// UseRollup threshold.
export const LONG_RANGES = ['90d', '1y'] as const;

// isLongRange reports whether a range is rollup-backed (and thus has no latency).
export function isLongRange(range: string): boolean {
  return (LONG_RANGES as readonly string[]).includes(range);
}

// RANGE_LABEL is the lowercase, mid-sentence label for a range ("last 7 days"),
// used in chart/section subtitles.
export const RANGE_LABEL: Record<string, string> = {
  '24h': 'last 24 hours',
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
  '1y': 'last year',
};

// periodLabel is the capitalized, standalone form ("Last 7 days") for page subtitles.
export function periodLabel(range: string): string {
  const label = RANGE_LABEL[range] ?? RANGE_LABEL['7d'];
  return label[0].toUpperCase() + label.slice(1);
}
