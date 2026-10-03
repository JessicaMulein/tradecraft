/**
 * Tests for the newspaper and seized-material Document composers (task 9.1;
 * Requirements 30.1, 30.2).
 *
 * These load the real core pack and its `city.yaml` / `descriptors.yaml`, run
 * the core stream (city, orgs, principals, Plot, comms) to get real entities to
 * name, then compose a newspaper from a built day-material pool and a seized
 * Document, checking the invariants the design and the requirements fix:
 *
 * - **A newspaper is a `newspaper`-kind Document with 3–6 articles** drawn from
 *   the day's city events, public Plot traces, Side-Thread traces and Rumours;
 *   fewer only when the pool is thin (Requirement 30.2).
 * - **Its asserted Propositions include the material's** — true traces AND false
 *   rumours alike — so reading the edition seeds the Case File (Requirement
 *   30.1), and the player must corroborate which lines are real.
 * - **Determinism.** The same daily seed and material compose a byte-identical
 *   Document; the DocId is unique and day-scoped.
 * - **The newspaper day-boundary hook** emits a `newspaper` SimEvent naming the
 *   Document and threads the composed edition out through its cell.
 * - **A seized-material Document asserts its source Propositions** (Requirement
 *   30.1).
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
  type DocumentTemplate,
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import { dailyStreamSeed } from '../city/city.js';
import { type City } from '../city/city.js';
import {
  type GameTime,
  type Proposition,
  type PropId,
} from '../model/core.js';
import { generateCity } from '../city/generate.js';
import {
  generateOrgs,
  generatePrincipals,
  type GeneratedOrgs,
  type GeneratedPrincipals,
} from '../city/principals.js';

import {
  MIN_ARTICLES,
  MAX_ARTICLES,
  EMPTY_MATERIAL,
  cityWeatherItem,
  dailyMaterial,
  newspaperPool,
  selectArticles,
  composeNewspaper,
  composeSeizedDocument,
  newspaperCell,
  newspaperDayBoundaryHook,
  type NewspaperItem,
  type NewspaperMaterial,
} from './newspaper.js';

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
  if (!cityData.ok) throw new Error('city.yaml failed to load');
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) throw new Error('descriptors.yaml failed to load');
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
  };
}

const { content, cityData, descriptors } = loadCore();
const locationTypes = [...content.locationTypes.values()];
const START: GameTime = { day: 0, phase: 0 };

/** Find a Document template by local id (unprefixed). */
function docTemplate(local: string): DocumentTemplate {
  for (const [key, value] of content.documentTemplates) {
    if (key === local || key.endsWith(`/${local}`)) return value;
  }
  throw new Error(`no document template ${local}`);
}

const NEWSPAPER_TEMPLATE = docTemplate('newspaper-wiener-tagblatt-city');
const BLOTTER_TEMPLATE = docTemplate('newspaper-wiener-tagblatt-blotter');
const NOTICES_TEMPLATE = docTemplate('newspaper-amtsblatt-notices');
const SEIZED_TEMPLATE = docTemplate('seized-handwritten-note');

interface Generated {
  readonly city: City;
  readonly orgs: GeneratedOrgs;
  readonly principals: GeneratedPrincipals;
}

/** Run the step-1→4 core stream for a seed, enough to get entities to name. */
function gen(seed: string): Generated {
  const prng = createPrng(seed);
  const { city } = generateCity(prng, locationTypes, cityData);
  const orgs = generateOrgs(prng);
  const principals = generatePrincipals(prng, content, descriptors, city, orgs);
  return { city, orgs, principals };
}

/** Build a namer context from a generated world. */
function ctxOf(g: Generated) {
  return { city: g.city, npcs: g.principals.npcs, orgs: g.orgs.orgs };
}

