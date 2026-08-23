export interface Formatter<T> {
  format(value: T): string;
}

export class DurationFormatter implements Formatter<number> {
  format(ms: number): string {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
  }
}

export class CostFormatter implements Formatter<number> {
  format(usd: number): string {
    if (usd < 0.001) return '< $0.001';
    if (usd < 0.01) return `$${usd.toFixed(4)}`;
    return `$${usd.toFixed(2)}`;
  }
}

export class TokenFormatter implements Formatter<number> {
  format(n: number): string {
    if (n < 1000) return String(Math.round(n));
    if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
}

export const durationFormatter = new DurationFormatter();
export const costFormatter = new CostFormatter();
export const tokenFormatter = new TokenFormatter();

// ---------------------------------------------------------------------------
// Quick inline helpers — used in JSX
// ---------------------------------------------------------------------------

export const fmtCost = (n: number): string => {
  if (n === 0) return '$0.00';
  if (n < 0.01) return '$' + n.toFixed(4);
  if (n < 1) return '$' + n.toFixed(3);
  return '$' + n.toFixed(2);
};

export const fmtNum = (n: number): string => n.toLocaleString();

export const fmtPct = (n: number): string =>
  (n < 0.01 && n > 0 ? '<0.01' : n.toFixed(n < 10 ? 2 : 1)) + '%';

export const fmtMs = (n: number): string =>
  n >= 1000 ? (n / 1000).toFixed(2) + 's' : Math.round(n) + 'ms';
