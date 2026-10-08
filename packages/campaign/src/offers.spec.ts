/**
 * Posting offers: year, notoriety, assignment, medical leave, and creation.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { asTruth, createPrng } from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import type { CityPackView } from './content/city-pack.js';
import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { cityWeight, DIRECTIVE_THEMES, makeOffers, offerTier } from './offers.js';
import { step } from './reducer.js';
import type { CampaignChoice, CampaignState, HostileDossier } from './state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = join(ROOT, 'packages', 'content', 'packs', 'core');

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const content = campaignContent(loaded.value, campaignSources([CORE], new Set(['core'])).sources);

function created(): CampaignState {
  const choice: Extract<CampaignChoice, { kind: 'create' }> = {
    kind: 'create',
    seed: 'career-seed',
    preset: 'standard',
    officerName: 'Ada',
    background: 'analyst',
    startYear: 1948,
  };
  const result = step(undefined, { kind: 'choice', choice }, content);
  if (!result.ok) {
    throw new Error(result.error.kind);
  }
  return result.value;
}

function city(
  id: string,
  years: readonly [number, number],
  services: readonly string[],
  languages: readonly string[] = [],
): CityPackView {
  return { id, displayName: id, years, languages, services, covers: [] };
}

function dossier(service: string, notoriety: number, descriptorKnown: boolean): HostileDossier {
  return {
    service,
    notoriety,
    descriptorKnown,
    burnedLegends: [],
    patterns: [],
    channelKinds: [],
    suspectedAssets: [],
    doctrineShift: {},
  };
}

const early = city('early', [1948, 1950], ['svc-east'], ['german']);
const late = city('late', [1960, 1962], ['svc-west']);
const hot = city('hot', [1948, 1962], ['svc-east']);
const cool = city('cool', [1948, 1962], ['svc-west'], ['german']);

describe('posting offers', () => {
  it('draws two or three offers when a career is created', () => {
    const state = created();
    expect(state.view.offers.length).toBeGreaterThanOrEqual(2);
    expect(state.view.offers.length).toBeLessThanOrEqual(3);
    for (const offer of state.view.offers) {
      expect(offer.year).toBe(1948);
      expect(offer.assigned).toBe(false);
      expect(offer.tourYears).toBeGreaterThanOrEqual(1);
      expect(offer.tourYears).toBeLessThanOrEqual(3);
      expect(DIRECTIVE_THEMES).toContain(offer.theme);
    }
    const again = created();
    expect(again.view.offers).toEqual(state.view.offers);
  });

  it('keeps only cities open in the year, and the core city when none are', () => {
    const state = created();
    const open = makeOffers(state, content, createPrng('year'), { cities: [early, late] });
    expect(open.length).toBeGreaterThanOrEqual(2);
    expect(open.every((offer) => offer.city === 'early')).toBe(true);

    const none = makeOffers({ ...state, calendar: { year: 1970 } }, content, createPrng('fallback'), {
      cities: [early],
    });
    expect(none.length).toBeGreaterThanOrEqual(2);
    expect(none.every((offer) => offer.city === 'core')).toBe(true);
  });

  it('drops a city whose service already knows the officer', () => {
    const state = created();
    const marked: CampaignState = {
      ...state,
      truth: asTruth({
        ...state.truth,
        dossiers: { 'svc-east': dossier('svc-east', 0.9, true) },
      }),
    };
    const offers = makeOffers(marked, content, createPrng('notoriety'), { cities: [hot, cool] });
    expect(offers.every((offer) => offer.city === 'cool')).toBe(true);
    expect(offers.every((offer) => offer.service === 'svc-west')).toBe(true);

    const spared = makeOffers(
      {
        ...state,
        truth: asTruth({
          ...state.truth,
          dossiers: { 'svc-east': dossier('svc-east', 0.89, true) },
        }),
      },
      content,
      createPrng('below'),
      { cities: [hot] },
    );
    expect(spared.every((offer) => offer.city === 'hot')).toBe(true);
  });

  it('assigns one offer below the threshold and two quiet offers after medical leave', () => {
    const state = created();
    const assigned = makeOffers(
      {
        ...state,
        view: {
          ...state.view,
          officer: { ...state.view.officer, careerStanding: -1 },
        },
      },
      content,
      createPrng('assigned'),
      { assignmentThreshold: 0, cities: [cool, early], tension: 0.8 },
    );
    expect(assigned).toHaveLength(1);
    expect(assigned[0]?.assigned).toBe(true);
    expect(assigned[0]?.tier).toBe('hot');

    const leave = makeOffers(
      {
        ...state,
        view: { ...state.view, officer: { ...state.view.officer, stress: 100 } },
      },
      content,
      createPrng('leave'),
      { cities: [cool], tension: 0.8 },
    );
    expect(leave).toHaveLength(2);
    expect(leave.every((offer) => offer.tier === 'quiet' && offer.assigned === false)).toBe(true);
  });

  it('weights a spoken language above the previous city, and ranks tension into a tier', () => {
    expect(cityWeight(cool, ['german'], undefined)).toBe(3);
    expect(cityWeight(cool, [], undefined)).toBe(1);
    expect(cityWeight(cool, ['german'], 'cool')).toBe(0.75);
    expect(offerTier('case-officer', 0.2)).toBe('quiet');
    expect(offerTier('case-officer', 0.6)).toBe('standard');
    expect(offerTier('case-officer', 0.8)).toBe('hot');
    expect(offerTier('controller', 0.55)).toBe('hot');

    const first = makeOffers(created(), content, createPrng('same'), { cities: [cool] });
    const second = makeOffers(created(), content, createPrng('same'), { cities: [cool] });
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThanOrEqual(2);
    expect(first.length).toBeLessThanOrEqual(4);
  });
});
