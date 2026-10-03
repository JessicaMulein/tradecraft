import { describe, expect, it } from 'vitest';

import type { ResidentSetEstimate } from './client-interface.js';
import {
  checkEstimate,
  formatMemoryShortfall,
  type EstimateCheckResult,
} from './estimate-check.js';

const GiB = 1024 ** 3;

const estimate = (over: Partial<ResidentSetEstimate>): ResidentSetEstimate => ({
  fits: true,
  requiredBytes: 10 * GiB,
  availableBytes: 64 * GiB,
  ...over,
});

describe('checkEstimate', () => {
  it('is ok when the estimate fits, carrying the raw figures', () => {
    const result = checkEstimate(
      estimate({ fits: true, requiredBytes: 40 * GiB, availableBytes: 64 * GiB }),
    );
    expect(result.ok).toBe(true);
    expect(result.requiredBytes).toBe(40 * GiB);
    expect(result.availableBytes).toBe(64 * GiB);
  });

  it('is not ok and reports the shortfall when it does not fit', () => {
    const result = checkEstimate(
      estimate({ fits: false, requiredBytes: 80 * GiB, availableBytes: 64 * GiB }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return; // narrow for TypeScript
    expect(result.shortfall).toEqual({
      requiredBytes: 80 * GiB,
      availableBytes: 64 * GiB,
      deficit: 16 * GiB,
    });
  });

  it('clamps the deficit at 0 for a guardrail-only failure', () => {
    // The SDK says it does not fit even though required <= available (e.g. a
    // guardrail the byte figures do not capture). The deficit stays >= 0.
    const result = checkEstimate(
      estimate({ fits: false, requiredBytes: 30 * GiB, availableBytes: 64 * GiB }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.shortfall.deficit).toBe(0);
  });

  it('never loads: it only reads the estimate and returns a result', () => {
    // A pure function over a plain record — there is nothing to load, and the
    // input estimate itself is produced without loading.
    const input = estimate({ fits: false, requiredBytes: 70 * GiB });
    const before = JSON.stringify(input);
    checkEstimate(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});

describe('formatMemoryShortfall', () => {
  it('names required, available and the deficit on a shortfall', () => {
    const result: EstimateCheckResult = checkEstimate(
      estimate({ fits: false, requiredBytes: 80 * GiB, availableBytes: 64 * GiB }),
    );
    const message = formatMemoryShortfall(result);
    expect(message).toContain('80.00 GiB');
    expect(message).toContain('64.00 GiB');
    expect(message).toContain('short by 16.00 GiB');
  });

  it('is the empty string when the set fits', () => {
    const result = checkEstimate(estimate({ fits: true }));
    expect(formatMemoryShortfall(result)).toBe('');
  });
});
