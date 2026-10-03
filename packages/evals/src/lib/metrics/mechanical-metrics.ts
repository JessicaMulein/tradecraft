/**
 * The mechanical metrics the model evaluation harness measures over a fixture
 * run (task 23.2; Requirements 15.3, 18.2).
 *
 * Req 18.2 names the seven things the harness must measure *mechanically* — not
 * with the judge model, but by counting what the deterministic machinery
 * reports: Leak Guard trips, Specifics Guard trips, chance leaks, Told List
 * contradictions, refusal rate, time to first sentence, and tokens per second.
 * This module is the type the harness reports ({@link MechanicalMetrics}) and
 * the collector that accumulates it over a run ({@link MetricsCollector}).
 *
 * ## Where the counts come from
 *
 * The guards in `@tradecraft/dialogue` already decide and report their own
 * outcomes; the harness must not re-detect a leak or re-classify a refusal, it
 * must *count what the guards reported*. So this collector takes the guards'
 * existing outcome values as plain data and tallies them:
 *
 *   - **Leak Guard trips** — a trip is a Leak Guard turn that caught at least
 *     one hit (it regenerated or deflected). The Leak Guard's `GuardOutcome`
 *     carries `regenerations` and a `hits` array; a turn trips when it saw any
 *     hit. {@link recordLeakGuard} takes that shape.
 *   - **Specifics Guard trips** — a trip is a Specifics Guard check that
 *     rejected a sentence. The Specifics Guard's `SpecificsResult` carries `ok`
 *     and a `violations` array; a check trips when it is not `ok`.
 *     {@link recordSpecificsGuard} takes that shape.
 *   - **Chance leaks** and **Told List contradictions** come from the extractor's
 *     `ExtractionOutcome`: its `chanceLeaks` and `consistencyViolations` arrays
 *     (Req 5.6, 6.5). {@link recordExtraction} tallies both.
 *   - **Refusal rate** is per Model Role: of the replies the Refusal Guard
 *     settled for a role, the fraction that ended up deflected (a refusal/meta
 *     break the retries could not recover). The Refusal Guard's
 *     `RefusalGuardOutcome` carries `outcome` and `breaks`.
 *     {@link recordReply} tallies replies and deflections per role.
 *
 * These are *structural* shapes: the collector declares the minimal fields it
 * reads (see {@link LeakGuardTrip}, {@link SpecificsCheck}, …) rather than
 * importing `@tradecraft/dialogue`. `@tradecraft/evals` sits above dialogue in
 * the layering and deliberately does not depend on it (the fixture format next
 * door makes the same choice): a guard outcome is handed to the collector as
 * data by whatever drives the scene, so the collector counts without the
 * dependency. The field names match the guards' public outcome types exactly,
 * so a real `GuardOutcome` / `SpecificsResult` / `RefusalGuardOutcome` /
 * `ExtractionOutcome` is assignable to the collector's parameter with no
 * adapter.
 *
 * ## Timing (per Model Role)
 *
 * Time to first sentence and tokens per second are *per model call* numbers.
 * Req 15.3 wants them *per role* (the design targets ≤ 2 s TTFS on `narrator`
 * and ≤ 5 s on `voice`), so the collector keeps them broken down by Model Role.
 * A timing sample is wall-clock, which cannot be measured against a replay
 * gateway (a {@link import('@tradecraft/llm').ReplayGateway} serves recorded
 * tokens with no real latency). So timing is injected as data:
 * {@link recordTiming} takes a {@link CallTimingSample} with the role, the
 * measured `ttfsMs` and the token count and duration a tokens/sec is computed
 * from. A live run fills these from the Gateway's own clock (the same
 * `ttfsMs`/`durationMs`/`completionTokens` the Gateway logs to its metrics
 * sink); an offline test fills them from a fake {@link Clock} and scripted
 * token counts. The collector never reads a clock itself — it aggregates the
 * samples it is given — which is what keeps a run reproducible: the same
 * scripted samples always aggregate to the same per-role timings.
 */

import type { Clock } from '@tradecraft/llm';

// ---------------------------------------------------------------------------
// The Model Roles timing and refusal rate are broken down by
// ---------------------------------------------------------------------------

/**
 * The Model Roles a fixture scene exercises and the harness reports per-role
 * numbers for. A fixture `say` step routes to `voice` (a dialogue line) or
 * `narrator` (a narration request), so those are the two roles time-to-first
 * sentence, tokens/sec and refusal rate are broken down by (Req 15.3's per-role
 * TTFS target names exactly these two). The vocabulary is a subset of
 * `@tradecraft/llm`'s `Role`; kept as a local literal so the collector does not
 * import the whole config surface for two names.
 */
export const METRIC_ROLES = ['voice', 'narrator'] as const;

