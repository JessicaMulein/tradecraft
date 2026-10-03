/**
 * Timeout handling (Requirement 16.2; design "LLM Gateway").
 *
 * Each Model Role carries a `timeoutMs` in its `RoleConfig`, already passed to
 * the OpenAI client as the per-call request option. That covers the live
 * transport, but the Gateway needs timeouts it controls directly for two
 * reasons: a streaming call must time out on *first byte* (not just the whole
 * request), and the retry/fallback policy needs a rejection to react to when a
 * call simply hangs. {@link withTimeout} provides that: it races a promise
 * against the role's timeout and rejects with a {@link TimeoutError} if the
 * timeout wins, so a call that exceeds its budget becomes a failure the policy
 * treats like any other (Req 16.2).
 *
 * The timer is cleared when the promise settles first, so a timed-out race
 * never leaks a pending timer. When an {@link AbortController} is supplied, the
 * timeout also aborts it, letting an in-flight operation (such as a stream)
 * stop its own work rather than running on orphaned after the race is lost.
 */

/** Raised when an operation does not settle within its timeout budget. */
export class TimeoutError extends Error {
  /** The budget, in milliseconds, that was exceeded. */
  readonly timeoutMs: number;

  constructor(timeoutMs: number, label?: string) {
    super(
      label === undefined
        ? `operation timed out after ${timeoutMs}ms`
        : `${label} timed out after ${timeoutMs}ms`,
    );
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/** Options for {@link withTimeout}. */
export interface TimeoutOptions {
  /** A label used in the error message, e.g. the role or purpose. */
  readonly label?: string;
  /**
   * Aborted when the timeout fires, so the raced operation can stop its own
   * work. The Gateway passes the call's controller so a hung stream is torn
   * down rather than left running.
   */
  readonly controller?: AbortController;
}

/**
 * Race `promise` against `timeoutMs`. Resolves/rejects with `promise` if it
 * settles first; otherwise rejects with a {@link TimeoutError} and, if given,
 * aborts the controller. A non-positive timeout disables the race and simply
 * returns the promise, so callers can opt out with `0`.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  options: TimeoutOptions = {},
): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      options.controller?.abort(new TimeoutError(timeoutMs, options.label));
      reject(new TimeoutError(timeoutMs, options.label));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
