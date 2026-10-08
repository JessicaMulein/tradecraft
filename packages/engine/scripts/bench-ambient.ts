/**
 * `pnpm bench:ambient` — 30 days at density rich on three fixed seeds.
 * Prints p95 day-boundary and phase tick times, and ambient save growth per
 * day. Timing is reported, not gated: the 50 ms / 10 ms targets apply only on
 * the Reference Machine. Save growth above 64 KB per day is printed as a
 * warning and does not change the exit code.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCityData, loadContent, loadDescriptorData, loadPublicTexts } from '@tradecraft/content';

import { ScenarioConfigSchema } from '../src/lib/config/scenario-config.js';
import { generate } from '../src/lib/generate.js';
import type { WorldState } from '../src/lib/model/state.js';
import { ambientDayBoundary, ambientPhase } from '../src/lib/ambient/tick.js';

const CORE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'content', 'packs', 'core');
const SEEDS = ['ambient-bench-1', 'ambient-bench-2', 'ambient-bench-3'] as const;
const DAYS = 30;

function percentile(samples: readonly number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function inputs() {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) {
    throw new Error('core pack failed to load');
  }
  const cityData = loadCityData(CORE_DIR);
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('core pack data failed to load');
  }
  let preset = [...content.value.difficultyPresets.values()][0];
  for (const [key, value] of content.value.difficultyPresets) {
    if (key.endsWith('/standard') || key === 'standard') {
      preset = value;
    }
  }
  if (preset === undefined) {
    throw new Error('no standard preset');
  }
  return {
    content: content.value,
    preset,
    scenario: ScenarioConfigSchema.parse({
      difficulty: { preset: 'standard' },
      mole: false,
      ambient: { enabled: true, density: 'rich' },
      recruitment: {
        pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
        firstContact: { a: 1, b: 1, c: 1, d: 1 },
        meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
        exposure: { k1: 1, k2: 1, k3: 1 },
        turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
      },
    }),
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

const bundle = inputs();
const daySamples: number[] = [];
const phaseSamples: number[] = [];
const growth: number[] = [];

for (const seed of SEEDS) {
  let world: WorldState = generate(seed, bundle);
  let previous = bytes(world.ambient);
  for (let day = 0; day < DAYS; day += 1) {
    world = { ...world, time: { day, phase: 0 } };
    const started = performance.now();
    const dayTick = ambientDayBoundary(world);
    daySamples.push(performance.now() - started);
    world = dayTick.state;
    for (const phase of [0, 1, 2, 3] as const) {
      world = { ...world, time: { day, phase } };
      const phaseStarted = performance.now();
      world = ambientPhase(world).state;
      phaseSamples.push(performance.now() - phaseStarted);
    }
    const size = bytes(world.ambient);
    growth.push(Math.max(0, size - previous));
    previous = size;
  }
}

const report = {
  seeds: SEEDS,
  days: DAYS,
  density: 'rich',
  p95DayMs: Number(percentile(daySamples, 95).toFixed(3)),
  p95PhaseMs: Number(percentile(phaseSamples, 95).toFixed(3)),
  p95SaveGrowthBytes: percentile(growth, 95),
  maxSaveGrowthBytes: Math.max(...growth),
  dayTargetMs: 50,
  phaseTargetMs: 10,
  saveGrowthTargetBytes: 64 * 1024,
};

console.log(JSON.stringify(report, null, 2));
if (report.maxSaveGrowthBytes > report.saveGrowthTargetBytes) {
  console.error(`ambient save growth exceeded 64 KB on a day (max ${report.maxSaveGrowthBytes} bytes)`);
}