/** One of the {@link METRIC_ROLES} the harness reports per-role numbers for. */
export type MetricRole = (typeof METRIC_ROLES)[number];

// ---------------------------------------------------------------------------
// Structural shapes of the guard outcomes the collector counts
// ---------------------------------------------------------------------------

/**
 * The slice of the Leak Guard's `GuardOutcome` the collector reads. A Leak
 * Guard turn *trips* when it caught any hit — it regenerated at least once or
 * fell back to a deflection. Both `regenerations > 0` and a non-empty `hits`
 * array mark a trip; the collector treats either as the trip signal and also
 * tallies the total hit count for reporting. The field names match
 * `@tradecraft/dialogue`'s `GuardOutcome`, so a real outcome is assignable here.
 */
export interface LeakGuardTrip {
  /** How the turn resolved. A `deflected` turn always tripped. */
  readonly outcome: 'clean' | 'deflected';
  /** Regenerations performed; `> 0` means the guard caught a hit and retried. */
  readonly regenerations: number;
  /** Every hit caught across all attempts (Req 5.6). Empty on a clean first try. */
  readonly hits: readonly unknown[];
}

/**
 * The slice of the Specifics Guard's `SpecificsResult` the collector reads. A
 * check *trips* when it is not `ok` — it rejected the sentence for one or more
 * invented specifics. The field names match `@tradecraft/dialogue`'s
 * `SpecificsResult`.
 */
export interface SpecificsCheck {
  /** True when the sentence invented no specifics; `false` is a trip. */
  readonly ok: boolean;
  /** Every violation found, in reading order. Empty when `ok`. */
  readonly violations: readonly unknown[];
}

/**
 * The slice of the extractor's `ExtractionOutcome` the collector reads: the
 * chance leaks and consistency (Told List) violations found on a turn (Req 5.6,
 * 6.5). The field names match `@tradecraft/dialogue`'s `ExtractionOutcome`.
 */
export interface ExtractionCounts {
  /** True Claims the speaker did not know — the model guessed a secret. */
  readonly chanceLeaks: readonly unknown[];
  /** Claims that contradict the speaker's Told List while cover is intact. */
  readonly consistencyViolations: readonly unknown[];
}

/**
 * The slice of the Refusal Guard's `RefusalGuardOutcome` the collector reads. A
 * reply counts toward its role's refusal rate; a `deflected` outcome is a
 * refusal the retries could not recover (the numerator). The field names match
 * `@tradecraft/dialogue`'s `RefusalGuardOutcome`.
 */
export interface ReplyOutcome {
  /** How the turn resolved. `deflected` is a refusal for the rate. */
  readonly outcome: 'clean' | 'deflected';
  /** Every break detected across attempts, for reporting. */
  readonly breaks: readonly unknown[];
}

/**
 * One per-call timing sample, supplied as data so a run is reproducible without
 * reading a wall clock. A live run fills these from the Gateway's own measured
 * timings (the `ttfsMs`, `durationMs` and `completionTokens` the Gateway
 * records to its metrics sink); an offline test fills them from a fake
 * {@link Clock} and scripted token counts. The collector aggregates the samples
 * it is given and never reads a clock itself.
 */
export interface CallTimingSample {
  /** The Model Role this call was routed to. */
  readonly role: MetricRole;
  /**
   * Time to the first released sentence, in milliseconds, or `null` when the
   * call released nothing (a failed call contributes no TTFS to its role).
   */
  readonly ttfsMs: number | null;
  /** Completion tokens produced over the call. */
  readonly completionTokens: number;
  /** Total wall-clock duration of the call, in milliseconds. */
  readonly durationMs: number;
}

// ---------------------------------------------------------------------------
// The reported metrics shape
// ---------------------------------------------------------------------------

/**
 * The refusal rate for one Model Role: how many replies were settled for the
 * role and how many of those were deflected (a refusal/meta break the retries
 * could not recover). `rate` is `deflected / replies`, or `null` when the role
 * voiced no reply (an undefined rate rather than `0/0`).
 */
export interface RefusalRate {
  /** Replies the Refusal Guard settled for this role. */
  readonly replies: number;
  /** Of those, how many ended up deflected. */
  readonly deflected: number;
  /** `deflected / replies`, or `null` when `replies` is 0. */
  readonly rate: number | null;
}

/**
 * The aggregated time-to-first-sentence for one Model Role over a run, in
 * milliseconds. `samples` is how many calls released a sentence (and so
 * contributed a TTFS); `meanMs` is their arithmetic mean, or `null` when none
 * released. `maxMs` is the slowest first sentence, which is what a latency
 * target (Req 15.3's ≤ 2 s / ≤ 5 s) is checked against — a mean under budget
 * can still hide a call that blew it.
 */
