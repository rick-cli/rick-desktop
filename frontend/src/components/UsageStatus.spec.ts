import { describe, expect, it } from 'vitest';
import { cacheHitPercent } from './UsageStatus';

describe('cacheHitPercent', () => {
  it('reports a fully cached prompt when uncached input is zero', () => {
    expect(cacheHitPercent(0, 4096)).toBe(100);
  });

  it('reports zero for an empty prompt and the correct mixed ratio', () => {
    expect(cacheHitPercent(0, 0)).toBe(0);
    expect(cacheHitPercent(100, 300)).toBe(75);
  });
});
