/**
 * Tests for the Document model and the Dossier, Cable and public-text composers
 * (task 5.6; Requirements 26.1, 27.4, 30.1, 30.3, 30.5).
 *
 * These load the real core pack and its `city.yaml`, `descriptors.yaml` and
 * public-text corpora, run the full step-1→6/7 core stream (city, orgs,
 * principals, Plot, comms, knowledge), then compose Documents and check the
 * invariants the design and the requirements fix:
 *
 * - **Determinism.** The same seed and content compose byte-identical Documents.
 * - **Dossier asserts the Station slice (Req 26.1).** A Dossier on a subject
 *   asserts exactly the Station Knowledge Slice Propositions about that subject,
 *   HQ false beliefs included; its body carries no Truth and names the subject
 *   through the player-perspective namer.
 * - **Cable is telegraphic (Req 27.4).** A composed HQ directive Cable renders in
 *   clipped upper-case with STOP separators, and asserts the leads it carries.
 * - **Public texts are long enough and obtainable (Req 30.3, 30.5).** Each public
 *   text's body holds at least as many letters as a reasonable field message, and
 *   is obtainable at real library/bookshop/kiosk Locations.
 * - **Book cipher round-trip (Req 30.5).** A book cipher keyed to a generated
 *   public text round-trips a field message of that length.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type CityData,
  type ContentSet,
  type DescriptorData,
  type DifficultyPreset,
  type DocumentTemplate,
  type PublicText,
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import { type GameTime, type Proposition } from '../model/core.js';
import { generateCity } from '../city/generate.js';
import { type City } from '../city/city.js';
import {
  generateOrgs,
  generatePrincipals,
  type GeneratedOrgs,
  type GeneratedPrincipals,
} from '../city/principals.js';
import { generatePlot, type PlotState } from '../city/plot.js';
import { generateComms, type GeneratedComms } from '../city/comms.js';
import { assignKnowledge, type GeneratedKnowledge } from '../city/knowledge.js';
import { bookCipher } from '../cipher/cipher.js';
import { encodePropositions } from '../cipher/field-message.js';

import { countLetters } from './document.js';
import { composeDossier, slicePropsAbout } from './dossier.js';
import { composeCable } from './cable.js';
import {
  PUBLIC_TEXT_LOCATION_TYPES,
  composePublicTexts,
  corpusBody,
  extendToKeyLength,
  publicTextLocations,
} from './public-text.js';

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
  publicTexts: readonly PublicText[];
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
  if (!cityData.ok) throw new Error('city.yaml failed to load');
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) throw new Error('descriptors.yaml failed to load');
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!publicTexts.ok) {
    throw new Error(
      `public texts failed to load:\n${publicTexts.errors
        .map((e) => `  ${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

const { content, cityData, descriptors, publicTexts } = loadCore();
const locationTypes = [...content.locationTypes.values()];

function preset(id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) return value;
  }
  throw new Error(`no difficulty preset ${id}`);
}
const STANDARD = preset('standard');
const START: GameTime = { day: 0, phase: 0 };

/** Find a Document template by local id (unprefixed). */
function docTemplate(local: string): DocumentTemplate {
  for (const [key, value] of content.documentTemplates) {
    if (key === local || key.endsWith(`/${local}`)) return value;
  }
  throw new Error(`no document template ${local}`);
}

const DOSSIER_TEMPLATE = docTemplate('dossier-hq-person');
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

const SEEDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo-123', 'z'];

// ---------------------------------------------------------------------------
// Dossier (Req 26.1)
// ---------------------------------------------------------------------------

