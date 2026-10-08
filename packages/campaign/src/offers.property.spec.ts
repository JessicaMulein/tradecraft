/**
 * Property 13: for any campaign state, makeOffers returns 2–4 offers, or
 * exactly one assigned offer while Career Standing is below the assignment
 * threshold. Every offer is a city open in the current year, and none is a
 * city excluded by Notoriety. The draw is pure in the campaign state and seed.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asTruth, createPrng } from '@tradecraft/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { CityPackView } from './content/city-pack.js';
import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { loadCampaignConfig } from './config.js';
import { CORE_CITY, makeOffers } from './offers.js';
import { step } from './reducer.js';
import type { CampaignChoice, CampaignState, HostileDossier } from './state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = join(ROOT, 'packages', 'content', 'packs', 'core');

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const content = campaignContent(loaded.value, campaignSources([CORE], new Set(['core'])).sources);
const config = loadCampaignConfig(join(ROOT, 'config', 'campaign.yaml'));
if (!config.ok) {
  throw new Error(config.issues.map((issue) => issue.message).join('; '));
}
const threshold = config.value.review.assignmentThreshold;

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

const SERVICES = ['svc-0', 'svc-1', 'svc-2', 'svc-3'] as const;

function excluded(city: CityPackView, dossiers: CampaignState['truth']['dossiers']): boolean {
  return city.services.some((service) => {
    const dossier = dossiers[service];
    return dossier !== undefined && dossier.descriptorKnown && dossier.notoriety >= 0.9;
  });
}

function openInYear(
  city: CityPackView,
  year: number,
  dossiers: CampaignState['truth']['dossiers'],
): boolean {
  return year >= city.years[0] && year <= city.years[1] && city.services.length > 0 && !excluded(city, dossiers);
}

const dossierArb = fc.record({
  notoriety: fc.double({ min: 0, max: 1, noNaN: true }),
  descriptorKnown: fc.boolean(),
});

const cityArb = fc
  .record({
    n: fc.integer({ min: 0, max: 5 }),
    from: fc.integer({ min: 1940, max: 1962 }),
    span: fc.integer({ min: 0, max: 15 }),
    services: fc.uniqueArray(fc.constantFrom(...SERVICES), { minLength: 1, maxLength: 2 }),
    language: fc.boolean(),
  })
  .map(
    (city): CityPackView => ({
      id: `city-${city.n}`,
      displayName: `City ${city.n}`,
      years: [city.from, city.from + city.span],
      languages: city.language ? ['german'] : [],
      services: city.services,
      covers: [],
    }),
  );

const sampleArb = fc.record({
  year: fc.integer({ min: 1948, max: 1962 }),
  standing: fc.double({ min: -20, max: 20, noNaN: true }),
  stress: fc.integer({ min: 0, max: 100 }),
  seed: fc.string({ minLength: 1, maxLength: 8 }),
  cities: fc.array(cityArb, { minLength: 1, maxLength: 4 }),
  dossiers: fc.dictionary(fc.constantFrom(...SERVICES), dossierArb, { minKeys: 0, maxKeys: 4 }),
});

describe('offer validity property', () => {
  it('offers only in-year cities, skips notoriety, and assigns below the threshold', () => {
    // Feature: campaign-career, Property 13: Offer validity
    fc.assert(
      fc.property(sampleArb, (sample) => {
        const dossiers: Record<string, HostileDossier> = {};
        for (const [service, row] of Object.entries(sample.dossiers)) {
          dossiers[service] = {
            service,
            notoriety: row.notoriety,
            descriptorKnown: row.descriptorKnown,
            burnedLegends: [],
            patterns: [],
            channelKinds: [],
            suspectedAssets: [],
            doctrineShift: {},
          };
        }
        const state: CampaignState = {
          ...base,
          calendar: { year: sample.year },
          view: {
            ...base.view,
            officer: { ...base.view.officer, careerStanding: sample.standing, stress: sample.stress },
          },
          truth: asTruth({ ...base.truth, dossiers }),
        };
        const before = JSON.stringify(state);
        const draw = { assignmentThreshold: threshold, cities: sample.cities };
        const first = makeOffers(state, content, createPrng(sample.seed), draw);
        const second = makeOffers(state, content, createPrng(sample.seed), draw);
        expect(JSON.stringify(state)).toBe(before);
        expect(second).toEqual(first);

        const open = sample.cities.filter((city) => openInYear(city, sample.year, state.truth.dossiers));
        const allowed =
          open.length > 0
            ? open
            : openInYear(CORE_CITY, sample.year, state.truth.dossiers)
              ? [CORE_CITY]
              : [];
        const allowedIds = new Set(allowed.map((city) => city.id));
        if (sample.standing < threshold) {
          expect(first).toHaveLength(1);
          expect(first[0]?.assigned).toBe(true);
        } else {
          expect(first.length).toBeGreaterThanOrEqual(2);
          expect(first.length).toBeLessThanOrEqual(4);
        }
        for (const offer of first) {
          expect(allowedIds.has(offer.city)).toBe(true);
          expect(offer.year).toBe(sample.year);
          const city = allowed.find((row) => row.id === offer.city);
          expect(city === undefined || excluded(city, state.truth.dossiers)).toBe(false);
        }
      }),
      { numRuns: 100 },
    );
  });
});
