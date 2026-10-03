/**
 * Playability calibration: the balance bands every Difficulty Preset must hold,
 * checked on a fixed sample of seeds so a change to the engine, the content or
 * the presets that drifts the game out of balance fails CI.
 *
 * Three player models drive full games through the real Composition Root with
 * the Fake Seams (no model, no network):
 *
 * - **The expert** ({@link probeSeed}) plays well and should usually win, and
 *   its wins should land in the middle of the operation's timeline: not in the
 *   opening days (the case was too easy to make) and not on the last day (too
 *   little margin).
 * - **The reckless player** ({@link playBurned}) roams risky places on direct
 *   routes and cold-approaches strangers; the Hostile Service should burn them.
 * - **The idle player** ({@link playPlotFailure}) only waits; the operation
 *   should always run to completion.
 *
 * The bands are deliberately looser than the measured values (see the README's
 * "Balance" section for how they were set), so ordinary content edits pass and
 * only a real drift fails. When a deliberate change moves a band, re-measure
 * with this spec and update the band and the README together.
 */
import { describe, expect, it } from 'vitest';
import { probeSeed, type ProbeResult } from './playability-probe.js';
import {
  ScriptedGame,
  playBurned,
  playPlotFailure,
  type ScriptedPreset,
} from './scripted-games.js';

/** Seeds per preset for the expert sample. */
const EXPERT_SEEDS = 30;
/** Seeds per preset for the reckless and idle samples. */
const SCRIPT_SEEDS = 15;

/** The bands the expert must hold on every preset. */
const EXPERT_BANDS = {
  /** At least this share of seeds is won by the expert. */
  minWinRate: 0.8,
  /** The median win lands between these fractions of the Plot's timeline. */
  medianFraction: [0.35, 0.75] as const,
  /** At most this share of wins comes before a quarter of the timeline. */
  maxVeryEarly: 0.15,
  /** At most this share of games burns the expert. */
  maxBurned: 0.1,
};

/** The share of reckless games the Hostile Service must burn, by preset. */
const MIN_RECKLESS_BURN: Record<ScriptedPreset, number> = {
  easy: 0,
  standard: 0.6,
  hard: 0.75,
};

const PRESETS: readonly ScriptedPreset[] = ['easy', 'standard', 'hard'];

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function expertSample(preset: ScriptedPreset): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];
  for (let i = 0; i < EXPERT_SEEDS; i += 1) {
    out.push(await probeSeed(`calibration-${i}`, preset));
  }
  return out;
}

async function endCause(
  preset: ScriptedPreset,
  seed: string,
  play: (game: ScriptedGame) => Promise<unknown>,
): Promise<string | undefined> {
  const game = await ScriptedGame.start({ seed, preset });
  try {
    await play(game);
  } catch {
    // A script that gives up has simply not reached its ending.
  }
  const cause = game.ended === undefined ? undefined : game.outcomes[0]?.outcome;
  await game.close();
  return cause;
}

describe('playability calibration', () => {
  for (const preset of PRESETS) {
    it(`the expert usually wins on ${preset}, mid-way through the operation`, async () => {
      const results = await expertSample(preset);
      const wins = results.filter((r) => r.outcome === 'win');
      const fractions = wins.map((r) => r.day / r.finalDeadline);

      expect(wins.length / results.length).toBeGreaterThanOrEqual(EXPERT_BANDS.minWinRate);
      const mid = median(fractions);
      expect(mid).toBeGreaterThanOrEqual(EXPERT_BANDS.medianFraction[0]);
      expect(mid).toBeLessThanOrEqual(EXPERT_BANDS.medianFraction[1]);
      const veryEarly = fractions.filter((f) => f < 0.25).length / wins.length;
      expect(veryEarly).toBeLessThanOrEqual(EXPERT_BANDS.maxVeryEarly);
      const burned = results.filter((r) => r.outcome === 'burned').length;
      expect(burned / results.length).toBeLessThanOrEqual(EXPERT_BANDS.maxBurned);
    }, 600_000);

    it(`the idle player always loses to the operation on ${preset}`, async () => {
      for (let i = 0; i < SCRIPT_SEEDS; i += 1) {
        const outcome = await endCause(preset, `calibration-idle-${i}`, playPlotFailure);
        expect(outcome).toBe('failure-plot');
      }
    }, 600_000);

    if (MIN_RECKLESS_BURN[preset] > 0) {
      it(`reckless play gets the player burned on ${preset}`, async () => {
        let burned = 0;
        for (let i = 0; i < SCRIPT_SEEDS; i += 1) {
          const outcome = await endCause(preset, `calibration-reckless-${i}`, playBurned);
          if (outcome === 'failure-burned') burned += 1;
        }
        expect(burned / SCRIPT_SEEDS).toBeGreaterThanOrEqual(MIN_RECKLESS_BURN[preset]);
      }, 600_000);
    }
  }
});
