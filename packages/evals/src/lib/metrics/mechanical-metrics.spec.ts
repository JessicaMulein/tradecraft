/**
 * Unit tests for the mechanical metrics collector (task 23.2; Req 15.3, 18.2).
 *
 * These are deterministic and offline: the collector is fed scripted guard
 * outcomes, extraction signals and per-call timing samples, and the snapshot is
 * asserted exactly. No live model, no real clock — timing samples are built
 * from a fake {@link Clock} advanced by hand, exactly as the live driver would
 * build them from the Gateway's own clock, so the per-role aggregates are exact
 * asserted values rather than flaky wall-clock deltas.
 */

import { describe, expect, it } from 'vitest';

import type { Clock } from '@tradecraft/llm';

import {
  MetricsCollector,
  type CallTimingSample,
  type MetricRole,
} from './mechanical-metrics.js';

/**
 * A hand-advanced fake clock, mirroring the one the Gateway's own metrics tests
 * use. `tick(ms)` advances it; `now()` reads it. A timing sample is built by
 * reading the clock at call start, at first release and at completion, so a
 * test can produce an exact `ttfsMs`/`durationMs` the way the live Gateway does.
 */
function fakeClock(start = 0): Clock & { tick: (ms: number) => void } {
  let t = start;
  return {
    now: () => t,
    tick: (ms: number) => {
      t += ms;
    },
  };
}

/**
 * Measure a scripted call against a fake clock, returning the timing sample the
 * collector would be handed. `releaseAfter`/`finishAfter` are the ms the clock
 * is ticked to first release and to completion; `releaseAfter: null` models a
 * call that released nothing (ttfs is null, but the duration still counts for
 * throughput).
 */
function measure(
  clock: Clock & { tick: (ms: number) => void },
  role: MetricRole,
  spec: {
    readonly releaseAfter: number | null;
    readonly finishAfter: number;
    readonly completionTokens: number;
  },
): CallTimingSample {
  const start = clock.now();
  let ttfsMs: number | null = null;
  if (spec.releaseAfter !== null) {
    clock.tick(spec.releaseAfter);
    ttfsMs = clock.now() - start;
    clock.tick(spec.finishAfter - spec.releaseAfter);
  } else {
    clock.tick(spec.finishAfter);
  }
  return {
    role,
    ttfsMs,
    completionTokens: spec.completionTokens,
    durationMs: clock.now() - start,
  };
}

describe('MetricsCollector — guard trip counts (Req 18.2)', () => {
  it('counts a Leak Guard turn as a trip when it caught a hit or regenerated', () => {
    const c = new MetricsCollector();
    // Clean first attempt: no trip.
    c.recordLeakGuard({ outcome: 'clean', regenerations: 0, hits: [] });
    // Regenerated once then clean: a trip (it caught a hit on the way).
    c.recordLeakGuard({
      outcome: 'clean',
      regenerations: 1,
      hits: [{ entity: 'npc:1', alias: 'Mira' }],
    });
    // Deflected after exhausting retries: a trip.
    c.recordLeakGuard({
      outcome: 'deflected',
      regenerations: 2,
      hits: [
        { entity: 'npc:1', alias: 'Mira' },
        { entity: 'npc:1', alias: 'Mira' },
      ],
    });

    const m = c.snapshot();
    expect(m.leakGuardTrips).toBe(2);
    expect(m.leakGuardHits).toBe(3);
  });

  it('counts a Specifics Guard check as a trip only when it is not ok', () => {
    const c = new MetricsCollector();
    c.recordSpecificsGuard({ ok: true, violations: [] });
    c.recordSpecificsGuard({ ok: false, violations: [{ class: 'numeral', token: '3' }] });
    c.recordSpecificsGuard({
      ok: false,
      violations: [
        { class: 'weekday', token: 'Tuesday' },
        { class: 'clock', token: "o'clock" },
      ],
    });

    expect(c.snapshot().specificsGuardTrips).toBe(2);
  });

  it('tallies chance leaks and Told List contradictions from extraction outcomes', () => {
    const c = new MetricsCollector();
    c.recordExtraction({
      chanceLeaks: [{ claimId: 'p1' }],
      consistencyViolations: [],
    });
    c.recordExtraction({
      chanceLeaks: [{ claimId: 'p2' }, { claimId: 'p3' }],
      consistencyViolations: [{ claimId: 'p4', contradicts: 'p0' }],
    });

    const m = c.snapshot();
    expect(m.chanceLeaks).toBe(3);
    expect(m.toldListContradictions).toBe(1);
  });

  it('starts at all zeros before anything is recorded', () => {
    const m = new MetricsCollector().snapshot();
    expect(m.leakGuardTrips).toBe(0);
    expect(m.leakGuardHits).toBe(0);
    expect(m.specificsGuardTrips).toBe(0);
    expect(m.chanceLeaks).toBe(0);
    expect(m.toldListContradictions).toBe(0);
  });
});

