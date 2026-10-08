/**
 * Property 16: for any sequence of hostile-memory merges and year decays,
 * burned legends only grow, pattern counts never fall, notoriety stays in
 * [0, 1] and never rises under decay alone, and each doctrine shift stays
 * inside ±maxDoctrineShift.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ChannelId, DeadDropId, NpcId } from '@tradecraft/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { loadCampaignConfig } from './config.js';
import { decayNotoriety, mergeHostileMemory } from './dossier.js';
import type { HostileDossier, LegendId } from './state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const config = loadCampaignConfig(join(ROOT, 'config', 'campaign.yaml'));
if (!config.ok) {
  throw new Error(config.issues.map((issue) => issue.message).join('; '));
}

const maxShift = config.value.carry.maxDoctrineShift;
const decayPerYear = config.value.notorietyDecay;
const DOCTRINE = ['riskTolerance', 'securityConsciousness', 'deceptionAppetite'] as const;
const LOC_TYPES = ['warehouse', 'cafe', 'hotel', 'port', 'embassy'] as const;
const CHANNELS = ['radio', 'numbers', 'courier', 'dead-drop'] as const;

const empty: HostileDossier = {
  service: 'svc-east',
  notoriety: 0,
  descriptorKnown: false,
  burnedLegends: [],
  patterns: [],
  channelKinds: [],
  suspectedAssets: [],
  doctrineShift: {},
};

function localTypes(id: string): string {
  if (id.startsWith('drop:')) {
    const index = Number(id.slice(5));
    return LOC_TYPES[index] ?? 'warehouse';
  }
  const index = Number(id.slice(5));
  return CHANNELS[index] ?? 'radio';
}

function locUses(dossier: HostileDossier, locType: string): number {
  return dossier.patterns.find((row) => row.locType === locType)?.uses ?? 0;
}

function channelUses(dossier: HostileDossier, kind: (typeof CHANNELS)[number]): number {
  return dossier.channelKinds.find((row) => row.kind === kind)?.uses ?? 0;
}

const shiftAmount = fc.option(fc.double({ min: -2, max: 2, noNaN: true }), { nil: undefined });

const mergeStep = fc.record({
  kind: fc.constant('merge' as const),
  knownCover: fc.boolean(),
  suspectedAssets: fc.array(
    fc.integer({ min: 0, max: 5 }).map((n) => `npc:cp-${n}` as NpcId),
    { maxLength: 4 },
  ),
  compromisedChannels: fc.array(
    fc.integer({ min: 0, max: 3 }).map((n) => `chan:${n}` as ChannelId),
    { maxLength: 4 },
  ),
  compromisedDrops: fc.array(
    fc.integer({ min: 0, max: 4 }).map((n) => `drop:${n}` as DeadDropId),
    { maxLength: 4 },
  ),
  doctrineShift: fc.record({
    riskTolerance: shiftAmount,
    securityConsciousness: shiftAmount,
    deceptionAppetite: shiftAmount,
  }),
  suspicion: fc.double({ min: 0, max: 1, noNaN: true }),
  legend: fc.integer({ min: 1, max: 6 }).map((n) => `lg-${n}` as LegendId),
});

const decayStep = fc.record({
  kind: fc.constant('decay' as const),
  years: fc.integer({ min: 0, max: 5 }),
});

describe('hostile dossier property', () => {
  it('keeps burns and patterns monotone and notoriety and doctrine inside their bounds', () => {
    // Feature: campaign-career, Property 16: Hostile Dossier monotonicity and bounds
    fc.assert(
      fc.property(fc.array(fc.oneof(mergeStep, decayStep), { maxLength: 8 }), (steps) => {
        let dossier = empty;
        for (const step of steps) {
          const previous = dossier;
          if (step.kind === 'decay') {
            dossier = { ...dossier, notoriety: decayNotoriety(dossier.notoriety, step.years, decayPerYear) };
            expect(dossier.notoriety).toBeLessThanOrEqual(previous.notoriety + 1e-9);
          } else {
            dossier = mergeHostileMemory(
              dossier,
              {
                knownCover: step.knownCover,
                suspectedAssets: step.suspectedAssets,
                compromisedChannels: step.compromisedChannels,
                compromisedDrops: step.compromisedDrops,
                doctrineShift: step.doctrineShift,
              },
              { identity: 'clerk', blown: step.knownCover, suspicion: step.suspicion },
              step.legend,
              localTypes,
              maxShift,
            );
          }
          expect(dossier.notoriety).toBeGreaterThanOrEqual(0);
          expect(dossier.notoriety).toBeLessThanOrEqual(1);
          for (const legend of previous.burnedLegends) {
            expect(dossier.burnedLegends).toContain(legend);
          }
          expect(dossier.burnedLegends.length).toBeGreaterThanOrEqual(previous.burnedLegends.length);
          for (const locType of LOC_TYPES) {
            expect(locUses(dossier, locType)).toBeGreaterThanOrEqual(locUses(previous, locType));
          }
          for (const kind of CHANNELS) {
            expect(channelUses(dossier, kind)).toBeGreaterThanOrEqual(channelUses(previous, kind));
          }
          for (const key of DOCTRINE) {
            const value = dossier.doctrineShift[key];
            if (value !== undefined) {
              expect(value).toBeGreaterThanOrEqual(-maxShift);
              expect(value).toBeLessThanOrEqual(maxShift);
            }
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
