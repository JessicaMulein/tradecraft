import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TimeoutError, withTimeout } from './timeout.js';

/** A promise that never settles on its own, for driving the timeout. */
function never<T>(): Promise<T> {
  return new Promise<T>(() => {
    /* intentionally never resolves */
  });
}

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the promise when it settles before the timeout', async () => {
    const promise = Promise.resolve('done');
    await expect(withTimeout(promise, 1000)).resolves.toBe('done');
  });

  it('rejects with the promise error when it rejects first', async () => {
    const promise = Promise.reject(new Error('boom'));
    await expect(withTimeout(promise, 1000)).rejects.toThrow('boom');
  });

  it('rejects with a TimeoutError when the timeout wins', async () => {
    const pending = never<string>();
    const raced = withTimeout(pending, 500, { label: 'call' });
    const assertion = expect(raced).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it('reports the budget and label on the TimeoutError', async () => {
    const pending = never<string>();
    const raced = withTimeout(pending, 750, { label: 'narration' });
    const assertion = expect(raced).rejects.toMatchObject({
      timeoutMs: 750,
      message: expect.stringContaining('narration'),
    });
    await vi.advanceTimersByTimeAsync(750);
    await assertion;
  });

  it('aborts the supplied controller when the timeout fires', async () => {
    const controller = new AbortController();
    const pending = never<string>();
    const raced = withTimeout(pending, 300, { controller });
    const assertion = expect(raced).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(300);
    await assertion;
    expect(controller.signal.aborted).toBe(true);
  });

  it('bypasses the race for a non-positive timeout', async () => {
    await expect(withTimeout(Promise.resolve('x'), 0)).resolves.toBe('x');
  });

  it('does not fire a TimeoutError after the promise resolves', async () => {
    const promise = Promise.resolve('fast');
    const result = await withTimeout(promise, 1000);
    expect(result).toBe('fast');
    // Advancing past the budget must not reject anything.
    await vi.advanceTimersByTimeAsync(2000);
  });
});