describe('MetricsCollector — refusal rate per role (Req 18.2)', () => {
  it('computes deflected / replies per role and leaves an unused role null', () => {
    const c = new MetricsCollector();
    // voice: 4 replies, 1 deflected → 0.25
    c.recordReply('voice', { outcome: 'clean', breaks: [] });
    c.recordReply('voice', { outcome: 'clean', breaks: [] });
    c.recordReply('voice', { outcome: 'deflected', breaks: ['refusal'] });
    c.recordReply('voice', { outcome: 'clean', breaks: [] });

    const m = c.snapshot();
    expect(m.refusalRate.voice).toEqual({ replies: 4, deflected: 1, rate: 0.25 });
    // narrator voiced nothing → rate is null, not 0/0.
    expect(m.refusalRate.narrator).toEqual({
      replies: 0,
      deflected: 0,
      rate: null,
    });
  });

  it('keeps the two roles separate', () => {
    const c = new MetricsCollector();
    c.recordReply('narrator', { outcome: 'deflected', breaks: ['meta'] });
    c.recordReply('narrator', { outcome: 'clean', breaks: [] });
    c.recordReply('voice', { outcome: 'clean', breaks: [] });

    const m = c.snapshot();
    expect(m.refusalRate.narrator.rate).toBe(0.5);
    expect(m.refusalRate.voice.rate).toBe(0);
  });
});

describe('MetricsCollector — timing per role from a fake clock (Req 15.3)', () => {
  it('aggregates time to first sentence (mean and max) per role', () => {
    const clock = fakeClock();
    const c = new MetricsCollector({ clock });

    // voice: two calls, first sentence at 500 ms and 1500 ms.
    c.recordTiming(measure(clock, 'voice', { releaseAfter: 500, finishAfter: 900, completionTokens: 40 }));
    c.recordTiming(measure(clock, 'voice', { releaseAfter: 1500, finishAfter: 2000, completionTokens: 60 }));
    // narrator: one call, first sentence at 300 ms.
    c.recordTiming(measure(clock, 'narrator', { releaseAfter: 300, finishAfter: 600, completionTokens: 30 }));

    const m = c.snapshot();
    expect(m.timeToFirstSentence.voice).toEqual({ samples: 2, meanMs: 1000, maxMs: 1500 });
    expect(m.timeToFirstSentence.narrator).toEqual({ samples: 1, meanMs: 300, maxMs: 300 });
  });

  it('computes tokens/sec over the role totals, not per-call averages', () => {
    const clock = fakeClock();
    const c = new MetricsCollector({ clock });

    // voice: 40 tokens in 900 ms, then 60 tokens in 1100 ms.
    c.recordTiming(measure(clock, 'voice', { releaseAfter: 100, finishAfter: 900, completionTokens: 40 }));
    c.recordTiming(measure(clock, 'voice', { releaseAfter: 100, finishAfter: 1100, completionTokens: 60 }));

    const m = c.snapshot().tokensPerSecond.voice;
    expect(m.samples).toBe(2);
    expect(m.totalTokens).toBe(100);
    expect(m.totalDurationMs).toBe(2000);
    // 100 tokens / 2.0 s = 50 tokens/sec.
    expect(m.tokensPerSec).toBe(50);
  });

  it('leaves timing null for a role with no calls', () => {
    const m = new MetricsCollector().snapshot();
    expect(m.timeToFirstSentence.narrator).toEqual({ samples: 0, meanMs: null, maxMs: null });
    expect(m.tokensPerSecond.narrator).toEqual({
      samples: 0,
      totalTokens: 0,
      totalDurationMs: 0,
      tokensPerSec: null,
    });
  });

  it('counts a released-nothing call toward throughput but not TTFS', () => {
    const clock = fakeClock();
    const c = new MetricsCollector({ clock });

    // A failed/empty call: no first sentence, but it ran for 400 ms producing
    // 10 tokens that never formed a clean released sentence.
    c.recordTiming(measure(clock, 'voice', { releaseAfter: null, finishAfter: 400, completionTokens: 10 }));
    // A good call afterward.
    c.recordTiming(measure(clock, 'voice', { releaseAfter: 200, finishAfter: 600, completionTokens: 30 }));

    const m = c.snapshot();
    // Only the good call contributes TTFS.
    expect(m.timeToFirstSentence.voice).toEqual({ samples: 1, meanMs: 200, maxMs: 200 });
    // Both calls contribute throughput.
    expect(m.tokensPerSecond.voice.samples).toBe(2);
    expect(m.tokensPerSecond.voice.totalTokens).toBe(40);
    expect(m.tokensPerSecond.voice.totalDurationMs).toBe(1000);
    expect(m.tokensPerSecond.voice.tokensPerSec).toBe(40);
  });

  it('ignores a bad (negative/non-finite) duration for throughput', () => {
    const c = new MetricsCollector();
    c.recordTiming({ role: 'voice', ttfsMs: 100, completionTokens: 10, durationMs: -5 });
    c.recordTiming({ role: 'voice', ttfsMs: 200, completionTokens: 20, durationMs: Number.NaN });
    c.recordTiming({ role: 'voice', ttfsMs: 150, completionTokens: 30, durationMs: 1000 });

    const m = c.snapshot();
    // TTFS still records all three (ttfs values are valid).
    expect(m.timeToFirstSentence.voice.samples).toBe(3);
    // Throughput only the one with a valid duration.
    expect(m.tokensPerSecond.voice.samples).toBe(1);
    expect(m.tokensPerSecond.voice.totalTokens).toBe(30);
    expect(m.tokensPerSecond.voice.tokensPerSec).toBe(30);
  });
});

