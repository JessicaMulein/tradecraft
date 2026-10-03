/**
 * Play metrics: the per-call record the Gateway appends to the metrics log
 * (Requirements 15.3, 15.6; design "LLM Gateway": Play metrics).
 *
 * Req 15.3 sets a target time to first released sentence per role and requires
 * the Sim to record the *actual* timings; Req 15.6 requires the Gateway to
 * append each model call's role, model id, time to first released sentence,
 * total duration and tokens per second to a local metrics log. This module is
 * the record shape and the sink seam those requirements hang on.
 *
 * A metrics log is JSON Lines: one {@link MetricsRecord} per line, appended in
 * call order, at the path from `scenario.metrics.path` (default
 * `logs/metrics.jsonl`). The eval harness (task 23) reads the same format, so
 * the field names here are the stable contract between the two: a change here
 * is a change the harness must track. The record is deliberately flat and
 * JSON-primitive so a line always round-trips through `JSON.parse`.
 *
 * Writes are asynchronous and best effort. Recording a metric must never block
 * a model call or fail one, so the {@link FileMetricsSink} appends without
 * awaiting the call path and swallows any write error — a missing or
 * unwritable log costs a line of telemetry, never a turn of play.
 */

import { appendFile } from 'node:fs/promises';

/**
 * How a call ended, as recorded in the metrics log.
 *
 * - `ok` — the call completed and released its output.
 * - `timeout` — the call exceeded its role's timeout budget.
 * - `fallback` — the call failed under its role and was re-issued under `fast`
 *   (Req 16.2); the record is for the call as the pipeline saw it.
 * - `rejected` — the call failed outright (e.g. a structured response that did
 *   not validate, or a narration that gave up without a fast fallback).
 */
export type MetricsOutcome = 'ok' | 'timeout' | 'fallback' | 'rejected';

/** The set of {@link MetricsOutcome} values, for validation and iteration. */
export const METRICS_OUTCOMES: readonly MetricsOutcome[] = [
  'ok',
  'timeout',
  'fallback',
  'rejected',
];

/**
 * One line of the metrics log: everything measured about a single model call.
 * Field names are the contract the eval harness reads (task 23); keep them
 * stable. All members are JSON primitives so a record always serialises to one
 * valid JSONL line.
 */
export interface MetricsRecord {
  /** Epoch milliseconds when the call started, from the Gateway's clock. */
  readonly at: number;
  /** The Model Role the call was routed to. */
  readonly role: string;
  /** The model id the call used, from the role's config. */
  readonly model: string;
  /**
   * The pipeline stage / call kind this call served: `stream`, `structured` or
   * `narration` by default, or a caller-supplied label (e.g. `intent`,
   * `voice`, `narrator`, `extraction`) when the stage is known.
   */
  readonly purpose: string;
  /**
   * Time to the first sentence *released by the guards*, in milliseconds,
   * measured from call start to when `CallHandle.markReleased()` is called.
   * `null` when the call released no sentence (it failed, or the caller never
   * reported a release).
   */
  readonly ttfsMs: number | null;
  /** Total wall-clock duration of the call, in milliseconds. */
  readonly durationMs: number;
  /**
   * Completion tokens produced: the number of non-empty streamed tokens for a
   * stream/narration, or the response length for a structured call. `0` when
   * the call produced nothing.
   */
  readonly completionTokens: number;
  /**
   * Completion tokens per second over the call's duration, or `null` when the
   * duration is zero (so the rate is undefined rather than infinite).
   */
  readonly tokensPerSec: number | null;
  /** How the call ended. */
  readonly outcome: MetricsOutcome;
}

/**
 * The sink the Gateway appends metrics to, one record per call. Kept behind an
 * interface so production writes to a file while tests use an in-memory sink
 * and read the records back. {@link append} returns `void`, not a promise: the
 * call path never awaits it, matching the "asynchronous and best effort" rule.
 */
export interface MetricsSink {
  /** Append one record. Must not block or throw; errors are swallowed. */
  append(record: MetricsRecord): void;
}

/**
 * A {@link MetricsSink} backed by a file, writing JSON Lines to the configured
 * metrics path. Each record is serialised and appended with the async
 * `fs/promises.appendFile`, and the append is *not* awaited by the caller:
 * `append` fires the write and returns, so recording a metric never blocks a
 * model call. A write failure (missing directory, permissions) is swallowed,
 * so telemetry trouble can never fail a turn of play.
 *
 * Appends are *serialised* through an internal tail promise ({@link writeTail}):
 * each write is chained after the previous one has settled, so lines land in
 * call order even when `append` is called twice in quick succession. Without
 * this, two un-awaited `appendFile` calls could complete out of order and
 * write the JSONL lines reversed — which the eval harness (task 23), reading
 * the log in call order, must never see. `append` still returns immediately and
 * never throws: it only schedules work on the tail.
 */
export class FileMetricsSink implements MetricsSink {
  /**
   * The tail of the serialised write chain. Each {@link append} chains its
   * write after this promise settles, then becomes the new tail, so writes
   * execute strictly in call order. A prior write's failure is swallowed so it
   * never breaks the chain for later records.
   */
  private writeTail: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  append(record: MetricsRecord): void {
    const line = `${JSON.stringify(record)}\n`;
    // Serialise onto the tail so writes land in call order, best effort: the
    // caller never awaits this and a write error is swallowed, so a lost line
    // (or an unwritable path) never blocks or fails a model call.
    this.writeTail = this.writeTail
      .catch(() => {
        /* a prior write's failure must not break the chain */
      })
      .then(() => appendFile(this.path, line, 'utf8'))
      .catch(() => {
        /* best effort: a lost metrics line never fails a call */
      });
  }

  /**
   * Resolves once every record appended so far has been written (or its write
   * has failed and been swallowed). Callers never need it in play; tests and a
   * shutdown path use it instead of guessing how long the writes take.
   */
  flushed(): Promise<void> {
    return this.writeTail;
  }
}

/**
 * A {@link MetricsSink} that keeps records in memory. Used by tests to assert
 * the Gateway records the right fields without touching the disk, mirroring the
 * in-memory record sink used for record/replay. A sink built with
 * `{ throwOnAppend: true }` throws on every append, so a test can prove the
 * Gateway's recording is best effort — a failing sink does not break the call.
 */
export class InMemoryMetricsSink implements MetricsSink {
  readonly records: MetricsRecord[] = [];
  private readonly throwOnAppend: boolean;

  constructor(options: { readonly throwOnAppend?: boolean } = {}) {
    this.throwOnAppend = options.throwOnAppend ?? false;
  }

  append(record: MetricsRecord): void {
    if (this.throwOnAppend) {
      throw new Error('metrics sink append failed');
    }
    this.records.push(record);
  }
}
