/**
 * Property 15: for any Hostile Dossiers and chosen city, the legends HQ
 * offers are covers that city allows, and none is a legend burned to a
 * Hostile Service active there. The burn set is the dossier, not the
 * officer's observed burns.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asTruth } from '@tradecraft/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { LEGEND_REFUSAL, quotePreparation, type LegendCity } from './prepare.js';
import { step } from './reducer.js';
import type {
  CampaignChoice,
  CampaignState,
  HostileDossier,
  LegendId,
  OfficerLegend,
} from './state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = join(ROOT, 'packages', 'content', 'packs', 'core');

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const content = campaignContent(loaded.value, campaignSources([CORE], new Set(['core'])).sources);

const created = step(undefined, {
  kind: 'choice',
  choice: {
    kind: 'create',
    seed: 'career-seed',
    preset: 'standard',
    officerName: 'Ada',
    background: 'analyst',
    startYear: 1948,
  } satisfies Extract<CampaignChoice, { kind: 'create' }>,
}, content);
if (!created.ok) {
  throw new Error(created.error.kind);
}
const base = created.value;

const COVERS = ['clerk', 'journalist', 'waiter', 'diplomat', 'student', 'nurse'] as const;
const SERVICES = ['svc-0', 'svc-1', 'svc-2', 'svc-3'] as const;

interface Burn {
  readonly service: (typeof SERVICES)[number];
  readonly legendNs: readonly number[];
}

const worldArb = fc.record({
  covers: fc.uniqueArray(fc.constantFrom(...COVERS), { maxLength: 4 }),
  services: fc.uniqueArray(fc.constantFrom(...SERVICES), { maxLength: 3 }),
  legends: fc.uniqueArray(
    fc.record({
      n: fc.integer({ min: 1, max: 6 }),
      cover: fc.constantFrom(...COVERS),
    }),
    { maxLength: 4, selector: (legend) => legend.n },
  ),
  burns: fc.array(
    fc.record({
      service: fc.constantFrom(...SERVICES),
      legendNs: fc.uniqueArray(fc.integer({ min: 1, max: 8 }), { maxLength: 3 }),
    }),
    { maxLength: 4 },
  ),
});

function legendId(n: number): LegendId {
  return `lg-${n}`;
}

function burnedCovers(
  legends: readonly OfficerLegend[],
  dossiers: CampaignState['truth']['dossiers'],
  services: readonly string[],
): Set<string> {
  const burned = new Set<string>();
  for (const service of services) {
    const dossier = dossiers[service];
    if (dossier === undefined) {
      continue;
    }
    for (const id of dossier.burnedLegends) {
      burned.add(id);
    }
  }
  const covers = new Set<string>();
  for (const legend of legends) {
    if (burned.has(legend.id)) {
      covers.add(legend.cover);
    }
  }
  return covers;
}

function dossiersFor(burns: readonly Burn[]): CampaignState['truth']['dossiers'] {
  const byService = new Map<string, LegendId[]>();
  for (const burn of burns) {
    const ids = byService.get(burn.service) ?? [];
    for (const n of burn.legendNs) {
      const id = legendId(n);
      if (!ids.includes(id)) {
        ids.push(id);
      }
    }
    byService.set(burn.service, ids);
  }
  const dossiers: Record<string, HostileDossier> = {};
  for (const [service, burnedLegends] of byService) {
    dossiers[service] = {
      service,
      notoriety: 0.2,
      descriptorKnown: false,
      burnedLegends,
      patterns: [],
      channelKinds: [],
      suspectedAssets: [],
      doctrineShift: {},
    };
  }
  return dossiers;
}

describe('legend eligibility property', () => {
  it('offers only city covers that are not burned to a service active there', () => {
    // Feature: campaign-career, Property 15: Legend eligibility
    fc.assert(
      fc.property(worldArb, ({ covers, services, legends, burns }) => {
        const officerLegends: OfficerLegend[] = legends.map((legend) => ({
          id: legendId(legend.n),
          cover: legend.cover,
          name: `Name ${legend.n}`,
          official: true,
          posting: 0,
          observedBurnedBy: [],
        }));
        const dossiers = dossiersFor(burns);
        const state: CampaignState = {
          ...base,
          step: { kind: 'prepare' },
          view: {
            ...base.view,
            chosen: 'offer-1',
            officer: { ...base.view.officer, legends: officerLegends },
          },
          truth: asTruth({ ...base.truth, dossiers }),
        };
        const cityCovers: readonly string[] = covers;
        const city: LegendCity = { covers: cityCovers, services };
        const blocked = burnedCovers(officerLegends, dossiers, services);
        const before = JSON.stringify(state);
        const candidates = new Set<string>([...cityCovers, ...officerLegends.map((legend) => legend.cover), 'foreign']);
        for (const cover of candidates) {
          const quote = quotePreparation(state, { kind: 'legend', cover, name: 'Marta' }, content, city);
          const eligible = cityCovers.includes(cover) && !blocked.has(cover);
          expect(quote.allowed).toBe(eligible);
          if (!quote.allowed && (blocked.has(cover) || !cityCovers.includes(cover))) {
            expect(quote.reason).toBe(LEGEND_REFUSAL);
            for (const service of services) {
              expect(quote.reason).not.toContain(service);
            }
          }
        }
        expect(JSON.stringify(state)).toBe(before);
      }),
      { numRuns: 100 },
    );
  });
});