/** A true Proposition naming two NPCs (a plausible plot/side-thread trace fact). */
function trueProp(id: string, g: Generated): Proposition {
  const npcIds = Object.values(g.principals.npcs).map((n) => n.id);
  const loc = Object.keys(g.city.locations)[0] as `loc:${string}`;
  return {
    id: id as PropId,
    subject: npcIds[0],
    predicate: 'MEETS_AT',
    object: npcIds[1 % npcIds.length],
    place: loc,
    window: { from: START },
  };
}

/** A false Proposition a rumour carries (shape is well-formed; it is a belief). */
function falseProp(id: string, g: Generated): Proposition {
  const npcIds = Object.values(g.principals.npcs).map((n) => n.id);
  return {
    id: id as PropId,
    subject: npcIds[2 % npcIds.length],
    predicate: 'MEMBER_OF',
    object: g.orgs.cell.id,
  };
}

/**
 * Build a day's material pool with the four sources populated: one city-event
 * item (weather), two public plot traces (true), two side-thread traces (true)
 * and two rumours (false). Enough to let the composer draw 3–6 articles.
 */
function builtMaterial(g: Generated, day: number): NewspaperMaterial {
  const plotTraces: NewspaperItem[] = [
    {
      id: 'plot/1',
      source: 'plot-trace',
      headline: 'A meeting observed',
      summary: 'Two figures were seen at a public table near the ring.',
      asserts: [trueProp('prop:plot/1', g)],
    },
    {
      id: 'plot/2',
      source: 'plot-trace',
      headline: 'A signal reported',
      summary: 'A wireless murmur was logged in the small hours.',
      asserts: [trueProp('prop:plot/2', g)],
    },
  ];
  const sideThreadTraces: NewspaperItem[] = [
    {
      id: 'thread/1',
      source: 'side-thread',
      headline: 'A quarrel at the market',
      summary: 'Words were exchanged over the price of coffee.',
      asserts: [trueProp('prop:thread/1', g)],
    },
    {
      id: 'thread/2',
      source: 'side-thread',
      headline: 'A courier seen',
      summary: 'A messenger crossed the sector boundary twice.',
      asserts: [trueProp('prop:thread/2', g)],
    },
  ];
  const rumours: NewspaperItem[] = [
    {
      id: 'rumour/1',
      source: 'rumour',
      headline: 'Gossip from the cafés',
      summary: 'They say a stranger has taken rooms above the tobacconist.',
      asserts: [falseProp('prop:rumour/1', g)],
    },
    {
      id: 'rumour/2',
      source: 'rumour',
      headline: 'A tale retold',
      summary: 'A name is whispered that no one can quite place.',
      asserts: [falseProp('prop:rumour/2', g)],
    },
  ];
  return dailyMaterial(
    day,
    { summary: 'clear and cold' },
    plotTraces,
    sideThreadTraces,
    rumours,
  );
}

const SEEDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo-123'];

// ---------------------------------------------------------------------------
// composeNewspaper — the daily edition (Req 30.2)
// ---------------------------------------------------------------------------

