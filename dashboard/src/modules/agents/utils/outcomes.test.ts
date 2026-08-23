import { describe, it, expect } from 'vitest';
import { deriveRunOutcomes } from './outcomes';

describe('deriveRunOutcomes', () => {
  it('recovers the failed count the server derived the rate from', () => {
    // error_rate arrives as failed/calls; rounding the product must round-trip.
    for (const [calls, failed] of [[156, 13], [1, 1], [1, 0], [100000, 7]] as const) {
      const rate = failed / calls;
      expect(deriveRunOutcomes(calls, rate)).toEqual({ completed: calls - failed, failed });
    }
  });

  it('handles zero runs', () => {
    expect(deriveRunOutcomes(0, 0)).toEqual({ completed: 0, failed: 0 });
  });

  it('clamps failed into [0, calls] for out-of-range rates', () => {
    expect(deriveRunOutcomes(10, 1.5)).toEqual({ completed: 0, failed: 10 });
    expect(deriveRunOutcomes(10, -0.1)).toEqual({ completed: 10, failed: 0 });
  });
});
