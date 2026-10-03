/**
 * Tests for player tailing from Cover Suspicion and the burn threshold (task
 * 19.3, `dailyTick` step 6; Requirements 12.5, 21.4).
 *
 * These pin:
 *
 * - `tailingThresholds` lowers the tail-start cutoff with `securityConsciousness`
 *   and keeps the hysteresis band (`end <= start`);
 * - `decideTailing` starts a tail when Cover Suspicion is at/above `start`
 *   (emitting `tail-started`) and ends it below `end` (emitting `tail-ended`),
 *   with hysteresis in between;
 * - a standing tail adds its daily Cover-Suspicion delta;
 * - the player is burned exactly when this day's suspicion crosses the burn
 *   threshold (emitting `player-burned`), and is not re-burned once past it;
 * - the decision and events are deterministic (no draws).
 */

import { describe, expect, it } from 'vitest';

import type { GameTime } from '../model/core.js';
import type { Doctrine } from './doctrine.js';
import {
  DEFAULT_TAIL_START,
  DEFAULT_TAIL_SUSPICION_DELTA,
  TAIL_HYSTERESIS,
  TAIL_START_SECURITY_SPAN,
  decideTailing,
  tailingThresholds,
  type TailingThresholds,
} from './tailing.js';

const AT: GameTime = { day: 2, phase: 0 };

/** A doctrine with the given security consciousness (other dims irrelevant here). */
function doctrine(securityConsciousness: number): Doctrine {
  return { riskTolerance: 0.5, securityConsciousness, deceptionAppetite: 0.5 };
}

/** Thresholds with a generous (never-reached) burn cutoff, for tail tests. */
const TAIL_ONLY: TailingThresholds = { start: 0.5, end: 0.4, burn: 1.1 };

describe('tailingThresholds', () => {
  it('passes the preset burn threshold through', () => {
    expect(tailingThresholds(doctrine(0), 0.8).burn).toBe(0.8);
  });

  it('lowers the tail-start cutoff with security consciousness', () => {
    const relaxed = tailingThresholds(doctrine(0), 0.8);
    const keen = tailingThresholds(doctrine(1), 0.8);
    expect(relaxed.start).toBeCloseTo(DEFAULT_TAIL_START);
    expect(keen.start).toBeCloseTo(DEFAULT_TAIL_START - TAIL_START_SECURITY_SPAN);
    expect(keen.start).toBeLessThan(relaxed.start);
  });

  it('keeps a hysteresis band with end below start', () => {
    const t = tailingThresholds(doctrine(0.5), 0.8);
    expect(t.end).toBeLessThan(t.start);
    expect(t.start - t.end).toBeCloseTo(TAIL_HYSTERESIS);
  });
});

describe('decideTailing — the tail decision', () => {
  it('starts a tail when suspicion is at or above start, emitting tail-started', () => {
    const result = decideTailing({ coverSuspicion: 0.5, tailed: false }, TAIL_ONLY, AT);
    expect(result.decision.tailed).toBe(true);
    expect(result.events.map((e) => e.kind)).toContain('tail-started');
  });

  it('does not start a tail below start', () => {
    const result = decideTailing({ coverSuspicion: 0.49, tailed: false }, TAIL_ONLY, AT);
    expect(result.decision.tailed).toBe(false);
    expect(result.decision.suspicionDelta).toBe(0);
    expect(result.events).toHaveLength(0);
  });

  it('ends a running tail only below end, emitting tail-ended', () => {
    const result = decideTailing({ coverSuspicion: 0.39, tailed: true }, TAIL_ONLY, AT);
    expect(result.decision.tailed).toBe(false);
    expect(result.events.map((e) => e.kind)).toContain('tail-ended');
  });

  it('keeps a running tail within the hysteresis band (no event)', () => {
    // Between end (0.4) and start (0.5): a tail stays on, no tail event.
    const result = decideTailing({ coverSuspicion: 0.45, tailed: true }, TAIL_ONLY, AT);
    expect(result.decision.tailed).toBe(true);
    expect(result.events).toHaveLength(0);
  });

  it('adds the standing-tail Cover-Suspicion delta while tailed', () => {
    const result = decideTailing({ coverSuspicion: 0.45, tailed: true }, TAIL_ONLY, AT);
    expect(result.decision.suspicionDelta).toBe(DEFAULT_TAIL_SUSPICION_DELTA);
    expect(result.decision.coverSuspicion).toBeCloseTo(0.45 + DEFAULT_TAIL_SUSPICION_DELTA);
  });

  it('clamps the resulting Cover Suspicion to [0, 1]', () => {
    const result = decideTailing(
      { coverSuspicion: 0.99, tailed: true },
      { start: 0.5, end: 0.4, burn: 1.1 },
      AT,
    );
    expect(result.decision.coverSuspicion).toBeLessThanOrEqual(1);
  });
});

describe('decideTailing — the burn threshold (Req 21.4)', () => {
  const BURN: TailingThresholds = { start: 0.5, end: 0.4, burn: 0.8 };

  it('burns the player when this day`s suspicion crosses the threshold', () => {
    // Tailed at 0.78 → +0.05 delta → 0.83, crossing 0.8.
    const result = decideTailing({ coverSuspicion: 0.78, tailed: true }, BURN, AT);
    expect(result.decision.burned).toBe(true);
    expect(result.events.map((e) => e.kind)).toContain('player-burned');
  });

  it('burns when the projected Cover Suspicion is already at the threshold untailed', () => {
    // Not tailed, suspicion 0.6 → below start, no tail, delta 0: no crossing.
    const below = decideTailing({ coverSuspicion: 0.6, tailed: false }, BURN, AT);
    expect(below.decision.burned).toBe(false);
    // Suspicion 0.8 → starts a tail, +0.05, but it was already at burn before
    // the delta, so it is NOT a fresh crossing this day.
    const atThreshold = decideTailing({ coverSuspicion: 0.8, tailed: false }, BURN, AT);
    expect(atThreshold.decision.burned).toBe(false);
  });

  it('does not re-burn a player already past the threshold', () => {
    const result = decideTailing({ coverSuspicion: 0.85, tailed: true }, BURN, AT);
    expect(result.decision.burned).toBe(false);
    expect(result.events.map((e) => e.kind)).not.toContain('player-burned');
  });

  it('is deterministic', () => {
    const inputs = { coverSuspicion: 0.78, tailed: true } as const;
    expect(decideTailing(inputs, BURN, AT)).toEqual(decideTailing(inputs, BURN, AT));
  });
});