export interface TtfsStats {
  /** Calls that released a sentence and so contributed a TTFS. */
  readonly samples: number;
  /** Mean time to first sentence over those calls, or `null` when none. */
  readonly meanMs: number | null;
  /** Slowest first sentence over those calls, or `null` when none. */
  readonly maxMs: number | null;
}

/**
 * The aggregated throughput for one Model Role over a run. Tokens per second is
 * computed over the *totals* (all completion tokens for the role divided by all
 * duration for the role) rather than by averaging per-call rates, so a short
 * fast call does not weigh the same as a long slow one. `null` when the role's
 * total duration is zero (an undefined rate rather than a divide-by-zero).
 */
export interface ThroughputStats {
  /** Calls that contributed to the role's throughput. */
  readonly samples: number;
  /** Total completion tokens produced for the role. */
  readonly totalTokens: number;
  /** Total duration for the role, in milliseconds. */
  readonly totalDurationMs: number;
  /** `totalTokens / (totalDurationMs / 1000)`, or `null` when duration is 0. */
  readonly tokensPerSec: number | null;
}

/** Per-role timing for every {@link MetricRole}. */
export type PerRole<T> = Readonly<Record<MetricRole, T>>;

/**
 * The mechanical metrics for a fixture run (Req 18.2). The four count fields are
 * run totals; refusal rate and the two timing fields are broken down per Model
 * Role, as Req 15.3 ("per role") requires for the timings and as the harness
 * reports refusal rate per role so a model that refuses only narration is told
 * apart from one that refuses only dialogue.
 */
export interface MechanicalMetrics {
  /** Leak Guard turns that tripped (caught a hit; regenerated or deflected). */
  readonly leakGuardTrips: number;
  /** Total Leak Guard hits across all turns (Req 5.6), for context. */
  readonly leakGuardHits: number;
  /** Specifics Guard checks that rejected a sentence. */
  readonly specificsGuardTrips: number;
  /** Chance leaks logged across the run (Req 5.6). */
  readonly chanceLeaks: number;
  /** Told List contradictions logged across the run (Req 6.5). */
  readonly toldListContradictions: number;
  /** Refusal rate per Model Role. */
  readonly refusalRate: PerRole<RefusalRate>;
  /** Time to first sentence per Model Role (Req 15.3). */
  readonly timeToFirstSentence: PerRole<TtfsStats>;
  /** Tokens per second per Model Role. */
  readonly tokensPerSecond: PerRole<ThroughputStats>;
}

// ---------------------------------------------------------------------------
// The collector
// ---------------------------------------------------------------------------

/** The mutable per-role refusal tally the collector grows. */
interface RefusalTally {
  replies: number;
  deflected: number;
}

/** The mutable per-role timing tally the collector grows. */
interface TimingTally {
  /** Every non-null TTFS seen for the role, for mean and max. */
  readonly ttfs: number[];
  /** Calls that contributed throughput (a non-negative duration). */
  throughputSamples: number;
  totalTokens: number;
  totalDurationMs: number;
}

/** Build an empty per-role record. */
function emptyPerRole<T>(make: () => T): Record<MetricRole, T> {
  const out = {} as Record<MetricRole, T>;
  for (const role of METRIC_ROLES) {
    out[role] = make();
  }
  return out;
}

/**
 * Accumulates {@link MechanicalMetrics} over a fixture run (task 23.2).
 *
 * The collector is fed the outcome of each guard turn, each extraction and each
 * model call as it happens — `recordLeakGuard`, `recordSpecificsGuard`,
 * `recordExtraction`, `recordReply`, `recordTiming` — and {@link snapshot}
 * returns the aggregated metrics at any point. It holds only running tallies
 * (counts and per-role timing lists), so feeding the same sequence of outcomes
 * always produces the same snapshot: the aggregation is a pure fold over the
 * recorded data, with no clock read of its own.
 *
 * An optional {@link Clock} may be supplied for callers that want the collector
 * to *measure* a call rather than be handed a timing — but the collector itself
 * never calls it; it is kept only so a live driver can thread one gateway clock
 * through both the Gateway and the collector. Offline tests pass scripted
 * {@link CallTimingSample}s and need no clock at all.
 */
export class MetricsCollector {
  private leakGuardTrips = 0;
  private leakGuardHits = 0;
  private specificsGuardTrips = 0;
  private chanceLeaks = 0;
  private toldListContradictions = 0;

  private readonly refusal = emptyPerRole<RefusalTally>(() => ({
    replies: 0,
    deflected: 0,
  }));

  private readonly timing = emptyPerRole<TimingTally>(() => ({
    ttfs: [],
    throughputSamples: 0,
    totalTokens: 0,
    totalDurationMs: 0,
  }));

  /**
   * The clock a live driver may share with the Gateway. The collector does not
   * read it; it is held so a caller can keep one clock for a whole run. Offline
   * callers omit it.
   */
  readonly clock?: Clock;