describe('composeDossier — HQ file from the Station Knowledge Slice (Req 26.1)', () => {
  it('asserts exactly the Station slice propositions about the subject', () => {
    for (const seed of SEEDS) {
      const g = gen(seed);
      const slice = g.knowledge.station;
      // Pick a subject the Station slice actually mentions, so there is content.
      const subjectIds = new Set(
        [...slice.known, ...slice.falseBeliefs].map((p) => p.subject),
      );
      for (const subjId of subjectIds) {
        if (!subjId.startsWith('npc:')) continue;
        const npc = g.principals.npcs[subjId as keyof typeof g.principals.npcs];
        if (npc === undefined) continue;
        const composed = composeDossier(DOSSIER_TEMPLATE, npc, {
          ...ctxOf(g),
          stationSlice: slice,
        });
        const expected = slicePropsAbout(slice, npc.id).map((p) => p.id);
        expect(composed.document.asserts).toEqual(expected);
        expect(composed.propositions.map((p) => p.id)).toEqual(expected);
        expect(composed.document.kind).toBe('dossier');
        // A dossier is delivered, not obtained at a Location.
        expect(composed.document.obtainableAt).toBeUndefined();
      }
    }
  });

  it('includes HQ false beliefs in a dossier about a falsely-named subject', () => {
    // Find a seed whose station slice has at least one false belief about an NPC.
    for (const seed of SEEDS) {
      const g = gen(seed);
      const slice = g.knowledge.station;
      const falseNpcProp = slice.falseBeliefs.find((p) => p.subject.startsWith('npc:'));
      if (falseNpcProp === undefined) continue;
      const npc = g.principals.npcs[falseNpcProp.subject as keyof typeof g.principals.npcs];
      if (npc === undefined) continue;
      const composed = composeDossier(DOSSIER_TEMPLATE, npc, {
        ...ctxOf(g),
        stationSlice: slice,
      });
      // The false belief's id is among the asserted ids.
      expect(composed.document.asserts).toContain(falseNpcProp.id);
      return; // one witnessing seed suffices
    }
  });

  it('renders a non-empty body that names the subject via the player namer', () => {
    const g = gen('alpha');
    const npc = Object.values(g.principals.npcs)[0];
    const composed = composeDossier(DOSSIER_TEMPLATE, npc, {
      ...ctxOf(g),
      stationSlice: g.knowledge.station,
    });
    expect(composed.document.body.length).toBeGreaterThan(0);
    expect(composed.document.body).toContain(npc.persona.name);
    expect(composed.document.title).toContain(npc.persona.name);
  });

  it('is deterministic for the same seed and subject', () => {
    const g1 = gen('bravo');
    const g2 = gen('bravo');
    const npc1 = Object.values(g1.principals.npcs)[0];
    const npc2 = Object.values(g2.principals.npcs)[0];
    const a = composeDossier(DOSSIER_TEMPLATE, npc1, {
      ...ctxOf(g1),
      stationSlice: g1.knowledge.station,
    });
    const b = composeDossier(DOSSIER_TEMPLATE, npc2, {
      ...ctxOf(g2),
      stationSlice: g2.knowledge.station,
    });
    expect(a.document).toEqual(b.document);
  });
});

// ---------------------------------------------------------------------------
// Cable (Req 27.4, 26.1/26.4)
// ---------------------------------------------------------------------------

describe('composeCable — period telegraphic style (Req 27.4)', () => {
  const g = gen('alpha');

  it('renders telegraphic: upper-case with STOP separators', () => {
    const composed = composeCable(
      CABLE_TEMPLATE,
      {
        cableRef: 'HQ-0001',
        priority: 'IMMEDIATE',
        subject: 'OPERATION BACKDROP',
        instruction: 'PROCEED TO STATION AND AWAIT BRIEF',
        deadline: 'DAY 5',
        budgetLine: 'DRAWN ON STATION ACCOUNT',
      },
      { ...ctxOf(g), date: { day: 0, phase: 0 } },
    );
    expect(composed.document.kind).toBe('cable');
    expect(composed.document.body).toContain('STOP');
    expect(composed.document.body).toContain('FROM HEADQUARTERS');
    // A cable is delivered, not obtained at a Location.
    expect(composed.document.obtainableAt).toBeUndefined();
  });

  it('asserts the leads it carries, and nothing when it carries none', () => {
    const lead: Proposition = {
      id: 'prop:brief/lead-1',
      subject: Object.values(g.principals.npcs)[0].id,
      predicate: 'MEMBER_OF',
      object: g.orgs.cell.id,
    };
    const withLead = composeCable(
      CABLE_TEMPLATE,
      { cableRef: 'HQ-0002', subject: 'BRIEF', instruction: 'SEE ATTACHED' },
      { ...ctxOf(g), date: { day: 0, phase: 0 }, asserts: [lead] },
    );
    expect(withLead.document.asserts).toEqual([lead.id]);
    expect(withLead.propositions).toEqual([lead]);

    const noLead = composeCable(
      CABLE_TEMPLATE,
      { cableRef: 'HQ-0003', subject: 'BRIEF', instruction: 'SEE ATTACHED' },
      { ...ctxOf(g), date: { day: 0, phase: 0 } },
    );
    expect(noLead.document.asserts).toEqual([]);
  });

  it('is deterministic for the same inputs', () => {
    const fields = {
      cableRef: 'HQ-0009',
      subject: 'X',
      instruction: 'Y',
    };
    const a = composeCable(CABLE_TEMPLATE, fields, {
      ...ctxOf(g),
      date: { day: 1, phase: 2 },
    });
    const b = composeCable(CABLE_TEMPLATE, fields, {
      ...ctxOf(g),
      date: { day: 1, phase: 2 },
    });
    expect(a.document).toEqual(b.document);
  });
});

