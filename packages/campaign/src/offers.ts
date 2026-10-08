/**
 * Posting offers (design, "Posting Offers"; Requirements 1.5, 3.6, 9.1–9.5).
 *
 * A pure draw from the campaign PRNG. Cities must be open in the calendar
 * year, and a city is dropped when any service there already knows the
 * officer and has Notoriety at or above 0.9. The core city is offered when
 * no pack is open that year. Weights prefer a language the officer speaks
 * and penalise the previous city. The tier comes from Rank and Tension.
 * Standing below the assignment threshold yields one assigned offer. Medical
 * leave yields two quiet offers. Creation asks for two or three.
 *
 * Directive themes are not authored in content yet, so the draw uses
 * surveillance, recruitment, sabotage and exfiltration. Tension defaults to
 * 0.5 when the year has not been drawn. A language match weighs 3 against 1,
 * and the previous city keeps a quarter of that weight.
 */

import type { Prng } from '@tradecraft/engine';

import type { CityPackView } from './content/city-pack.js';
import type { CampaignContent } from './content/library.js';
import { requiresMedicalLeave } from './progress.js';
import type { CampaignState, PostingOffer, Rank, ServiceId } from './state.js';

/** A city is excluded at this Notoriety once the service knows the officer. */
export const NOTORIETY_EXCLUDE = 0.9;

/** Themes HQ can attach until directive themes are authored as content. */
export const DIRECTIVE_THEMES = ['surveillance', 'recruitment', 'sabotage', 'exfiltration'] as const;

/** The core city, used when the loaded packs name none. */
export const CORE_CITY: CityPackView = {
  id: 'core',
  displayName: 'Vienna',
  years: [1948, 1962],
  languages: ['german'],
  services: ['core/hostile'],
  covers: [],
};

export interface OfferDraw {
  /** Standing below this yields one assigned offer. Defaults to 0. */
  readonly assignmentThreshold?: number;
  /** Creation draws 2–3 offers. A later HQ phase draws 2–4. */
  readonly atCreation?: boolean;
  /** City packs to draw from. Defaults to the packs on the content set. */
  readonly cities?: readonly CityPackView[];
  /** Tension for the tier. Defaults to the stored year, or 0.5. */
  readonly tension?: number;
}

/** Quiet below 0.4, hot at or above 0.75. A senior rank runs hot a little earlier. */
export function offerTier(rank: Rank, tension: number): PostingOffer['tier'] {
  const senior = rank === 'chief-of-station' || rank === 'controller';
  if (tension >= 0.75 || (senior && tension >= 0.55)) {
    return 'hot';
  }
  if (tension < 0.4 || (rank === 'case-officer' && tension < 0.5)) {
    return 'quiet';
  }
  return 'standard';
}

/** Language match weighs 3. The city just left keeps a quarter of its weight. */
export function cityWeight(
  city: CityPackView,
  languages: readonly string[],
  previousCity: string | undefined,
): number {
  const speaks = city.languages.some((language) => languages.includes(language));
  const base = speaks ? 3 : 1;
  return city.id === previousCity ? base * 0.25 : base;
}

