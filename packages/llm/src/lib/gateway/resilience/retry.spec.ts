import { describe, expect, it, vi } from 'vitest';

import type { Role } from '../../config/models-config.js';
import {
  FALLBACK_ROLE,
  runWithRetryAndFallback,
  type AttemptFn,
} from './retry.js';

/**
 * Build an attempt that fails for its first `failures` invocations and then
 * resolves to `` `ok:${role}` ``, recording the role each invocation ran under.
 */
function flakyAttempt(failures: number): {
  readonly attempt: AttemptFn<string>;
  readonly roles: Role[];
} {
  const roles: Role[] = [];
  let calls = 0;
  const attempt: AttemptFn<string> = async (role) => {
    roles.push(role);
    calls++;
    if (calls <= failures) {
      throw new Error(`fail ${calls} under ${role}`);
    }
    return `ok:${role}`;
  };
  return { attempt, roles };
}

describe('runWithRetryAndFallback', () => {
  it('returns the first attempt when it succeeds, no retry', async () => {
    const { attempt, roles } = flakyAttempt(0);
    await expect(runWithRetryAndFallback('voice', attempt)).resolves.toBe(
      'ok:voice',
    );
    expect(roles).toEqual(['voice']);
  });

  it('retries once under the same role and succeeds on the retry', async () => {
    const { attempt, roles } = flakyAttempt(1);
    const onRetry = vi.fn();
    await expect(
      runWithRetryAndFallback('voice', attempt, { onRetry }),
    ).resolves.toBe('ok:voice');
    expect(roles).toEqual(['voice', 'voice']);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('falls back to the fast role after two failures', async () => {
    const { attempt, roles } = flakyAttempt(2);
    const onFallback = vi.fn();
    await expect(
      runWithRetryAndFallback('voice', attempt, { onFallback }),
    ).resolves.toBe(`ok:${FALLBACK_ROLE}`);
    expect(roles).toEqual(['voice', 'voice', 'fast']);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it('propagates a fallback failure to the caller', async () => {
    const { attempt, roles } = flakyAttempt(3);
    await expect(runWithRetryAndFallback('voice', attempt)).rejects.toThrow(
      /under fast/,
    );
    expect(roles).toEqual(['voice', 'voice', 'fast']);
  });

  it('does not fall back for the narrator — retries once then throws', async () => {
    const { attempt, roles } = flakyAttempt(2);
    const onFallback = vi.fn();
    await expect(
      runWithRetryAndFallback('narrator', attempt, { onFallback }),
    ).rejects.toThrow(/under narrator/);
    expect(roles).toEqual(['narrator', 'narrator']);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('still falls back when the failing role is already fast', async () => {
    const { attempt, roles } = flakyAttempt(2);
    await expect(runWithRetryAndFallback('fast', attempt)).resolves.toBe(
      'ok:fast',
    );
    expect(roles).toEqual(['fast', 'fast', 'fast']);
  });
});