  constructor(options: { readonly clock?: Clock } = {}) {
    this.clock = options.clock;
  }

  /**
   * Record one Leak Guard turn. The turn *trips* when the guard caught any hit
   * — it deflected or regenerated — and every hit is added to the run's hit
   * total (Req 5.6). A clean first-attempt turn (no regenerations, no hits,
   * `outcome: 'clean'`) does not trip.
   */
  recordLeakGuard(outcome: LeakGuardTrip): void {
    const tripped =
      outcome.outcome === 'deflected' ||
      outcome.regenerations > 0 ||
      outcome.hits.length > 0;
    if (tripped) {
      this.leakGuardTrips += 1;
    }
    this.leakGuardHits += outcome.hits.length;
  }

  /**
   * Record one Specifics Guard check. The check *trips* when it is not `ok` —
   * it rejected the sentence for one or more invented specifics.
   */
  recordSpecificsGuard(result: SpecificsCheck): void {
    if (!result.ok) {
      this.specificsGuardTrips += 1;
    }
  }

  /**
   * Record one extraction's logged signals: its chance leaks (Req 5.6) and Told
   * List contradictions (its consistency violations, Req 6.5). Both are added
   * to the run totals.
   */
  recordExtraction(counts: ExtractionCounts): void {
    this.chanceLeaks += counts.chanceLeaks.length;
    this.toldListContradictions += counts.consistencyViolations.length;
  }

  /**
   * Record one Refusal Guard reply for a role. Every reply counts toward the
   * role's denominator; a `deflected` outcome is a refusal the retries could
   * not recover and counts toward the numerator.
   */
  recordReply(role: MetricRole, outcome: ReplyOutcome): void {
    const tally = this.refusal[role];
    tally.replies += 1;
    if (outcome.outcome === 'deflected') {
      tally.deflected += 1;
    }
  }

  /**
   * Record one per-call timing sample for its role. A non-null `ttfsMs`
   * contributes to the role's time-to-first-sentence; the token count and
   * duration contribute to the role's throughput. A sample with a `null`
   * `ttfsMs` (the call released nothing) still contributes its tokens and
   * duration to throughput — a call that produced tokens but released no clean
   * sentence still did work — but adds no TTFS. A non-finite or negative
   * duration is ignored for throughput (a bad sample never corrupts the rate).
   */
  recordTiming(sample: CallTimingSample): void {
    const tally = this.timing[sample.role];
    if (sample.ttfsMs !== null && Number.isFinite(sample.ttfsMs) && sample.ttfsMs >= 0) {
      tally.ttfs.push(sample.ttfsMs);
    }
    if (Number.isFinite(sample.durationMs) && sample.durationMs >= 0) {
      tally.throughputSamples += 1;
      tally.totalTokens += Math.max(0, sample.completionTokens);
      tally.totalDurationMs += sample.durationMs;
    }
  }

  /** The aggregated metrics so far. Pure in the recorded data; no clock read. */
  snapshot(): MechanicalMetrics {
    const refusalRate = emptyPerRole<RefusalRate>(() => ({
      replies: 0,
      deflected: 0,
      rate: null,
    }));
    const timeToFirstSentence = emptyPerRole<TtfsStats>(() => ({
      samples: 0,
      meanMs: null,
      maxMs: null,
    }));
    const tokensPerSecond = emptyPerRole<ThroughputStats>(() => ({
      samples: 0,
      totalTokens: 0,
      totalDurationMs: 0,
      tokensPerSec: null,
    }));

    for (const role of METRIC_ROLES) {
      const r = this.refusal[role];
      refusalRate[role] = {
        replies: r.replies,
        deflected: r.deflected,
        rate: r.replies === 0 ? null : r.deflected / r.replies,
      };

      const t = this.timing[role];
      const n = t.ttfs.length;
      timeToFirstSentence[role] = {
        samples: n,
        meanMs: n === 0 ? null : t.ttfs.reduce((a, b) => a + b, 0) / n,
        maxMs: n === 0 ? null : Math.max(...t.ttfs),
      };

      tokensPerSecond[role] = {
        samples: t.throughputSamples,
        totalTokens: t.totalTokens,
        totalDurationMs: t.totalDurationMs,
        tokensPerSec:
          t.totalDurationMs === 0
            ? null
            : t.totalTokens / (t.totalDurationMs / 1000),
      };
    }

    return {
      leakGuardTrips: this.leakGuardTrips,
      leakGuardHits: this.leakGuardHits,
      specificsGuardTrips: this.specificsGuardTrips,
      chanceLeaks: this.chanceLeaks,
      toldListContradictions: this.toldListContradictions,
      refusalRate,
      timeToFirstSentence,
      tokensPerSecond,
    };
  }
}
