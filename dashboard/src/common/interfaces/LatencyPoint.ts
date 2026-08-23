export interface LatencyPoint {
  label: string;
  // null marks a bucket with no runs: latency is undefined, not 0. The chart
  // renders these as gaps rather than a dip to the floor.
  p50: number | null;
  p95: number | null;
  p99: number | null;
}
