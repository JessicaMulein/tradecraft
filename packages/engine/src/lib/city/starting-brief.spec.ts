/**
 * Tests for the Cover Identity and the Starting Brief (task 5.7; Requirements
 * 26.1, 26.2, 26.4).
 *
 * These load the real core pack, its `city.yaml` and `descriptors.yaml`, run
 * the full step-1→6/7 core stream (city, orgs, principals, Plot, comms,
 * knowledge), then run step 8 ({@link generateStartingBrief}) and check the
 * invariants the design and the requirements fix:
 *
 * - **Cover Identity (design, step 8).** The issued cover carries a title, an
 *   employer org, plausible fit Location Types and the two Cover Suspicion
 *   modifiers; every fit Type it records is a Type the generated city actually
 *   stamps, so the cover is plausible for this city.
 * - **Leads from the Station slice (Req 26.2, Property 19).** The brief carries
 *   2–4 leads; every lead is a member of the Station's Knowledge Slice (a true
 *   lead or an HQ false belief), and every lead's source is the brief Cable's
 *   `DocId` with kind `document` (Req 26.1).
 * - **Delivered as a Cable (Req 26.4).** The brief names a `cable` Document; the
 *   Cable asserts exactly the leads, so reading it seeds the Case File.
 * - **Known entities (design).** The starting known-entity set includes the
 *   Chief, every Station staffer and every starting contact, and names no
 *   entity a lead does not.
 * - **Determinism (Property 1).** The same seed and content produce an identical
 *   brief, and the brief's own stream does not shift the core stream.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  type CityData,
  type ContentSet,
  type DescriptorData,
  type DifficultyPreset,
  type DocumentTemplate,
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import { type GameTime, type PropId } from '../model/core.js';
import { generateCity } from './generate.js';
import { type City } from './city.js';
import {
  generateOrgs,
  generatePrincipals,
  type GeneratedOrgs,
  type GeneratedPrincipals,
} from './principals.js';
import { generatePlot, type PlotState } from './plot.js';
import { generateComms, type GeneratedComms } from './comms.js';
import { assignKnowledge, type GeneratedKnowledge } from './knowledge.js';
import {
  MIN_BRIEF_LEADS,
  MAX_BRIEF_LEADS,
  generateCoverIdentity,
  generateStartingBrief,
} from './starting-brief.js';

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

function loadCore(): {
  content: ContentSet;
  cityData: CityData;
  descriptors: DescriptorData;
} {
  const content = loadContent([CORE_DIR], ['core']);
  if (!content.ok) {
    throw new Error(
      `core pack failed to load:\n${content.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  const cityData = loadCityData(CORE_DIR);
  if (!cityData.ok) {
    throw new Error('city.yaml failed to load');
  }
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) {
    throw new Error('descriptors.yaml failed to load');
  }
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
  };
}

const { content, cityData, descriptors } = loadCore();
const locationTypes = [...content.locationTypes.values()];

function preset(id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

const STANDARD = preset('standard');
const START: GameTime = { day: 0, phase: 0 };

/** Find a Document template by local id (unprefixed). */
function docTemplate(local: string): DocumentTemplate {
  for (const [key, value] of content.documentTemplates) {
    if (key === local || key.endsWith(`/${local}`)) {
      return value;
    }
  }
  throw new Error(`no document template ${local}`);
}

const CABLE_TEMPLATE = docTemplate('cable-hq-directive');

interface Generated {
  readonly city: City;
  readonly orgs: GeneratedOrgs;
  readonly principals: GeneratedPrincipals;
  readonly plot: PlotState;
  readonly comms: GeneratedComms;
  readonly knowledge: GeneratedKnowledge;
}

/** Run the full step-1→6/7 generation on one core stream for a seed. */
function gen(seed: string, p: DifficultyPreset = STANDARD): Generated {
  const prng = createPrng(seed);
  const { city } = generateCity(prng, locationTypes, cityData);
  const orgs = generateOrgs(prng);
  const principals = generatePrincipals(prng, content, descriptors, city, orgs);
  const { plot } = generatePlot(prng, content, p, city, orgs, principals, START);
  const comms = generateComms(prng, content, city, orgs, principals, plot, START);
  const knowledge = assignKnowledge(
    prng,
    orgs,
    principals,
    plot,
    comms,
    city,
    { hqFalseBeliefRate: p.hqFalseBeliefRate },
    {},
  );
  return { city, orgs, principals, plot, comms, knowledge };
}

/** Build a namer context from a generated world. */
function ctxOf(g: Generated) {
  return { city: g.city, npcs: g.principals.npcs, orgs: g.orgs.orgs };
}

/** Generate a Starting Brief for a seed over the full generated world. */
function brief(seed: string, p: DifficultyPreset = STANDARD) {
  const g = gen(seed, p);
  const result = generateStartingBrief(
    seed,
    content,
    g.city,
    g.principals,
    g.comms,
    g.knowledge.station,
    CABLE_TEMPLATE,
    ctxOf(g),
    { startingBudget: p.startingBudget },
  );
  return { g, ...result };
}