describe('MetricsCollector — a whole scripted fixture run', () => {
  it('aggregates every metric over an interleaved sequence of outcomes', () => {
    const clock = fakeClock();
    const c = new MetricsCollector({ clock });

    // A confrontation scene: the player presses, the voice model answers three
    // dialogue lines; the Narrator closes with one description.
    c.recordReply('voice', { outcome: 'clean', breaks: [] });
    c.recordTiming(measure(clock, 'voice', { releaseAfter: 400, finishAfter: 800, completionTokens: 50 }));
    c.recordLeakGuard({ outcome: 'clean', regenerations: 0, hits: [] });
    c.recordSpecificsGuard({ ok: true, violations: [] });
    c.recordExtraction({ chanceLeaks: [], consistencyViolations: [] });

    c.recordReply('voice', { outcome: 'clean', breaks: [] });
    c.recordTiming(measure(clock, 'voice', { releaseAfter: 600, finishAfter: 1200, completionTokens: 70 }));
    // The NPC leaks a concealed name — Leak Guard regenerates once.
    c.recordLeakGuard({
      outcome: 'clean',
      regenerations: 1,
      hits: [{ entity: 'npc:mole', alias: 'Viktor' }],
    });
    // and contradicts its earlier Told List.
    c.recordExtraction({
      chanceLeaks: [],
      consistencyViolations: [{ claimId: 'p9', contradicts: 'p2' }],
    });

    // The player pushes too hard; the model refuses and can't recover.
    c.recordReply('voice', { outcome: 'deflected', breaks: ['refusal'] });
    c.recordTiming(measure(clock, 'voice', { releaseAfter: null, finishAfter: 300, completionTokens: 5 }));

    // Narrator closes the scene, inventing a clock time the guard rejects.
    c.recordReply('narrator', { outcome: 'clean', breaks: [] });
    c.recordTiming(measure(clock, 'narrator', { releaseAfter: 250, finishAfter: 700, completionTokens: 45 }));
    c.recordSpecificsGuard({ ok: false, violations: [{ class: 'clock', token: '9:05' }] });

    const m = c.snapshot();

    // Guard trips.
    expect(m.leakGuardTrips).toBe(1);
    expect(m.leakGuardHits).toBe(1);
    expect(m.specificsGuardTrips).toBe(1);
    expect(m.chanceLeaks).toBe(0);
    expect(m.toldListContradictions).toBe(1);

    // Refusal rate per role: voice 1/3, narrator 0/1.
    expect(m.refusalRate.voice).toEqual({ replies: 3, deflected: 1, rate: 1 / 3 });
    expect(m.refusalRate.narrator).toEqual({ replies: 1, deflected: 0, rate: 0 });

    // TTFS per role: voice two released sentences (400, 600), narrator one (250).
    expect(m.timeToFirstSentence.voice).toEqual({ samples: 2, meanMs: 500, maxMs: 600 });
    expect(m.timeToFirstSentence.narrator).toEqual({ samples: 1, meanMs: 250, maxMs: 250 });

    // Throughput per role: voice 50+70+5 tokens over 800+1200+300 ms.
    expect(m.tokensPerSecond.voice.totalTokens).toBe(125);
    expect(m.tokensPerSecond.voice.totalDurationMs).toBe(2300);
    expect(m.tokensPerSecond.voice.tokensPerSec).toBeCloseTo(125 / 2.3, 10);
    expect(m.tokensPerSecond.narrator.totalTokens).toBe(45);
    expect(m.tokensPerSecond.narrator.totalDurationMs).toBe(700);
    expect(m.tokensPerSecond.narrator.tokensPerSec).toBeCloseTo(45 / 0.7, 10);
  });
});
