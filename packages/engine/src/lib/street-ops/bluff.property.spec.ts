/**
 * Properties 11 and 12 (street-ops task 10). The guard's wording does not
 * decide a bluff. A ledger contradiction is recorded exactly when a protected
 * slot changes inside the window.
 *
 * **Validates: Requirements 10.5, 10.6, 10.7, 10.8, 10.9**
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import fc from 'fast-check';
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
import { generate, type GenerateInputs } from '../generate.js';
import { createPrng } from '../prng/prng.js';
import { TruthStore } from '../truth/truth.js';
import { streetOpsRegistry } from './addon.js';
import {
  assessBluff,
  claimsFor,
  extractSlotClaims,
  fileStory,
  findContradictions,
  PROTECTED_SLOTS,
  servicesFor,
  type BluffRequest,
  type StoryTemplate,
} from './bluff.js';
import { CheckpointKindSchema } from './content.js';
import { runtimeFromScenario } from './drive.js';
import { compileStreetGraph, gridGraph } from './graph.js';
import type { StoryEntry } from './state.js';

const TEMPLATE: StoryTemplate = { id: 'late-from-the-office', slots: ['workplace', 'origin'], fits: ['cover'], followUps: [] };

function request(claims: BluffRequest['claims'], ledger: BluffRequest['ledger'] = {}): BluffRequest {
  return {
    template: TEMPLATE,
    claims,
    evasive: false,
    identity: 'cover:clerk',
    service: 'local',
    sharedWith: [],
    place: 'halt',
    at: { day: 3, phase: 1 },
    windowDays: 14,
    ledger,
    tags: ['cover'],
    paperKinds: ['doc:passport'],
    truth: { origin: 'ring', passengers: [], cargo: [] },
    composure: 0.5,
    failureSuspicion: 0.2,
  };
}

describe('bluff engine', () => {
  it('keeps the outcome when the wording changes and the claims do not', () => {
    // Feature: street-ops, Property 11: Bluff independence
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.999, noNaN: true }),
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.string({ minLength: 1, maxLength: 24 }),
        fc.string({ minLength: 1, maxLength: 24 }),
        (draw, origin, textA, textB) => {
          const propositions = [{ slot: 'origin', value: origin }];
          const selected = claimsFor({ template: TEMPLATE, street: 'ring', origin });
          const typedA = claimsFor({ template: TEMPLATE, street: 'ring', text: textA, propositions });
          const typedB = claimsFor({ template: TEMPLATE, street: 'ring', text: textB, propositions });
          expect(typedA).toEqual(typedB);
          const first = assessBluff(request(typedA.claims), draw);
          const second = assessBluff(request(typedB.claims), draw);
          expect(second.passed).toBe(first.passed);
          expect(second.suspicionDelta).toBe(first.suspicionDelta);
          expect(second.wasLie).toBe(first.wasLie);
          expect(second.facts).toEqual(first.facts);
          expect(second.contradictions).toEqual(first.contradictions);
          const again = assessBluff(request(selected.claims), draw);
          const repeated = assessBluff(request(selected.claims), draw);
          expect(repeated).toEqual(again);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('records a contradiction exactly when a protected slot changes inside the window', () => {
    // Feature: street-ops, Property 12: Ledger consistency
    const story = fc.record({
      identity: fc.constantFrom('cover:clerk', 'cover:driver'),
      service: fc.constantFrom('local', 'liaison'),
      shared: fc.uniqueArray(fc.constantFrom('local', 'liaison', 'rival'), { maxLength: 2 }),
      day: fc.integer({ min: 0, max: 20 }),
      slot: fc.constantFrom(...PROTECTED_SLOTS, 'cargo'),
      value: fc.array(fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz"), { minLength: 1, maxLength: 6 }).map((chars) => chars.join('')),
    });
    fc.assert(
      fc.property(fc.array(story, { minLength: 1, maxLength: 8 }), fc.integer({ min: 0, max: 10 }), (stories, windowDays) => {
        let ledger: Record<string, readonly StoryEntry[]> = {};
        const filed: typeof stories = [];
        for (const next of stories) {
          const slots = { [next.slot]: next.value };
          const clash = filed.some((previous) => {
            const earlier = new Set([previous.service, ...previous.shared]);
            const shares = earlier.has(next.service) || next.shared.some((service) => earlier.has(service));
            if (!shares || previous.identity !== next.identity) return false;
            if (next.day < previous.day || next.day - previous.day > windowDays) return false;
            if (!PROTECTED_SLOTS.some((slot) => slot === previous.slot)) return false;
            if (!PROTECTED_SLOTS.some((slot) => slot === next.slot)) return false;
            return previous.slot === next.slot && previous.value !== next.value;
          });
          const found = findContradictions({
            identity: next.identity,
            service: next.service,
            sharedWith: next.shared,
            day: next.day,
            windowDays,
            slots,
            ledger,
          });
          expect(found.length > 0).toBe(clash);
          const entry: StoryEntry = {
            template: 'late-from-the-office',
            at: { day: next.day, phase: 0 },
            wasLie: found.length > 0,
            identity: next.identity,
            service: next.service,
            place: 'halt',
            slots,
          };
          ledger = fileStory(ledger, entry, servicesFor(next.service, next.shared));
          filed.push(next);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('treats an unparsed answer as evasive and files nothing from the model line', () => {
    expect(extractSlotClaims('from the cafe', ['origin'])).toEqual([{ slot: 'origin', value: 'the cafe' }]);
    expect(extractSlotClaims('I would rather not say', ['origin'])).toBeUndefined();
    const evasive = assessBluff({ ...request([]), evasive: true, claims: [] }, 0);
    expect(evasive.passed).toBe(false);
    expect(evasive.wasLie).toBe(false);
    expect(evasive.facts).toEqual(['You do not answer.']);
    expect(evasive.facts.join(' ')).not.toContain('tail');
  });
});

const CORE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'content', 'packs', 'core');

function loadCore(): { content: ContentSet; inputs: Omit<GenerateInputs, 'scenario' | 'preset'> } {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) throw new Error('core pack failed to load');
  const cityData = loadCityData(CORE_DIR);
  if (!cityData.ok) throw new Error('city.yaml failed to load');
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) throw new Error('descriptors.yaml failed to load');
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!publicTexts.ok) throw new Error('public texts failed to load');
  return {
    content: content.value,
    inputs: { content: content.value, cityData: cityData.value, descriptors: descriptors.value, publicTexts: publicTexts.value },
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
    streetOps: { enabled: true, ticksPerPhase: 360 },
  });
}

describe('bluff at a checkpoint', () => {
  it('files the story, ignores the guard line, and catches a later contradiction', () => {
    const enabled = scenario();
    const world = generate('street-ops-bluff', { ...LOADED.inputs, preset: preset(), scenario: enabled });
    const file = gridGraph(2, 2);
    const segment = file.segments[0]?.id;
    if (segment === undefined) throw new Error('grid has no segment');
    const graph = compileStreetGraph({
      ...file,
      frontages: [{ location: world.player.loc, segment, at: 0.2, side: 'right' }],
      checkpoints: [{ id: 'halt', kind: 'document-halt', segment, at: 0.5, service: 'local' }],
    });
    const post = CheckpointKindSchema.parse({
      id: 'document-halt',
      borderCheck: 'pass',
      thoroughness: 0.2,
      hours: ['morning', 'afternoon', 'evening', 'night'],
      searches: ['visual'],
    });
    const runtime = runtimeFromScenario(enabled, {
      graphs: [graph],
      checkpoints: [post],
      bluffSuspicion: 0.2,
      stories: [TEMPLATE],
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
    const store = TruthStore.create({ get: () => undefined });
    const ctx: ResolverContext = { content: LOADED.content, extensions: streetOpsRegistry(enabled, runtime), truth: store };
    const begun = resolve(world, { kind: 'street-ops.drive', vehicle: 'pool-coupe' }, createPrng('bluff'), ctx);
    const told = { kind: 'street-ops.bluff' as const, template: TEMPLATE.id };
    const alpha = resolve(begun.next, { ...told, flavour: 'Where are you going, exactly?' }, createPrng('bluff'), ctx);
    const beta = resolve(begun.next, { ...told, flavour: 'Papers. Now.' }, createPrng('bluff'), ctx);
    expect(beta.result.factLines).toEqual(alpha.result.factLines);
    expect(beta.next.player.coverSuspicion).toEqual(alpha.next.player.coverSuspicion);
    expect(beta.result.factLines.join(' ')).not.toContain('Where are you going');
    const again = resolve(alpha.next, { ...told, origin: 'the office', flavour: 'Try again.' }, createPrng('bluff'), ctx);
    expect(again.result.factLines[0]).toContain('does not match what you said before');
    expect(store.streetOps()?.statements.some((item) => item.wasLie)).toBe(true);
    expect(again.next.ext?.streetOps?.told.map((item) => item.template)).toEqual([TEMPLATE.id, TEMPLATE.id]);
    expect(again.next.ext?.streetOps?.told.some((item) => 'wasLie' in item)).toBe(false);
  });
});
