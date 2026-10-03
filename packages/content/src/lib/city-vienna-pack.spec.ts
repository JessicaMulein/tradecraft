/**
 * The City Pack load test for `city-vienna` (content-expansion task 9.1).
 *
 * Loads the shipped `city-vienna` City Pack together with the packs it requires
 * (core, the era-cold-war-early Era Pack and the lib-central-europe / lib-russian
 * Library Packs) from disk through `loadContent`, exactly as a scenario set in
 * Vienna would, and asserts the load succeeds with no ContentErrors — so the
 * City Definition, Districts, Locations, Routes, city Location Types, streets,
 * weather and Sources all parse, every cross-reference resolves (the Culture
 * Weights, the services, the Location Types and the Location sources) and Tag
 * Conformance holds (every core Required Query has its minimum static Binders in
 * the city).
 *
 * It then confirms the merged City Bundle meets the task's geometry targets:
 *
 *   * at least 25 City Locations (CE-QUANTITY, Req 11.2);
 *   * at least 6 Districts, each carrying an occupation `sector`, with the
 *     Innere Stadt as the inter-allied international zone (Req 2.2);
 *   * at least 60 street names across the streets pools (Req 11.2);
 *   * all twelve monthly weather tables (Req 2.6);
 *   * the Schilling currency and at least one Culture Weight (Req 2.1);
 *   * every `real-landmark` Location cites at least one Source (CE-SOURCE,
 *     Req 3.1), and every cited Source id resolves.
 *
 * The first describe block covers the GEOGRAPHY half (task 9.1); the second
 * covers the INSTITUTIONS half (task 9.2): the fictional newspapers, the local
 * organisations, the city local-security Service Definition and its reference
 * from the City Definition, the local Cover Identities, the city Locale (Local
 * Terms and allowNames), the Template Variants and the city article and Rumour
 * templates.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadContent, type ContentSet, type LoadResult } from '../index.js';

const PACKS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packs',
);

const DIRS = [
  join(PACKS_DIR, 'core'),
  join(PACKS_DIR, 'era-cold-war-early'),
  join(PACKS_DIR, 'lib-central-europe'),
  join(PACKS_DIR, 'lib-russian'),
  join(PACKS_DIR, 'city-vienna'),
];

const SELECTED = [
  'core',
  'era-cold-war-early',
  'lib-central-europe',
  'lib-russian',
  'city-vienna',
];

const CITY_ID = 'city-vienna/vienna';

/** Load the Vienna City Pack with its dependencies, surfacing every error. */
function loadVienna(): ContentSet {
  const result: LoadResult<ContentSet> = loadContent(DIRS, SELECTED);
  if (!result.ok) {
    throw new Error(
      `city-vienna failed to load with ${result.errors.length} error(s):\n${result.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  return result.value;
}

describe('city-vienna City Pack (geography)', () => {
  it('loads cleanly with its required packs (no ContentErrors)', () => {
    const result = loadContent(DIRS, SELECTED);
    if (!result.ok) {
      throw new Error(
        result.errors
          .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
          .join('\n'),
      );
    }
    expect(result.ok).toBe(true);
  });

  it('exposes a Vienna City Bundle with the Schilling currency', () => {
    const bundle = loadVienna().cities[CITY_ID];
    expect(bundle, 'missing Vienna City Bundle').toBeDefined();
    expect(bundle.def.name).toBe('Vienna');
    expect(bundle.def.country).toBe('Austria');
    expect(bundle.def.currency.name).toBe('Schilling');
    expect(bundle.def.currency.subunit).toBe('Groschen');
    expect(bundle.def.cultureWeights.length).toBeGreaterThanOrEqual(1);
    expect(bundle.def.period).toEqual({ from: 1945, to: 1955 });
  });

  it('ships at least 6 Districts, each with a sector, Innere Stadt international (Req 2.2)', () => {
    const bundle = loadVienna().cities[CITY_ID];
    expect(bundle.districts.length).toBeGreaterThanOrEqual(6);
    for (const d of bundle.districts) {
      expect(d.sector, `district ${d.id} has no sector`).toBeDefined();
      expect(d.sector!.years).toBeDefined();
    }
    const inner = bundle.districts.find((d) => d.id === 'innere-stadt');
    expect(inner, 'missing Innere Stadt').toBeDefined();
    expect(inner!.sector!.power).toBe('four-power');
    expect(inner!.tags).toContain('sector:international');
  });

  it('ships at least 25 City Locations (CE-QUANTITY, Req 11.2)', () => {
    const bundle = loadVienna().cities[CITY_ID];
    expect(bundle.locations.length).toBeGreaterThanOrEqual(25);
  });

  it('ships at least 60 street names (Req 11.2)', () => {
    const bundle = loadVienna().cities[CITY_ID];
    expect(bundle.streets.length).toBeGreaterThanOrEqual(60);
    expect(new Set(bundle.streets).size).toBe(bundle.streets.length);
  });

  it('ships all twelve monthly weather tables (Req 2.6)', () => {
    const bundle = loadVienna().cities[CITY_ID];
    for (let m = 1; m <= 12; m += 1) {
      const table = bundle.weather.months[String(m) as keyof typeof bundle.weather.months];
      expect(table, `missing weather table for month ${m}`).toBeDefined();
      expect(table.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('has Routes connecting the Districts, with sector-checkpoint tags (Req 2.4)', () => {
    const bundle = loadVienna().cities[CITY_ID];
    expect(bundle.routes.length).toBeGreaterThanOrEqual(bundle.districts.length - 1);
    const checkpoints = bundle.routes.filter((r) =>
      (r.tags ?? []).includes('access:checkpoint'),
    );
    expect(checkpoints.length, 'expected sector-checkpoint routes').toBeGreaterThanOrEqual(1);
  });

  it('cites a Source for every real-landmark Location (CE-SOURCE, Req 3.1)', () => {
    const bundle = loadVienna().cities[CITY_ID];
    const sourceIds = new Set(bundle.sources.map((s) => s.id));
    expect(sourceIds.size).toBeGreaterThanOrEqual(1);
    const landmarks = bundle.locations.filter((l) => l.basis === 'real-landmark');
    expect(landmarks.length, 'expected some real-landmark locations').toBeGreaterThanOrEqual(1);
    for (const loc of landmarks) {
      expect(loc.sources, `landmark ${loc.id} has no sources`).toBeDefined();
      expect(loc.sources!.length).toBeGreaterThanOrEqual(1);
      for (const ref of loc.sources!) {
        const bare = ref.includes('/') ? ref.split('/').pop()! : ref;
        expect(sourceIds.has(bare), `${loc.id} cites unknown source ${ref}`).toBe(true);
      }
    }
  });
});

// =========================================================================
// Institutions and voice (task 9.2): newspapers, local orgs, the city
// local-security service, local Cover Identities, the Locale, the Template
// Variants and the city article and Rumour templates.
// =========================================================================

describe('city-vienna City Pack (institutions and voice)', () => {
  it('ships at least 3 fictional newspapers (CE-QUANTITY, Req 11.2)', () => {
    const bundle = loadVienna().cities[CITY_ID];
    expect(bundle.newspapers.length).toBeGreaterThanOrEqual(3);
    // Every masthead distinct, and each sold against a Location Tag Query.
    const mastheads = bundle.newspapers.map((n) => n.masthead);
    expect(new Set(mastheads).size).toBe(mastheads.length);
    for (const paper of bundle.newspapers) {
      expect(paper.soldAt.length).toBeGreaterThanOrEqual(1);
      expect(paper.days.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('ships at least 4 local organisations (CE-QUANTITY, Req 11.2)', () => {
    const bundle = loadVienna().cities[CITY_ID];
    expect(bundle.orgs.length).toBeGreaterThanOrEqual(4);
    for (const org of bundle.orgs) {
      expect(org.tags.length, `${org.id} must carry an org tag`).toBeGreaterThanOrEqual(1);
    }
  });

  it('defines the city local-security service and references it from the city (Req 19.1, 19.2)', () => {
    const set = loadVienna();
    const localSecurityId = 'city-vienna/city-security-directorate';
    const service = set.services.get(localSecurityId);
    expect(service, 'missing city local-security service').toBeDefined();
    expect(service!.kind).toBe('local-security');
    // The City Definition references it among its services.
    const bundle = set.cities[CITY_ID];
    const refs = bundle.def.services.map((s) => (s.includes('/') ? s : `city-vienna/${s}`));
    expect(refs).toContain(localSecurityId);
    // It is City-Scoped Content owned by this city.
    expect(set.cityScopeOwner[localSecurityId]).toBe(CITY_ID);
  });

  it('ships at least 6 local Cover Identities, each tagged and fitting a Location Type (CE-QUANTITY, Req 11.3)', () => {
    const bundle = loadVienna().cities[CITY_ID];
    expect(bundle.covers.length).toBeGreaterThanOrEqual(6);
    for (const cover of bundle.covers) {
      expect(cover.tags.length, `${cover.id} must carry a cover tag`).toBeGreaterThanOrEqual(1);
      expect(cover.fitLocationTypes.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('ships a city Locale with Local Terms and allowNames (Req 2.9, 8.1)', () => {
    const bundle = loadVienna().cities[CITY_ID];
    expect('city' in bundle.locale.scope).toBe(true);
    expect(bundle.locale.date.months).toHaveLength(12);
    expect(bundle.locale.date.weekdays).toHaveLength(7);
    expect(bundle.locale.honorifics.m).toContain('Herr');
    expect(bundle.locale.currency.pattern).toBe('{symbol}{amount}');
    expect(bundle.locale.terms.length).toBeGreaterThanOrEqual(1);
    expect(bundle.locale.allowNames.length).toBeGreaterThanOrEqual(1);
  });

  it('ships at least 30 Template Variants, all city-scoped to Vienna (CE-QUANTITY, Req 8.1, 11.2)', () => {
    const bundle = loadVienna().cities[CITY_ID];
    expect(bundle.variants.length).toBeGreaterThanOrEqual(30);
    for (const variant of bundle.variants) {
      expect('city' in variant.scope, `${variant.id} must be city-scoped`).toBe(true);
    }
  });

  it('ships city article and Rumour templates (at least 20 combined, Req 11.2)', () => {
    const set = loadVienna();
    const cityDocs = [...set.documentTemplates.keys()].filter((id) =>
      id.startsWith('city-vienna/'),
    );
    const cityRumours = [...set.rumourTemplates.keys()].filter((id) =>
      id.startsWith('city-vienna/'),
    );
    expect(cityDocs.length + cityRumours.length).toBeGreaterThanOrEqual(20);
    expect(cityRumours.length).toBeGreaterThanOrEqual(1);
    expect(cityDocs.length).toBeGreaterThanOrEqual(1);
  });
});
