// A marker overlaid on a time-bucketed chart at a given bucket index — used to
// flag anomalous buckets in place (a dashed rule + optional flag label on the
// cost chart, a highlighted cell on the failures strip). The chart owns its
// geometry, so callers pass only the bucket index and how to render/handle it.
export interface ChartMarker {
  index: number; // bucket index in the chart's series
  color: string; // CSS color / design token
  label?: string; // optional flag text drawn near the top of the plot
  onClick?: () => void;
}
