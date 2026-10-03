/**
 * A monotonic-ish clock seam for metrics timing (task 13.6).
 *
 * The Gateway measures call duration and time-to-first-sentence by reading a
 * clock at call start, at first release, and at completion. Reading the clock
 * through this seam — rather than calling `Date.now()` inline — lets a test
 * inject a fake clock and advance it deterministically, so a recorded
 * `durationMs` or `ttfsMs` is an exact, asserted value rather than a flaky
 * wall-clock delta.
 *
 * `now()` returns epoch milliseconds. The default {@link systemClock} is
 * `Date.now`; the record's `at` field is this same reading at call start, so
 * the log timestamp and the duration share one clock.
 */

/** A source of the current time in epoch milliseconds. */
export interface Clock {
  /** The current time, in milliseconds. */
  now(): number;
}

/** The production clock: `Date.now`. */
export const systemClock: Clock = {
  now: () => Date.now(),
};
