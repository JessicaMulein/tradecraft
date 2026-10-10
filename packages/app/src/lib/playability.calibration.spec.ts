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
 *
 * Two samples share these bands. The first is the original three operations on
 * the core city. The second is the game a new session starts: the authored
 * Vienna, an operation from the plot library, and ambient city life. The pass
 * marks are the same. A drift in either sample fails CI.
 */
import { describe, expect, it } from 'vitest';
import type { ScenarioOverrides } from './game-harness-config.js';
import { probeSeed, type ProbeResult } from './playability-probe.js';
import {
  ScriptedGame,
  playBurned,
  playPlotFailure,
  type ScriptedPreset,
} from './scripted-games.js';

/**
 * The world a new session starts, matching `config/scenario.yaml`: the authored
 * Vienna, the plot library, and ambient city life at standard density. The mole
 * stays off. Recruitment weights stay the harness defaults, so this sample
 * differs from the core sample in the city and those two features.
 */
const SHIPPED_PLAY: ScenarioOverrides = {
  packs: {
    dirs: [
      'packages/content/packs/core',
      'packages/content/packs/era-cold-war-early',
      'packages/content/packs/lib-central-europe',
      'packages/content/packs/lib-russian',
      'packages/content/packs/city-vienna',
      'packages/content/packs/coldwar-plots',
      'packages/content/packs/ambient',
    ],
    load: [
      'core',
      'era-cold-war-early',
      'lib-central-europe',
      'lib-russian',
      'city-vienna',
      'coldwar-plots',
      'ambient',
    ],
  },
  setting: { city: 'city-vienna/vienna' },
  plotSelection: { enabled: true },
  ambient: { enabled: true, density: 'standard' },
  mole: false,
};

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

async function expertSample(
  preset: ScriptedPreset,
  scenario?: ScenarioOverrides,
): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];
  for (let i = 0; i < EXPERT_SEEDS; i += 1) {
    out.push(
      await probeSeed(
        `calibration-${i}`,
        preset,
        scenario === undefined ? {} : { scenario },
      ),
    );
  }
  return out;
}

async function endCause(
  preset: ScriptedPreset,
  seed: string,
  play: (game: ScriptedGame) => Promise<unknown>,
  scenario?: ScenarioOverrides,
): Promise<string | undefined> {
  const game = await ScriptedGame.start({
    seed,
    preset,
    ...(scenario === undefined ? {} : { scenario }),
  });
  try {
    await play(game);
  } catch {
    // A script that gives up has simply not reached its ending.
  }
  const cause = game.ended === undefined ? undefined : game.outcomes[0]?.outcome;
  await game.close();
  return cause;
}

/** The expert band, shared by the core sample and the shipped game. */
function expectExpertHolds(results: readonly ProbeResult[]): void {
  const wins = results.filter((r) => r.outcome === 'win');
  const fractions = wins.map((r) => r.day / r.finalDeadline);
  const mid = median(fractions);
  const veryEarly = fractions.filter((f) => f < 0.25).length / wins.length;
  const burned = results.filter((r) => r.outcome === 'burned').length;
  console.info(
    `expert ${wins.length}/${results.length} median ${String(mid)} very-early ${String(veryEarly)} burned ${burned}/${results.length}`,
  );

  expect(wins.length / results.length).toBeGreaterThanOrEqual(EXPERT_BANDS.minWinRate);
  expect(mid).toBeGreaterThanOrEqual(EXPERT_BANDS.medianFraction[0]);
  expect(mid).toBeLessThanOrEqual(EXPERT_BANDS.medianFraction[1]);
  expect(veryEarly).toBeLessThanOrEqual(EXPERT_BANDS.maxVeryEarly);
  expect(burned / results.length).toBeLessThanOrEqual(EXPERT_BANDS.maxBurned);
}

/**
 * Register the expert, idle and reckless checks for one world. `scenario`
 * omitted is the core city and its three operations. The test titles for that
 * world stay as they were.
 */
function calibrate(scenario?: ScenarioOverrides): void {
  const shipped = scenario !== undefined;
  for (const preset of PRESETS) {
    const expert = shipped
      ? `the expert usually wins the shipped game on ${preset}, mid-way through the operation`
      : `the expert usually wins on ${preset}, mid-way through the operation`;
    const idle = shipped
      ? `the idle player always loses the shipped game to the operation on ${preset}`
      : `the idle player always loses to the operation on ${preset}`;
    const reckless = shipped
      ? `reckless play gets the player burned in the shipped game on ${preset}`
      : `reckless play gets the player burned on ${preset}`;

    it(expert, async () => {
      expectExpertHolds(await expertSample(preset, scenario));
    }, 600_000);

    it(idle, async () => {
      let plots = 0;
      for (let i = 0; i < SCRIPT_SEEDS; i += 1) {
        const outcome = await endCause(preset, `calibration-idle-${i}`, playPlotFailure, scenario);
        if (outcome === 'failure-plot') plots += 1;
        expect(outcome).toBe('failure-plot');
      }
      console.info(`idle ${plots}/${SCRIPT_SEEDS} plot on ${preset}`);
    }, 600_000);

    if (MIN_RECKLESS_BURN[preset] > 0) {
      it(reckless, async () => {
        let burned = 0;
        for (let i = 0; i < SCRIPT_SEEDS; i += 1) {
          const outcome = await endCause(
            preset,
            `calibration-reckless-${i}`,
            playBurned,
            scenario,
          );
          if (outcome === 'failure-burned') burned += 1;
        }
        console.info(`reckless ${burned}/${SCRIPT_SEEDS} burned on ${preset}`);
        expect(burned / SCRIPT_SEEDS).toBeGreaterThanOrEqual(MIN_RECKLESS_BURN[preset]);
      }, 600_000);
    }
  }
}

describe('playability calibration', () => {
  calibrate();
});

describe('playability calibration — the shipped game', () => {
  calibrate(SHIPPED_PLAY);
});
