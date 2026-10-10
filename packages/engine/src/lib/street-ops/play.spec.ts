/**
 * The play binding: a turned-on add-on reads the demo pack and offers one
 * cover car from wherever the Core City player is standing.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type ContentSet,
  type DifficultyPreset,
} from '@tradecraft/content';

import { resolve } from '../action/action.js';
import type { ResolverContext } from '../action/result.js';
import { ScenarioConfigSchema, type ScenarioConfig } from '../config/scenario-config.js';
import { generate, generateGame, type GenerateInputs } from '../generate.js';
import { createPrng } from '../prng/prng.js';
import { streetOpsRegistry } from './addon.js';
import { STREET_OPS_KINDS } from './content.js';
import { coverVehicle, driveCandidates } from './drive.js';
import { runtimeFromLoadedPacks, streetPlayDirs, withStreetPack } from './play.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const CORE = join(ROOT, 'packages', 'content', 'packs', 'core');

function loadCore(): { content: ContentSet; inputs: Omit<GenerateInputs, 'scenario' | 'preset'> } {
  const content = loadContent([CORE], ['core']);
  if (!content.ok) throw new Error('core pack failed to load');
  const cityData = loadCityData(CORE);
  if (!cityData.ok) throw new Error('city.yaml failed to load');
  const descriptors = loadDescriptorData(CORE);
  if (!descriptors.ok) throw new Error('descriptors.yaml failed to load');
  const publicTexts = loadPublicTexts(CORE);
  if (!publicTexts.ok) throw new Error('public texts failed to load');
  return {
    content: content.value,
    inputs: {
      content: content.value,
      cityData: cityData.value,
      descriptors: descriptors.value,
      publicTexts: publicTexts.value,
    },
  };
}

const LOADED = loadCore();

function preset(): DifficultyPreset {
  for (const [key, value] of LOADED.content.difficultyPresets) {
    if (key === 'standard' || key.endsWith('/standard')) return value;
  }
  throw new Error('no standard preset');
}

function scenario(): ScenarioConfig {
  return ScenarioConfigSchema.parse({
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
}

describe('street-ops play binding', () => {
  const dirs = streetPlayDirs(ROOT, [CORE]);
  const runtime = runtimeFromLoadedPacks(dirs, new Set(['street-ops-core']), scenario());

  it('loads the demo packs the launcher adds when the add-on is on', () => {
    const loaded = loadContent(dirs, withStreetPack(['core'], dirs), { kinds: [...STREET_OPS_KINDS] });
    expect(loaded.ok, loaded.ok ? '' : JSON.stringify(loaded.errors.slice(0, 4))).toBe(true);
  });

  it('reads the demo pack', () => {
    expect(runtime.graphs.map((graph) => graph.id).sort()).toEqual(['block-grid', 'inner-court']);
    expect(runtime.vehicles).toHaveLength(6);
    expect(runtime.maneuvers).toHaveLength(8);
    expect(runtime.tails).toHaveLength(3);
    expect(runtime.stories).toHaveLength(10);
    expect(runtime.streetNames).toContain('Court Lane');
    expect(runtime.attributions).toEqual([]);
  });

  it('issues a saloon to an official cover and a van to a warehouse trade', () => {
    const year = 1952;
    const saloon = coverVehicle(runtime.vehicles, year, {
      id: 'trade-attache',
      tags: ['cover:official'],
      fitLocationTypes: ['embassy'],
    });
    const van = coverVehicle(runtime.vehicles, year, {
      id: 'import-export-agent',
      tags: ['cover:commercial'],
      fitLocationTypes: ['warehouse'],
    });
    expect(saloon?.id).toBe('staff-saloon');
    expect(van?.id).toBe('covered-van');
  });

  it('offers that car from the generated start, and the rest for hire', () => {
    const enabled = scenario();
    const world = generate('street-ops-play', { ...LOADED.inputs, preset: preset(), scenario: enabled });
    const extensions = streetOpsRegistry(enabled, runtime);
    const ctx: ResolverContext = { content: LOADED.content, extensions };
    const kinds = driveCandidates(world, ctx);
    const drives = kinds.filter((action) => action.kind === 'street-ops.drive').map((action) => action.vehicle);
    const hires = kinds.filter((action) => action.kind === 'street-ops.hire').map((action) => action.vehicle);
    expect(drives).toEqual(['staff-saloon']);
    expect(hires).toHaveLength(5);
    expect(hires).not.toContain('staff-saloon');
  });

  it('summarises the ring route without naming a tail', () => {
    expect(runtime.routes.map((route) => route.id)).toContain('ring-check');
    const enabled = scenario();
    const world = generate('street-ops-ring', { ...LOADED.inputs, preset: preset(), scenario: enabled });
    const extensions = streetOpsRegistry(enabled, runtime);
    const ctx: ResolverContext = { content: LOADED.content, extensions };
    let state = resolve(world, { kind: 'street-ops.drive', vehicle: 'staff-saloon' }, createPrng('ring'), ctx).next;
    const lines: string[] = [];
    const streets = [undefined, 'Lamp Cut', 'Sector Road', 'Paper Alley'];
    for (const street of streets) {
      const turns = driveCandidates(state, ctx).filter((action) => action.kind === 'street-ops.turn');
      const chosen =
        street === undefined ? turns.find((action) => action.relative === 'straight') : turns.find((action) => action.street === street);
      expect(chosen, street ?? 'straight').toBeTruthy();
      if (chosen === undefined) return;
      const step = resolve(state, chosen, createPrng('ring'), ctx);
      expect(step.next).not.toBe(state);
      state = step.next;
      lines.push(...step.result.factLines);
    }
    const summary = lines.find((line) => line.includes('On the route you noted') || line.includes('You noted no vehicles'));
    expect(summary).toBeTruthy();
    expect(summary?.toLowerCase()).not.toContain('tail');
    expect(summary?.toLowerCase()).not.toContain('followed');
  });

  it('still generates when the launcher has loaded the demo packs', () => {
    const loaded = loadContent(dirs, withStreetPack(['core'], dirs), { kinds: [...STREET_OPS_KINDS] });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors.slice(0, 3)));
    const cityData = loadCityData(CORE);
    const descriptors = loadDescriptorData(CORE);
    const publicTexts = loadPublicTexts(CORE);
    if (!cityData.ok || !descriptors.ok || !publicTexts.ok) throw new Error('side files failed');
    const world = generateGame('street-ops-enabled-load', {
      content: loaded.value,
      cityData: cityData.value,
      descriptors: descriptors.value,
      publicTexts: publicTexts.value,
      preset: preset(),
      scenario: scenario(),
    });
    expect(world.world.player.loc).toBeTruthy();
    expect(world.world.meta.setting.city).toBe('core');
  });

  it('starts the destination city’s graph after a drive from another city', () => {
    const enabled = scenario();
    const world = generate('street-ops-city', { ...LOADED.inputs, preset: preset(), scenario: enabled });
    const extensions = streetOpsRegistry(enabled, runtime);
    const ctx: ResolverContext = { content: LOADED.content, extensions };
    const driven = resolve(world, { kind: 'street-ops.drive', vehicle: 'staff-saloon' }, createPrng('street-ops-city'), ctx).next;
    const origin = driven.ext?.streetOps?.session?.at.segment;
    expect(runtime.graphs.find((graph) => graph.id === 'inner-court')?.segments.has(origin ?? '')).toBe(true);
    const arrived = {
      ...driven,
      player: {
        ...driven.player,
        city: 'city-berlin/berlin' as NonNullable<typeof driven.player.city>,
        loc: 'loc:berlin-terminal' as typeof driven.player.loc,
      },
    };
    const offered = driveCandidates(arrived, ctx).map((action) => action.kind);
    expect(offered).toContain('street-ops.drive');
    expect(offered).not.toContain('street-ops.turn');
    const next = resolve(arrived, { kind: 'street-ops.drive', vehicle: 'staff-saloon' }, createPrng('street-ops-city'), ctx).next;
    const segment = next.ext?.streetOps?.session?.at.segment;
    expect(segment).toBeTruthy();
    expect(runtime.graphs.find((graph) => graph.id === 'block-grid')?.segments.has(segment ?? '')).toBe(true);
    expect(runtime.graphs.find((graph) => graph.id === 'inner-court')?.segments.has(segment ?? '')).toBe(false);
  });

  it('matches the checked-in drive on Inner Court', () => {
    const enabled = scenario();
    const world = generate('street-ops-golden', { ...LOADED.inputs, preset: preset(), scenario: enabled });
    const extensions = streetOpsRegistry(enabled, runtime);
    const ctx: ResolverContext = { content: LOADED.content, extensions };
    let state = resolve(world, { kind: 'street-ops.drive', vehicle: 'staff-saloon' }, createPrng('street-ops-golden'), ctx).next;
    const lines: string[] = [];
    const path: string[] = [];
    for (const street of [undefined, 'Lamp Cut', 'Sector Road', 'Paper Alley'] as const) {
      const turns = driveCandidates(state, ctx).filter((action) => action.kind === 'street-ops.turn');
      const chosen =
        street === undefined ? turns.find((action) => action.relative === 'straight') : turns.find((action) => action.street === street);
      expect(chosen, street ?? 'straight').toBeTruthy();
      if (chosen === undefined) return;
      const step = resolve(state, chosen, createPrng('street-ops-golden'), ctx);
      expect(step.next).not.toBe(state);
      state = step.next;
      lines.push(...step.result.factLines);
      const at = state.ext?.streetOps?.session?.at.segment;
      if (at !== undefined) path.push(at);
    }
    const recorded = { seed: 'street-ops-golden', path, lines };
    const expected = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'golden', 'drive.json'), 'utf8')) as typeof recorded;
    expect(recorded).toEqual(expected);
  });
});
