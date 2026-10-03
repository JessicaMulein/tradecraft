/**
 * The Model Manager's connection path (Requirement 43.1; design "Model
 * Manager", step 1).
 *
 * Step 1 of the preflight is: connect to LM Studio through the SDK, and if the
 * local server is not running, start it (`lms server start`) and retry. This
 * module is that policy, expressed over two injectable actions so it is
 * testable offline without a real server or a spawned process:
 *
 *   - {@link ConnectAction} attempts a single connection and resolves with a
 *     connected {@link LmStudioClient}, or rejects if the server is unreachable.
 *   - {@link StartServerAction} runs `lms server start` (the real adapter shells
 *     out; a test supplies a spy that flips a fake "server up" flag).
 *
 * The policy connects once; on failure it starts the server and then retries
 * the connection with a bounded number of attempts and a backoff between them.
 * If every attempt fails it rejects with a {@link ConnectionError} naming the
 * cause, so the preflight (task 25.2) refuses to start and reports it the way
 * config validation does (Requirement 43.8). The server is started at most once
 * — a server that is already up but momentarily unreachable just gets retried.
 */

import type { LmStudioClient } from './client-interface.js';

/** Attempt a single connection; reject if the server is not reachable. */
export type ConnectAction = () => Promise<LmStudioClient>;

/** Run `lms server start`; reject if the start command itself fails. */
export type StartServerAction = () => Promise<void>;

/** Pause for `ms` milliseconds between retries. Injectable for tests. */
export type SleepFn = (ms: number) => Promise<void>;

/** Raised when the client cannot connect even after starting the server. */
export class ConnectionError extends Error {
  /** The number of connection attempts that were made. */
  readonly attempts: number;
  /** The last underlying failure, if any. */
  override readonly cause?: unknown;

  constructor(attempts: number, cause?: unknown) {
    const detail =
      cause instanceof Error ? cause.message : cause === undefined ? '' : String(cause);
    super(
      detail === ''
        ? `could not connect to LM Studio after ${attempts} attempt(s)`
        : `could not connect to LM Studio after ${attempts} attempt(s): ${detail}`,
    );
    this.name = 'ConnectionError';
    this.attempts = attempts;
    this.cause = cause;
  }
}

/** Options controlling the connection-retry policy. */
export interface ConnectOptions {
  /** Attempt a single connection. Required. */
  readonly connect: ConnectAction;
  /** Start the LM Studio server (`lms server start`). Required. */
  readonly startServer: StartServerAction;
  /**
   * Maximum connection attempts, including the first before the server is
   * started and every retry after. Must be at least 1. Default 5.
   */
  readonly maxAttempts?: number;
  /** Backoff between attempts, in milliseconds. Default 500. */
  readonly backoffMs?: number;
  /** Sleep implementation; defaults to a real timer. Injectable for tests. */
  readonly sleep?: SleepFn;
  /** Observability hook called before each retry. Failures here are ignored. */
  readonly onRetry?: (attempt: number, error: unknown) => void;
}

const defaultSleep: SleepFn = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Obtain a connected {@link LmStudioClient}, starting the server if the first
 * connection fails.
 *
 * Sequence:
 *   1. Try to connect. If it works, return the client — the server was already
 *      up and no process is started.
 *   2. On failure, start the server once (`lms server start`), then retry the
 *      connection up to `maxAttempts - 1` more times, sleeping `backoffMs`
 *      between tries, until one succeeds.
 *   3. If every attempt fails, reject with a {@link ConnectionError} carrying
 *      the attempt count and the last error.
 *
 * If starting the server itself fails, the remaining retries still run — a
 * `lms server start` that errors because the server is *already* starting
 * should not abort the connection outright.
 */
export async function connectWithRetry(
  options: ConnectOptions,
): Promise<LmStudioClient> {
  const maxAttempts = options.maxAttempts ?? 5;
  if (maxAttempts < 1) {
    throw new RangeError('maxAttempts must be at least 1');
  }
  const backoffMs = options.backoffMs ?? 500;
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  let serverStarted = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await options.connect();
    } catch (error) {
      lastError = error;

      // No point starting the server or sleeping after the final attempt.
      if (attempt === maxAttempts) {
        break;
      }

      // Start the server once, on the first failure, then let retries connect.
      if (!serverStarted) {
        serverStarted = true;
        try {
          await options.startServer();
        } catch {
          // A start failure (e.g. "already starting") is non-fatal; the
          // retries below are the real test of whether the server came up.
        }
      }

      options.onRetry?.(attempt, error);
      if (backoffMs > 0) {
        await sleep(backoffMs);
      }
    }
  }

  throw new ConnectionError(maxAttempts, lastError);
}
