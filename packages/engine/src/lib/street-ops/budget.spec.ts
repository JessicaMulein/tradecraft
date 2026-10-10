/**
 * Shipped rates and the drive-step budget (street-ops task 15.4).
 *
 * The numbers below are the rates the shipped content and the Sim use. A
 * sector-line search finds a moderate hiding place more often than a document
 * halt does. A disciplined tail on a busy street is noticed less often than
 * ordinary traffic. A drive step on the shipped Inner Court graph stays inside
 * the reference-machine budget; CI multiplies that budget by 8.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type DifficultyPreset,
} from '@tradecraft/content';

import { resolve } from '../action/action.js';
import type { ResolverContext } from '../action/result.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate } from '../generate.js';
import { createPrng } from '../prng/prng.js';
import { streetOpsRegistry } from './addon.js';
import { detectionChance } from './checkpoint.js';
import { type StreetGraphFile } from './content.js';
import { navigationAidActive, runtimeFromScenario, streetRates } from './drive.js';
import { compileStreetGraph } from './graph.js';
import { noticeChance } from './spot.js';
import { emptyStreetOpsTruth } from './state.js';
import { materialiseTeam } from './tail.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const CORE = join(ROOT, 'content', 'packs', 'core');

/** Reference-machine budget for one model-free drive step, in milliseconds. */
export const DRIVE_STEP_BUDGET_MS = 50;

function budgetMs(): number {
  return process.env.CI === 'true' ? DRIVE_STEP_BUDGET_MS * 8 : DRIVE_STEP_BUDGET_MS;
}

describe('street-ops calibration', () => {
  it('keeps the shipped tail lag, notice rate and checkpoint thoroughness', () => {
    const truth = materialiseTeam({
      wanted: true,
      truth: emptyStreetOpsTruth(),
      profiles: [{ id: 'foreign-box', service: 'service', discipline: 0.7, team: 3, methods: ['car-follow'] }],
      methods: [{ id: 'car-follow', era: { from: 1946, to: 1965 } }],
      year: 1953,
      sessionKey: 'session',
      step: 0,
    });
    const vehicles = Object.values(truth.teams)[0]?.vehicles ?? [];
    expect(vehicles.find((vehicle) => vehicle.role === 'lead')?.lag).toBe(1);
    expect(vehicles.filter((vehicle) => vehicle.role !== 'lead').every((vehicle) => vehicle.lag === 2)).toBe(true);
    const sector = detectionChance({
      thoroughness: 0.6,
      searchLevelRank: 2,
      difficulty: 0.4,
      composure: 0.5,
      ticksConcealed: 0,
      endurance: 1,
      suspicion: 0.2,
    });
    const halt = detectionChance({
      thoroughness: 0.3,
      searchLevelRank: 1,
      difficulty: 0.4,
      composure: 0.5,
      ticksConcealed: 0,
      endurance: 1,
      suspicion: 0.2,
    });
    expect(sector).toBeGreaterThan(0.65);
    expect(sector).toBeLessThan(0.7);
    expect(halt).toBeLessThan(sector);
    const tail = noticeChance({
      base: 0.45,
      attention: 1,
      conspicuousness: 0.5,
      discipline: 0.7,
      traffic: 2,
      sameSegment: true,
    });
    const traffic = noticeChance({
      base: 0.45,
      attention: 1,
      conspicuousness: 0.5,
      discipline: 0,
      traffic: 2,
      sameSegment: true,
    });
    expect(tail).toBeLessThan(0.03);
    expect(traffic).toBeGreaterThan(tail);
    expect(streetRates(undefined)).toEqual({ noticeBase: 0.45, regularRate: 0.35 });
    expect(streetRates({ streetOps: { noticeBase: 0.2, regularRate: 0.1 } })).toEqual({ noticeBase: 0.2, regularRate: 0.1 });
    expect(navigationAidActive(undefined, false)).toBe(false);
    expect(navigationAidActive(undefined, true)).toBe(true);
    expect(navigationAidActive(['cable', 'paper-papers'], true)).toBe(false);
    expect(navigationAidActive(['navigation-aid'], false)).toBe(true);
  });

  it('completes a drive step on the shipped graph within the budget', () => {
    const content = loadContent([CORE], ['core']);
    if (!content.ok) throw new Error('core pack failed to load');
    const cityData = loadCityData(CORE);
    if (!cityData.ok) throw new Error('city.yaml failed to load');
    const descriptors = loadDescriptorData(CORE);
    if (!descriptors.ok) throw new Error('descriptors.yaml failed to load');
    const publicTexts = loadPublicTexts(CORE);
    if (!publicTexts.ok) throw new Error('public texts failed to load');
    let standard: DifficultyPreset | undefined;
    for (const [key, value] of content.value.difficultyPresets) {
      if (key === 'standard' || key.endsWith('/standard')) standard = value;
    }
    if (standard === undefined) throw new Error('no standard preset');
    const enabled = ScenarioConfigSchema.parse({
      difficulty: { preset: 'standard' },
      mole: false,
      recruitment: {
        pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
        firstContact: { a: 1, b: 1, c: 1, d: 1 },
        meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
        exposure: { k1: 1, k2: 1, k3: 1 },
        turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
      },
      streetOps: { enabled: true },
    });
    const world = generate('street-ops-budget', {
      content: content.value,
      cityData: cityData.value,
      descriptors: descriptors.value,
      publicTexts: publicTexts.value,
      preset: standard,
      scenario: enabled,
    });
    const file = parse(readFileSync(join(ROOT, 'content', 'packs', 'street-ops-core', 'graphs', 'inner-court.yaml'), 'utf8')) as {
      items: StreetGraphFile[];
    };
    const shipped = file.items[0];
    const segment = shipped?.segments[0]?.id;
    if (shipped === undefined || segment === undefined) throw new Error('shipped graph has no segment');
    const graph = compileStreetGraph({
      ...shipped,
      frontages: [{ location: world.player.loc, segment, at: 0.2, side: 'right' }],
    });
    const runtime = runtimeFromScenario(enabled, {
      graphs: [graph],
      vehicles: [
        {
          id: 'pool-coupe',
          name: 'Pool coupe',
          era: { from: world.meta.setting.year, to: world.meta.setting.year },
          speed: 'normal',
          seats: 2,
          conspicuousness: 0.4,
          spots: [],
        },
      ],
    });
    const ctx: ResolverContext = { content: content.value, extensions: streetOpsRegistry(enabled, runtime) };
    const begun = resolve(world, { kind: 'street-ops.drive', vehicle: 'pool-coupe' }, createPrng('street-ops-budget'), ctx);
    const started = performance.now();
    const turned = resolve(begun.next, { kind: 'street-ops.turn', relative: 'straight' }, createPrng('street-ops-budget'), ctx);
    expect(performance.now() - started).toBeLessThan(budgetMs());
    expect(turned.next.ext?.streetOps?.session).toBeDefined();
  });
});