// ---------------------------------------------------------------------------
// Public texts (Req 30.1, 30.3, 30.5)
// ---------------------------------------------------------------------------

describe('composePublicTexts — keyable, obtainable corpora (Req 30.1, 30.3, 30.5)', () => {
  const g = gen('alpha');

  it('produces one public-text Document per corpus, obtainable at real Locations', () => {
    const docs = composePublicTexts(publicTexts, g.city);
    expect(docs.length).toBe(publicTexts.length);
    const realLocs = new Set(Object.keys(g.city.locations));
    for (const doc of docs) {
      expect(doc.kind).toBe('public-text');
      expect(doc.asserts).toEqual([]);
      expect(doc.obtainableAt).toBeDefined();
      expect(doc.obtainableAt!.length).toBeGreaterThan(0);
      for (const loc of doc.obtainableAt!) {
        expect(realLocs.has(loc)).toBe(true);
        // Each is a library/bookshop/kiosk Location.
        const type = g.city.locations[loc].type;
        expect(PUBLIC_TEXT_LOCATION_TYPES).toContain(type);
      }
    }
  });

  it('bodies are long enough to key a book cipher of the required length (Req 30.5)', () => {
    const minKeyLetters = 800;
    const docs = composePublicTexts(publicTexts, g.city, { minKeyLetters });
    for (const doc of docs) {
      expect(countLetters(doc.body)).toBeGreaterThanOrEqual(minKeyLetters);
    }
  });

  it('is deterministic for the same corpora and city', () => {
    const a = composePublicTexts(publicTexts, g.city);
    const b = composePublicTexts(publicTexts, gen('alpha').city);
    expect(a).toEqual(b);
  });

  it('a corpus body (unextended) equals its lines joined by newlines', () => {
    for (const corpus of publicTexts) {
      expect(corpusBody(corpus)).toBe(corpus.lines.join('\n'));
    }
  });

  it('extendToKeyLength lifts a short body over the floor, deterministically', () => {
    const short = 'the cat sat'; // 8 letters
    const extended = extendToKeyLength(short, 100);
    expect(countLetters(extended)).toBeGreaterThanOrEqual(100);
    expect(extendToKeyLength(short, 100)).toBe(extended);
    // A body already long enough is returned unchanged.
    const long = 'x'.repeat(200);
    expect(extendToKeyLength(long, 100)).toBe(long);
  });

  it('publicTextLocations returns only library/bookshop/kiosk Locations, id-sorted', () => {
    const locs = publicTextLocations(g.city);
    const sorted = [...locs].sort();
    expect(locs).toEqual(sorted);
    for (const loc of locs) {
      expect(PUBLIC_TEXT_LOCATION_TYPES).toContain(g.city.locations[loc].type);
    }
  });
});

// ---------------------------------------------------------------------------
// Book cipher keyed to a generated public text (Req 30.5)
// ---------------------------------------------------------------------------

describe('book cipher keyed to a generated public text round-trips (Req 30.5)', () => {
  const g = gen('alpha');
  const docs = composePublicTexts(publicTexts, g.city);

  it('round-trips a field message of several propositions against each corpus', () => {
    // A reasonable field message: a few leads with places.
    const npcIds = Object.values(g.principals.npcs).map((n) => n.id);
    const props: Proposition[] = [
      {
        id: 'p1',
        subject: npcIds[0],
        predicate: 'MEMBER_OF',
        object: g.orgs.cell.id,
      },
      {
        id: 'p2',
        subject: npcIds[0],
        predicate: 'MEETS_AT',
        object: npcIds[1],
        place: Object.keys(g.city.locations)[0] as `loc:${string}`,
      },
    ];
    const message = encodePropositions(props, content.predicates.fieldCodes);
    const need = countLetters(message);

    for (const doc of docs) {
      expect(countLetters(doc.body)).toBeGreaterThanOrEqual(need);
      const key = { kind: 'book' as const, text: doc.body };
      const cipher = bookCipher.encrypt(message, key);
      const back = bookCipher.decrypt(cipher, key);
      expect(back).toBe(message);
    }
  });

  it('round-trips arbitrary short plaintexts (property)', () => {
    const doc = docs[0];
    const key = { kind: 'book' as const, text: doc.body };
    const keyLetters = countLetters(doc.body);
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), (plain) => {
        // The book cipher only needs the key to be at least as long as the
        // message in letters; the corpus is far longer than any short message.
        fc.pre(countLetters(plain) <= keyLetters);
        const cipher = bookCipher.encrypt(plain, key);
        const back = bookCipher.decrypt(cipher, key);
        expect(back).toBe(plain);
      }),
      { numRuns: 100 },
    );
  });
});
