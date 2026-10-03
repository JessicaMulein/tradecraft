/**
 * Per-call metrics timing and record assembly (task 13.6).
 *
 * One {@link CallMetrics} tracks a single model call from start to finish: it
 * reads the clock at construction (the record's `at` and the start of both
 * timers), captures the first-released-sentence moment when the dialogue or
 * narrator layer calls `markReleased()`, counts completion tokens as they
 * stream, and on completion builds the {@link MetricsRecord} and hands it to
 * the sink. All of the timing arithmetic — duration, time-to-first-sentence and
 * tokens-per-second — lives here so the Gateway's call paths only have to say
 * *when* things happen, not *how* the record is computed.
 *
 * The sink append is best effort: {@link finish} swallows any error the sink
 * raises, so a failing or missing metrics log can never break a model call.
 */

import type { Clock } from './clock.js';
import type {
  MetricsOutcome,
  MetricsRecord,
  MetricsSink,
} from './metrics-record.js';

/** Milliseconds in one second, for the tokens-per-second rate. */
const MS_PER_SEC = 1000;

/**
 * Tracks timing and token counts for a single call and writes the record on
 * completion. Created when a call is routed (so `at` and the timers start from
 * the same instant the handle is offered to the caller), fed `markReleased()`
 * and `countTokens()` as the call runs, and sealed with `finish()` exactly once.
 */
export class CallMetrics {
  private readonly startedAt: number;
  private releasedAt?: number;
  private tokens = 0;
  private finished = false;

  constructor(
    private readonly role: string,
    private readonly model: string,
    private readonly purpose: string,
    private readonly clock: Clock,
    private readonly sink: MetricsSink,
  ) {
    this.startedAt = clock.now();
  }

  /**
   * Record that the guards released the call's first sentence. Idempotent:
   * only the first call sets the time-to-first-sentence, so a caller that
   * reports more than one release does not move the measurement.
   */
  markReleased(): void {
    if (this.releasedAt === undefined) {
      this.releasedAt = this.clock.now();
    }
  }

  /** Count `n` completion tokens produced (default one). */
  countTokens(n = 1): void {
    this.tokens += n;
  }

  /**
   * Seal the call and append its record to the sink. Idempotent: a second call
   * is ignored, so a call that both resolves and settles a bridge cannot write
   * two lines. The sink append is best effort — any error it raises is
   * swallowed so metrics never break the call.
   */
  finish(outcome: MetricsOutcome): void {
    if (this.finished) {
      return;
    }
    this.finished = true;

    const durationMs = this.clock.now() - this.startedAt;
    const ttfsMs =
      this.releasedAt === undefined ? null : this.releasedAt - this.startedAt;
    const tokensPerSec =
      durationMs > 0 ? (this.tokens * MS_PER_SEC) / durationMs : null;

    const record: MetricsRecord = {
      at: this.startedAt,
      role: this.role,
      model: this.model,
      purpose: this.purpose,
      ttfsMs,
      durationMs,
      completionTokens: this.tokens,
      tokensPerSec,
      outcome,
    };

    try {
      this.sink.append(record);
    } catch {
      /* best effort: a failing sink never breaks the call */
    }
  }
}