describe('composeNewspaper — the daily edition (Req 30.2)', () => {
  it('is a newspaper-kind Document with 3–6 articles drawn from the pool', () => {
    for (const seed of SEEDS) {
      const g = gen(seed);
      const day = 3;
      const material = builtMaterial(g, day);
      const pool = newspaperPool(material);
      const prng = createPrng(dailyStreamSeed(seed, day));
      const composed = composeNewspaper(
        NEWSPAPER_TEMPLATE,
        material,
        { ...ctxOf(g), date: { day, phase: 0 } },
        prng,
      );
      expect(composed.document.kind).toBe('newspaper');
      expect(composed.document.date).toEqual({ day, phase: 0 });
      expect(composed.document.body.length).toBeGreaterThan(0);
      // The pool here has 7 items (1 city + 2 plot + 2 thread + 2 rumour), so a
      // well-stocked edition carries between MIN and MAX articles. The number of
      // selected articles is recoverable from the selection draw.
      const selPrng = createPrng(dailyStreamSeed(seed, day));
      const selected = selectArticles(pool, selPrng);
      expect(selected.length).toBeGreaterThanOrEqual(MIN_ARTICLES);
      expect(selected.length).toBeLessThanOrEqual(MAX_ARTICLES);
    }
  });

  it('asserts the selected articles propositions — true traces and false rumours alike (Req 30.1)', () => {
    const g = gen('alpha');
    const day = 5;
    const material = builtMaterial(g, day);
    const pool = newspaperPool(material);
    const prng = createPrng(dailyStreamSeed('alpha', day));
    const composed = composeNewspaper(
      NEWSPAPER_TEMPLATE,
      material,
      { ...ctxOf(g), date: { day, phase: 0 } },
      prng,
    );

    // The asserted set equals the union of the selected articles' prop ids,
    // de-duplicated — recomputed from an identical selection draw.
    const selected = selectArticles(pool, createPrng(dailyStreamSeed('alpha', day)));
    const expected: PropId[] = [];
    const seen = new Set<PropId>();
    for (const item of selected) {
      for (const p of item.asserts) {
        if (!seen.has(p.id)) {
          seen.add(p.id);
          expected.push(p.id);
        }
      }
    }
    expect(composed.document.asserts).toEqual(expected);
    expect(composed.propositions.map((p) => p.id)).toEqual(expected);

    // The edition can assert BOTH a true trace and a false rumour: over a few
    // days at least one edition prints a rumour prop (a `prop:rumour/…` id).
    let sawRumourProp = false;
    let sawTrueProp = false;
    for (let d = 0; d < 12; d += 1) {
      const m = builtMaterial(g, d);
      const c = composeNewspaper(
        NEWSPAPER_TEMPLATE,
        m,
        { ...ctxOf(g), date: { day: d, phase: 0 } },
        createPrng(dailyStreamSeed('alpha', d)),
      );
      if (c.document.asserts.some((id) => id.startsWith('prop:rumour/'))) {
        sawRumourProp = true;
      }
      if (c.document.asserts.some((id) => id.startsWith('prop:plot/') || id.startsWith('prop:thread/'))) {
        sawTrueProp = true;
      }
    }
    expect(sawRumourProp).toBe(true);
    expect(sawTrueProp).toBe(true);
  });

  it('is deterministic: same daily seed + material compose an identical Document', () => {
    const g = gen('bravo');
    const day = 4;
    const a = composeNewspaper(
      NEWSPAPER_TEMPLATE,
      builtMaterial(g, day),
      { ...ctxOf(g), date: { day, phase: 0 } },
      createPrng(dailyStreamSeed('bravo', day)),
    );
    const g2 = gen('bravo');
    const b = composeNewspaper(
      NEWSPAPER_TEMPLATE,
      builtMaterial(g2, day),
      { ...ctxOf(g2), date: { day, phase: 0 } },
      createPrng(dailyStreamSeed('bravo', day)),
    );
    expect(a.document).toEqual(b.document);
    expect(a.propositions).toEqual(b.propositions);
  });

  it('mints a unique, day-scoped DocId', () => {
    const g = gen('charlie');
    const a = composeNewspaper(
      NEWSPAPER_TEMPLATE,
      builtMaterial(g, 1),
      { ...ctxOf(g), date: { day: 1, phase: 0 } },
      createPrng(dailyStreamSeed('charlie', 1)),
    );
    const b = composeNewspaper(
      NEWSPAPER_TEMPLATE,
      builtMaterial(g, 2),
      { ...ctxOf(g), date: { day: 2, phase: 0 } },
      createPrng(dailyStreamSeed('charlie', 2)),
    );
    expect(a.document.id).not.toBe(b.document.id);
    expect(a.document.id).toContain('newspaper');
    expect(a.document.id).toContain('1');
    expect(b.document.id).toContain('2');
  });

  it('composes fewer than 3 articles only when the pool is thin', () => {
    const g = gen('delta');
    // A pool of a single city-event item: the thin-day floor.
    const thin: NewspaperMaterial = {
      ...EMPTY_MATERIAL,
      cityEvents: [cityWeatherItem(0, 'overcast')],
    };
    const composed = composeNewspaper(
      NEWSPAPER_TEMPLATE,
      thin,
      { ...ctxOf(g), date: START },
      createPrng(dailyStreamSeed('delta', 0)),
    );
    expect(composed.document.kind).toBe('newspaper');
    // Only one item in the pool, so at most one drawn article; the city-event
    // item asserts nothing.
    const selected = selectArticles(newspaperPool(thin), createPrng(dailyStreamSeed('delta', 0)));
    expect(selected.length).toBe(1);
    expect(composed.document.asserts).toEqual([]);
  });

  it('composes an empty edition (no articles) when the pool is empty', () => {
    const g = gen('echo-123');
    const composed = composeNewspaper(
      NEWSPAPER_TEMPLATE,
      EMPTY_MATERIAL,
      { ...ctxOf(g), date: START },
      createPrng(dailyStreamSeed('echo-123', 0)),
    );
    expect(composed.document.kind).toBe('newspaper');
    expect(composed.document.asserts).toEqual([]);
    // The template body still renders (the around-the-city filler section).
    expect(composed.document.body.length).toBeGreaterThan(0);
  });

  it('renders against each newspaper template kind without throwing', () => {
    const g = gen('alpha');
    for (const template of [NEWSPAPER_TEMPLATE, BLOTTER_TEMPLATE, NOTICES_TEMPLATE]) {
      const composed = composeNewspaper(
        template,
        builtMaterial(g, 7),
        { ...ctxOf(g), date: { day: 7, phase: 0 } },
        createPrng(dailyStreamSeed('alpha', 7)),
      );
      expect(composed.document.kind).toBe('newspaper');
      expect(composed.document.body.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// selectArticles — the daily draw (property)
// ---------------------------------------------------------------------------

describe('selectArticles — deterministic 3–6 draw with a thin-day floor', () => {
  it('draws min(target, poolSize) distinct items, within [3,6] when well-stocked', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.double({ noNaN: true, noDefaultInfinity: true, min: 0, max: 1 }),
        (poolSize, r) => {
          const pool: NewspaperItem[] = Array.from({ length: poolSize }, (_, i) => ({
            id: `item/${String(i).padStart(3, '0')}`,
            source: 'city-event' as const,
            headline: `h${i}`,
            summary: `s${i}`,
            asserts: [],
          }));
          // Derive a seed from the double so runs vary deterministically.
          const seed = `sel-${Math.round(r * 1e6)}`;
          const selected = selectArticles(pool, createPrng(seed));
          // No more than the pool, and no more than MAX.
          expect(selected.length).toBeLessThanOrEqual(Math.min(poolSize, MAX_ARTICLES));
          // Distinct ids.
          expect(new Set(selected.map((s) => s.id)).size).toBe(selected.length);
          if (poolSize >= MIN_ARTICLES) {
            expect(selected.length).toBeGreaterThanOrEqual(MIN_ARTICLES);
          } else {
            expect(selected.length).toBe(poolSize);
          }
          // Determinism: same seed + pool ⇒ same selection.
          const again = selectArticles(pool, createPrng(seed));
          expect(again.map((s) => s.id)).toEqual(selected.map((s) => s.id));
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// The newspaper day-boundary hook
// ---------------------------------------------------------------------------

describe('newspaperDayBoundaryHook — emits a newspaper SimEvent and threads the edition out', () => {
  it('emits a player-visible newspaper event naming the composed Document', () => {
    const g = gen('alpha');
    const cell = newspaperCell();
    const hook = newspaperDayBoundaryHook(
      cell,
      NEWSPAPER_TEMPLATE,
      ctxOf(g),
      (day) => builtMaterial(g, day),
    );
    const day = 2;
    const events = hook({ time: { day, phase: 0 }, dailyStreamSeed: dailyStreamSeed('alpha', day) });
    expect(events.length).toBe(1);
    const event = events[0];
    expect(event.kind).toBe('newspaper');
    expect(event.visibility).toBe('player');
    // The edition was threaded out into the cell, and the event names it.
    const composed = cell.editions[day];
    expect(composed).toBeDefined();
    if (event.kind === 'newspaper') {
      expect(event.doc).toBe(composed.document.id);
    }
  });

  it('is deterministic: the same daily stream composes the same edition', () => {
    const g = gen('bravo');
    const run = () => {
      const cell = newspaperCell();
      const hook = newspaperDayBoundaryHook(
        cell,
        NEWSPAPER_TEMPLATE,
        ctxOf(gen('bravo')),
        (day) => builtMaterial(g, day),
      );
      hook({ time: { day: 3, phase: 0 }, dailyStreamSeed: dailyStreamSeed('bravo', 3) });
      return cell.editions[3];
    };
    expect(run().document).toEqual(run().document);
  });
});

// ---------------------------------------------------------------------------
// composeSeizedDocument — captured material (Req 30.1)
// ---------------------------------------------------------------------------

describe('composeSeizedDocument — captured material asserts its source props (Req 30.1)', () => {
  it('is a seized-kind Document asserting the material propositions', () => {
    const g = gen('alpha');
    const props: Proposition[] = [trueProp('prop:seized/1', g), trueProp('prop:seized/2', g)];
    const composed = composeSeizedDocument(
      SEIZED_TEMPLATE,
      {
        tag: 'courier-papers',
        place: Object.values(g.city.locations)[0].name,
        recoveredBy: 'the station',
        description: "a courier's folded papers",
        contents: 'a list of times and a torn map reference',
        subject: 'a meeting to come',
      },
      { ...ctxOf(g), date: { day: 4, phase: 1 }, asserts: props },
    );
    expect(composed.document.kind).toBe('seized');
    expect(composed.document.asserts).toEqual(props.map((p) => p.id));
    expect(composed.propositions).toEqual(props);
    // Seized material is held, not obtained at a Location.
    expect(composed.document.obtainableAt).toBeUndefined();
    expect(composed.document.body.length).toBeGreaterThan(0);
    expect(composed.document.id).toContain('seized');
  });

  it('asserts nothing when the material carries no propositions', () => {
    const g = gen('bravo');
    const composed = composeSeizedDocument(
      SEIZED_TEMPLATE,
      {
        tag: 'blank-notebook',
        place: 'a safe house',
        recoveredBy: 'a staffer',
        description: 'a notebook, mostly blank',
        contents: 'a few idle sketches',
      },
      { ...ctxOf(g), date: { day: 1, phase: 0 }, asserts: [] },
    );
    expect(composed.document.asserts).toEqual([]);
    expect(composed.propositions).toEqual([]);
  });

  it('is deterministic for the same fields and material', () => {
    const g = gen('charlie');
    const props = [trueProp('prop:seized/x', g)];
    const fields = {
      tag: 'notebook',
      place: 'the drop',
      recoveredBy: 'the station',
      description: 'a notebook',
      contents: 'figures',
    };
    const a = composeSeizedDocument(SEIZED_TEMPLATE, fields, {
      ...ctxOf(g),
      date: { day: 2, phase: 2 },
      asserts: props,
    });
    const g2 = gen('charlie');
    const b = composeSeizedDocument(SEIZED_TEMPLATE, fields, {
      ...ctxOf(g2),
      date: { day: 2, phase: 2 },
      asserts: [trueProp('prop:seized/x', g2)],
    });
    expect(a.document).toEqual(b.document);
  });
});
