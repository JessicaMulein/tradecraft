/**
 * Property 6: a short run at every density stays inside the density caps.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type DifficultyPreset,
} from '@tradecraft/content';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { ScenarioConfigSchema, type ScenarioConfig } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import { revealTruth, type NpcId } from '../model/core.js';
import { ambientBudgets } from './budgets.js';
import type { AmbientState, LifeState } from './state.js';
import { ambientDayBoundary, ambientPhase } from './tick.js';

const CORE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'content',
  'packs',
  'core',
);

const DENSITIES = ['sparse', 'standard', 'rich'] as const;

function loadCore() {
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
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

const CORE = loadCore();

function presetOf(id: string): DifficultyPreset {
  for (const [key, value] of CORE.content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no preset ${id}`);
}

function scenario(presetId: string, density: (typeof DENSITIES)[number] | undefined): ScenarioConfig {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: presetId },
    mole: false,
    ...(density === undefined ? {} : { ambient: { enabled: true, density } }),
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

function inputs(presetId: string, density: (typeof DENSITIES)[number] | undefined): GenerateInputs {
  return {
    content: CORE.content,
    preset: presetOf(presetId),
    scenario: scenario(presetId, density),
    cityData: CORE.cityData,
    descriptors: CORE.descriptors,
    publicTexts: CORE.publicTexts,
  };
}

function degree(ambient: AmbientState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tie of ambient.ties) {
    counts.set(tie.a, (counts.get(tie.a) ?? 0) + 1);
    counts.set(tie.b, (counts.get(tie.b) ?? 0) + 1);
  }
  return counts;
}

function eventOf(value: unknown): { start?: number; end?: number; stage?: number } {
  if (value === null || typeof value !== 'object') {
    return {};
  }
  const record = value as { start?: unknown; end?: unknown; stage?: unknown };
  return {
    ...(typeof record.start === 'number' ? { start: record.start } : {}),
    ...(typeof record.end === 'number' ? { end: record.end } : {}),
    ...(typeof record.stage === 'number' ? { stage: record.stage } : {}),
  };
}

describe('ambient budget caps', () => {
  it('stays inside the density caps across a week of ticks', () => {
    // Feature: ambient-world, Property 6: Budget caps
    fc.assert(
      fc.property(fc.stringMatching(/^[a-z0-9]{1,8}$/), fc.constantFrom(...DENSITIES), (seed, density) => {
        const budget = ambientBudgets(density);
        let world = generate(seed, inputs('standard', density));
        const lifeDays = new Map<string, number[]>();
        for (let day = 0; day < 8; day += 1) {
          world = { ...world, time: { day, phase: 0 } };
          world = ambientDayBoundary(world).state;
          for (const phase of [0, 1, 2, 3] as const) {
            world = { ...world, time: { day, phase } };
            world = ambientPhase(world).state;
          }
          const ambient = world.ambient;
          expect(ambient).toBeDefined();
          if (ambient === undefined) {
            return;
          }
          expect(Object.values(ambient.tier).filter((tier) => tier === 'full').length).toBeLessThanOrEqual(
            budget.fullTier,
          );
          expect(Object.keys(ambient.townsfolk).length).toBeLessThanOrEqual(budget.townsfolk);
          expect(ambient.counters.starts).toBeLessThanOrEqual(budget.eventStarts);
          expect(ambient.counters.incidents).toBeLessThanOrEqual(budget.incidentsPerDay);
          expect(ambient.counters.lifeEvents).toBeLessThanOrEqual(budget.lifeEventsPerDay);
          expect(ambient.counters.gossip).toBeLessThanOrEqual(budget.gossipPerDay);
          expect(ambient.counters.promotions).toBeLessThanOrEqual(budget.promotionsPerDay);
          expect(ambient.counters.threads).toBeLessThanOrEqual(1);
          expect(ambient.gate.slowRunsToday).toBeLessThanOrEqual(budget.slowGatePerDay);
          const activeEvents = Object.values(ambient.events).filter((value) => {
            const event = eventOf(value);
            return event.start !== undefined && event.end !== undefined && event.start <= day && day < event.end;
          });
          expect(activeEvents.length).toBeLessThanOrEqual(budget.activeEvents);
          for (const value of Object.values(ambient.events)) {
            const event = eventOf(value);
            if (event.start !== undefined && event.end !== undefined) {
              const span = event.end - event.start;
              expect(span).toBeGreaterThanOrEqual(1);
              expect(span).toBeLessThanOrEqual(14);
            }
            if (event.stage !== undefined) {
              expect(event.stage).toBeGreaterThanOrEqual(0);
              expect(event.stage).toBeLessThanOrEqual(6);
            }
          }
          const started = Object.values(ambient.events).filter((value) => eventOf(value).start === day);
          expect(started.length).toBeLessThanOrEqual(budget.eventStarts);
          const perSite = new Map<string, number>();
          for (const incident of ambient.incidentLog ?? []) {
            const key = `${incident.loc}|${incident.phase}`;
            perSite.set(key, (perSite.get(key) ?? 0) + 1);
          }
          for (const count of perSite.values()) {
            expect(count).toBeLessThanOrEqual(2);
          }
          const activeStories = Object.values(ambient.stories).filter((story) => story.status === 'active');
          expect(activeStories.length).toBeLessThanOrEqual(budget.activeStories);
          const emergent = (world.sideThreads ?? []).filter((thread) => thread.origin === 'emergent');
          expect(emergent.length).toBeLessThanOrEqual(budget.emergentThreads);
          for (const count of degree(ambient).values()) {
            expect(count).toBeLessThanOrEqual(8);
          }
          const memory = revealTruth(ambient.memory) as Readonly<Record<string, readonly unknown[]>>;
          for (const notes of Object.values(memory)) {
            expect(notes.length).toBeLessThanOrEqual(16);
          }
          for (const person of Object.values(ambient.townsfolk)) {
            expect(person.recollections.length).toBeLessThanOrEqual(4);
          }
          for (const [id, life] of Object.entries(ambient.life) as [NpcId, LifeState][]) {
            if (life.lastLifeEvent === day) {
              const prior = lifeDays.get(id) ?? [];
              prior.push(day);
              lifeDays.set(id, prior);
            }
          }
          const week = Math.floor(day / 7);
          const duties = ambient.duties.filter((duty) => Math.floor(duty.slot.day / 7) === week);
          if (duties.length > 0) {
            expect(duties.length).toBeGreaterThanOrEqual(2);
            expect(duties.length).toBeLessThanOrEqual(4);
          }
        }
        for (const days of lifeDays.values()) {
          for (let i = 0; i < days.length; i += 1) {
            const window = days.filter((when) => when > (days[i] ?? 0) - 7 && when <= (days[i] ?? 0));
            expect(window.length).toBeLessThanOrEqual(1);
          }
        }
      }),
      { numRuns: 100 },
    );
  }, 180_000);
});