/** Draw the next posting offers. Does not modify `state` or `rng`'s past draws. */
export function makeOffers(
  state: CampaignState,
  content: CampaignContent,
  rng: Prng,
  draw: OfferDraw = {},
): PostingOffer[] {
  const threshold = draw.assignmentThreshold ?? 0;
  const officer = state.view.officer;
  const assigned = officer.careerStanding < threshold;
  const medical = requiresMedicalLeave(officer.stress);
  const count = offerCount(rng, { assigned, medical, atCreation: draw.atCreation === true });
  const tier = medical ? 'quiet' : offerTier(officer.rank, tensionOf(state, draw.tension));
  const year = state.calendar.year;
  const languages = officerLanguages(state, content);
  const previous = state.archive.visible[state.archive.visible.length - 1]?.city;
  const pool = candidates(draw.cities ?? citiesFrom(content), year, state);
  const offers: PostingOffer[] = [];
  const remaining = [...pool];
  for (let index = 0; index < count; index += 1) {
    const city = pickCity(remaining, languages, previous, rng);
    const open = city.services.filter((service) => !serviceBlocked(state, service));
    const services = open.length > 0 ? open : city.services;
    const tour = rng.int(1, 3);
    offers.push({
      id: `offer-${state.postings + 1}-${index + 1}`,
      city: city.id,
      service: rng.pick(services),
      year,
      tourYears: tour === 2 || tour === 3 ? tour : 1,
      tier,
      theme: rng.pick(DIRECTIVE_THEMES),
      assigned,
    });
    if (remaining.length > 1) {
      const found = remaining.findIndex((row) => row.id === city.id);
      if (found >= 0) {
        remaining.splice(found, 1);
      }
    }
  }
  return offers;
}

function offerCount(
  rng: Prng,
  mode: { readonly assigned: boolean; readonly medical: boolean; readonly atCreation: boolean },
): number {
  if (mode.assigned) {
    return 1;
  }
  if (mode.medical) {
    return 2;
  }
  if (mode.atCreation) {
    return rng.int(2, 3);
  }
  return rng.int(2, 4);
}

function tensionOf(state: CampaignState, given: number | undefined): number {
  if (given !== undefined) {
    return given;
  }
  const stored = state.truth.tensionByYear[state.calendar.year];
  return stored ?? 0.5;
}

function officerLanguages(state: CampaignState, content: CampaignContent): string[] {
  const spoken: string[] = [];
  for (const skill of content.skills) {
    if (!skill.language) {
      continue;
    }
    const level = state.view.officer.skills[skill.id]?.level ?? 0;
    if (level >= 1) {
      spoken.push(skill.id);
    }
  }
  return spoken;
}

function citiesFrom(content: CampaignContent): CityPackView[] {
  const entries = Object.entries(content.set.cities);
  if (entries.length === 0) {
    return [CORE_CITY];
  }
  return entries.map(([id, bundle]) => ({
    id,
    displayName: bundle.def.name,
    years: [bundle.def.period.from, bundle.def.period.to],
    languages: bundle.def.languages.map((language) => language.id),
    services: [...bundle.def.services],
    covers: bundle.covers.map((cover) => cover.id),
  }));
}

function candidates(cities: readonly CityPackView[], year: number, state: CampaignState): CityPackView[] {
  const open = cities.filter((city) => yearOpen(city, year) && city.services.length > 0 && !cityBlocked(state, city));
  if (open.length > 0) {
    return open;
  }
  const core = cities.find((city) => city.id === CORE_CITY.id) ?? CORE_CITY;
  if (cityBlocked(state, core)) {
    return [];
  }
  return [core];
}

function yearOpen(city: CityPackView, year: number): boolean {
  return year >= city.years[0] && year <= city.years[1];
}

function cityBlocked(state: CampaignState, city: CityPackView): boolean {
  return city.services.some((service) => serviceBlocked(state, service));
}

function serviceBlocked(state: CampaignState, service: ServiceId): boolean {
  const dossier = state.truth.dossiers[service];
  return dossier !== undefined && dossier.descriptorKnown && dossier.notoriety >= NOTORIETY_EXCLUDE;
}

function pickCity(
  cities: readonly CityPackView[],
  languages: readonly string[],
  previous: string | undefined,
  rng: Prng,
): CityPackView {
  const weights = cities.map((city) => cityWeight(city, languages, previous));
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  let cursor = rng.next() * total;
  for (let index = 0; index < cities.length; index += 1) {
    cursor -= weights[index] ?? 0;
    const city = cities[index];
    if (cursor < 0 && city !== undefined) {
      return city;
    }
  }
  return cities[cities.length - 1] ?? CORE_CITY;
}