/** The distinct Location Type ids the city stamps. */
function cityTypes(city: City): Set<string> {
  return new Set(Object.values(city.locations).map((l) => l.type));
}

const SEEDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo-123', 'z'];

// ---------------------------------------------------------------------------
// Cover Identity (design, step 8)
// ---------------------------------------------------------------------------

describe('generateCoverIdentity — a plausible, city-fitting cover (design step 8)', () => {
  it('carries title, employer, fit Location Types and both suspicion modifiers', () => {
    for (const seed of SEEDS) {
      const g = gen(seed);
      const prng = createPrng(seed);
      const cover = generateCoverIdentity(prng, content, g.city);
      expect(cover.title.length).toBeGreaterThan(0);
      expect(cover.employerOrg.length).toBeGreaterThan(0);
      expect(cover.id.length).toBeGreaterThan(0);
      expect(cover.fitLocationTypes.length).toBeGreaterThan(0);
      expect(typeof cover.suspicionModifiers.atFit).toBe('number');
      expect(typeof cover.suspicionModifiers.elsewhere).toBe('number');
    }
  });

  it('records only fit Location Types the generated city actually stamps', () => {
    for (const seed of SEEDS) {
      const g = gen(seed);
      const prng = createPrng(seed);
      const cover = generateCoverIdentity(prng, content, g.city);
      const types = cityTypes(g.city);
      for (const t of cover.fitLocationTypes) {
        expect(types.has(t)).toBe(true);
      }
    }
  });

  it('draws from the content cover pool and reads back by id', () => {
    const g = gen('alpha');
    const prng = createPrng('alpha');
    const cover = generateCoverIdentity(prng, content, g.city);
    const poolIds = new Set(
      [...content.coverIdentities.values()].map((c) => c.id),
    );
    expect(poolIds.has(cover.id)).toBe(true);
  });

  it('fits a cover plausibly: lowers suspicion where it belongs, raises it elsewhere', () => {
    // The core pool authors atFit negative and elsewhere positive; a drawn cover
    // keeps those (guarded numeric assertions, since Zod rejects Infinity/NaN).
    for (const seed of SEEDS) {
      const g = gen(seed);
      const prng = createPrng(seed);
      const cover = generateCoverIdentity(prng, content, g.city);
      expect(Number.isFinite(cover.suspicionModifiers.atFit)).toBe(true);
      expect(Number.isFinite(cover.suspicionModifiers.elsewhere)).toBe(true);
      expect(cover.suspicionModifiers.atFit).toBeLessThanOrEqual(0);
      expect(cover.suspicionModifiers.elsewhere).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Leads from the Station slice (Req 26.1, 26.2; Property 19)
// ---------------------------------------------------------------------------

describe('generateStartingBrief — leads from the Station Knowledge Slice (Req 26.1, 26.2)', () => {
  it('carries 2–4 leads (or fewer only when the slice holds fewer)', () => {
    for (const seed of SEEDS) {
      const { g, brief: b } = brief(seed);
      const sliceSize =
        g.knowledge.station.known.length +
        g.knowledge.station.falseBeliefs.length;
      const expectedMax = Math.min(MAX_BRIEF_LEADS, sliceSize);
      expect(b.leads.length).toBeLessThanOrEqual(expectedMax);
      if (sliceSize >= MIN_BRIEF_LEADS) {
        expect(b.leads.length).toBeGreaterThanOrEqual(MIN_BRIEF_LEADS);
      }
    }
  });

  it('every lead is a member of the Station slice (true lead or HQ false belief)', () => {
    for (const seed of SEEDS) {
      const { g, brief: b } = brief(seed);
      const sliceIds = new Set<PropId>(
        [
          ...g.knowledge.station.known,
          ...g.knowledge.station.falseBeliefs,
        ].map((p) => p.id),
      );
      for (const lead of b.leads) {
        expect(sliceIds.has(lead.prop.id)).toBe(true);
      }
    }
  });

  it('every lead is sourced from the brief Cable DocId with kind document (Req 26.1)', () => {
    for (const seed of SEEDS) {
      const { brief: b } = brief(seed);
      for (const lead of b.leads) {
        expect(lead.source.kind).toBe('document');
        expect(lead.source.id).toBe(b.cable);
      }
    }
  });

  it('leads may include HQ false beliefs when the slice holds them', () => {
    // Witness at least one seed whose brief carries a false-belief lead; the
    // standard preset's hqFalseBeliefRate makes this overwhelmingly likely
    // across the seed set, but a brief with none is still valid.
    let sawFalseLead = false;
    for (const seed of SEEDS) {
      const { g, brief: b } = brief(seed);
      const falseIds = new Set<PropId>(
        g.knowledge.station.falseBeliefs.map((p) => p.id),
      );
      if (b.leads.some((lead) => falseIds.has(lead.prop.id))) {
        sawFalseLead = true;
        break;
      }
    }
    expect(sawFalseLead).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Delivered as a Cable (Req 26.4)
// ---------------------------------------------------------------------------

describe('generateStartingBrief — delivered as a Cable Document (Req 26.4)', () => {
  it('names a cable Document that asserts exactly the leads', () => {
    for (const seed of SEEDS) {
      const { brief: b, cable } = brief(seed);
      expect(cable.document.kind).toBe('cable');
      expect(b.cable).toBe(cable.document.id);
      // The Cable asserts exactly the brief's lead propositions, in order.
      const leadIds = b.leads.map((lead) => lead.prop.id);
      expect(cable.document.asserts).toEqual(leadIds);
      expect(cable.propositions.map((p) => p.id)).toEqual(leadIds);
      // A brief Cable is delivered, not obtained at a Location.
      expect(cable.document.obtainableAt).toBeUndefined();
    }
  });

  it('renders a telegraphic brief Cable carrying the budget line', () => {
    const { brief: b, cable } = brief('alpha');
    expect(cable.document.body).toContain('STOP');
    expect(cable.document.body).toContain('FROM HEADQUARTERS');
    expect(cable.document.body).toContain(String(b.budget));
  });
});

// ---------------------------------------------------------------------------
// Known entities and the rest of the package (Req 26.1)
// ---------------------------------------------------------------------------

describe('generateStartingBrief — the opening package (Req 26.1)', () => {
  it('known entities include the Chief, every staffer and every contact', () => {
    for (const seed of SEEDS) {
      const { g, brief: b } = brief(seed);
      const known = new Set(b.knownEntities);
      expect(known.has(g.principals.chief)).toBe(true);
      for (const staff of g.principals.staff) {
        expect(known.has(staff)).toBe(true);
      }
      for (const contact of g.principals.contacts) {
        expect(known.has(contact)).toBe(true);
      }
    }
  });

  it('known entities include every public Location and are de-duplicated', () => {
    for (const seed of SEEDS) {
      const { g, brief: b } = brief(seed);
      const known = new Set(b.knownEntities);
      for (const loc of Object.values(g.city.locations)) {
        if (loc.public) {
          expect(known.has(loc.id)).toBe(true);
        }
      }
      expect(b.knownEntities.length).toBe(known.size);
    }
  });

  it('binds the Station Channels, the player Dead Drop, the budget and the contacts', () => {
    for (const seed of SEEDS) {
      const { g, brief: b } = brief(seed);
      expect(b.chief).toBe(g.principals.chief);
      expect(b.channels).toEqual([...g.comms.stationChannels]);
      expect(b.channels.length).toBeGreaterThanOrEqual(1);
      expect(b.deadDrops).toEqual([g.comms.stationDrop]);
      expect(b.deadDrops.length).toBeGreaterThanOrEqual(1);
      expect(b.budget).toBe(STANDARD.startingBudget);
      expect(b.contacts).toEqual([...g.principals.contacts]);
    }
  });

  it('threads supplied starting Directives through unchanged', () => {
    const g = gen('alpha');
    const directives = [{}, {}] as const;
    const result = generateStartingBrief(
      'alpha',
      content,
      g.city,
      g.principals,
      g.comms,
      g.knowledge.station,
      CABLE_TEMPLATE,
      ctxOf(g),
      { startingBudget: STANDARD.startingBudget },
      { directives },
    );
    expect(result.brief.directives).toEqual(directives);
  });
});

// ---------------------------------------------------------------------------
// Determinism (Property 1)
// ---------------------------------------------------------------------------

describe('generateStartingBrief — determinism (Property 1)', () => {
  it('is byte-identical for the same seed and content', () => {
    for (const seed of SEEDS) {
      const a = brief(seed);
      const b = brief(seed);
      expect(a.brief).toEqual(b.brief);
      expect(a.cable.document).toEqual(b.cable.document);
    }
  });

  it('runs on its own stream: the brief does not depend on draw order after knowledge', () => {
    // Generating the brief twice over the same world — once immediately, once
    // after an unrelated world generation — yields the same brief, because the
    // brief draws on derive(seed, BRIEF_STREAM_INDEX), not the live core stream.
    const g = gen('bravo');
    const first = generateStartingBrief(
      'bravo',
      content,
      g.city,
      g.principals,
      g.comms,
      g.knowledge.station,
      CABLE_TEMPLATE,
      ctxOf(g),
      { startingBudget: STANDARD.startingBudget },
    );
    gen('unrelated-seed');
    const second = generateStartingBrief(
      'bravo',
      content,
      g.city,
      g.principals,
      g.comms,
      g.knowledge.station,
      CABLE_TEMPLATE,
      ctxOf(g),
      { startingBudget: STANDARD.startingBudget },
    );
    expect(first.brief).toEqual(second.brief);
  });

  it('leads stay a stable subset of the slice across runs (property)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...SEEDS), (seed) => {
        const { g, brief: b } = brief(seed);
        const sliceIds = new Set<PropId>(
          [
            ...g.knowledge.station.known,
            ...g.knowledge.station.falseBeliefs,
          ].map((p) => p.id),
        );
        for (const lead of b.leads) {
          expect(sliceIds.has(lead.prop.id)).toBe(true);
        }
        // The lead count never exceeds the design's maximum.
        expect(b.leads.length).toBeLessThanOrEqual(MAX_BRIEF_LEADS);
      }),
      { numRuns: 50 },
    );
  });
});
