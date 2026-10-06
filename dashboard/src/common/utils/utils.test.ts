import { describe, expect, it } from 'vitest';
import { bucketLabel } from './buckets';
import { costFormatter } from './formatters';

describe('bucketLabel', () => {
  it('reads daily buckets as UTC dates', () => {
    const midnightUtc = Date.UTC(2026, 9, 6);
    expect(bucketLabel(midnightUtc, '7d')).toBe('Tue 10/6');
    expect(bucketLabel(midnightUtc, '30d')).toBe('10/6');
  });
});

describe('costFormatter', () => {
  it('shows a real zero as $0.00', () => {
    expect(costFormatter.format(0)).toBe('$0.00');
    expect(costFormatter.format(0.0004)).toBe('< $0.001');
  });
});
