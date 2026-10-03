/**
 * Tests for the read action (task 9.2; Requirements 30.3, 30.4; Property 22).
 *
 * These drive a generated {@link WorldState} from the real core pack through
 * {@link quoteRead}/{@link resolveRead} and the top-level {@link quote}/
 * {@link resolve}, checking:
 *
 * - a Document held in hand (no `obtainableAt` — the brief Cable, a Dossier) is
 *   readable anywhere; a Document obtainable only at Locations (a public text)
 *   is not readable where the player is not (Requirement 30.3);
 * - a non-existent Document is not allowed;
 * - the first read reports the Document's asserted Propositions as
 *   `claimsAdded` and `proposition` Observations, and marks the Document read
 *   (Requirement 30.3);
 * - a second read reports no new `claimsAdded` and leaves `readDocuments`
 *   unchanged (Requirement 30.4, Property 22, idempotence);
 * - determinism: the same inputs give the same next state and result.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  loadCityData,
  loadContent,
  loadDescriptorData,
  loadPublicTexts,
  type CityData,
  type ContentSet,
  type DescriptorData,
  type DifficultyPreset,
  type PublicText,
} from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import type { DocId, LocId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import type { Document } from '../docs/document.js';
import { quote, resolve } from './action.js';
import { quoteRead, resolveRead, hasReadDocument, READ_PHASE_COST } from './read.js';
import type { ReadAction } from './types.js';
import type { ResolverContext } from './result.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors travel.spec.ts)
// ---------------------------------------------------------------------------

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
    throw new Error('core pack failed to load');
  }
  const cityData = loadCityData(CORE_DIR);
  const descriptors = loadDescriptorData(CORE_DIR);
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!cityData.ok || !descriptors.ok || !publicTexts.ok) {
    throw new Error('core pack side files failed to load');
  }
  return {
    content: content.value,
    cityData: cityData.value,
    descriptors: descriptors.value,
    publicTexts: publicTexts.value,
  };
}

const { content, cityData, descriptors, publicTexts } = loadCore();

function preset(id: string): DifficultyPreset {
  for (const [key, value] of content.difficultyPresets) {
    if (key === id || key.endsWith(`/${id}`)) {
      return value;
    }
  }
  throw new Error(`no difficulty preset ${id}`);
}

const STANDARD = preset('standard');

function inputs(): GenerateInputs {
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: false,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
  return { content, preset: STANDARD, scenario, cityData, descriptors, publicTexts };
}

const CTX: ResolverContext = { content };

function world(seed = 'read-alpha'): WorldState {
  return generate(seed, inputs());
}

/** Every Location open in the current phase, so the gate never interferes. */
function allOpen(state: WorldState): WorldState {
  const locations = Object.fromEntries(
    Object.entries(state.city.locations).map(([id, loc]) => [
      id,
      { ...loc, hours: { 0: true, 1: true, 2: true, 3: true } },
    ]),
  );
  return { ...state, city: { ...state.city, locations } };
}

/** The Documents in the world, as an array. */
function docs(state: WorldState): Document[] {
  return Object.values(state.documents);
}

/**
 * A Document held in hand (no `obtainableAt`) that asserts at least one
 * Proposition — the brief Cable or a Dossier. The core brief always carries a
 * Cable with leads, so this is present; it throws rather than returning
 * undefined to keep the tests free of non-null assertions.
 */
function inHandDocWithClaims(state: WorldState): Document {
  const doc = docs(state).find(
    (d) =>
      (d.obtainableAt === undefined || d.obtainableAt.length === 0) &&
      d.asserts.length > 0,
  );
  if (doc === undefined) {
    throw new Error('no in-hand Document with asserted Propositions in the brief');
  }
  return doc;
}

/** A Document obtainable only at Locations (a public text), if any. */
function obtainableDoc(state: WorldState): Document {
  const doc = docs(state).find(
    (d) => d.obtainableAt !== undefined && d.obtainableAt.length > 0,
  );
  if (doc === undefined) {
    throw new Error('no obtainable-at-Location Document in the generated world');
  }
  return doc;
}

// ---------------------------------------------------------------------------
// quoteRead — obtainable Locations (Req 30.3)
// ---------------------------------------------------------------------------

describe('quoteRead — obtainable Locations (Req 30.3)', () => {
  it('allows reading an in-hand Document (no obtainableAt) anywhere, at 1 phase', () => {
    const state = world();
    const doc = inHandDocWithClaims(state);
    const q = quoteRead(state, { kind: 'read', doc: doc.id });
    expect(q.allowed).toBe(true);
    expect(q.phases).toBe(READ_PHASE_COST);
    expect(q.money).toBe(0);
  });

  it('disallows reading a Document where it is not obtainable', () => {
    const state = world();
    const doc = obtainableDoc(state);
    // Put the player at a Location that is NOT in the Document's obtainableAt.
    const elsewhere = (Object.keys(state.city.locations) as LocId[]).find(
      (id) => !(doc.obtainableAt ?? []).includes(id),
    );
    expect(elsewhere).toBeDefined();
    const away: WorldState = {
      ...state,
      player: { ...state.player, loc: elsewhere as LocId },
    };
    const q = quoteRead(away, { kind: 'read', doc: doc.id });
    expect(q.allowed).toBe(false);
    expect(q.reason).toContain(doc.obtainableAt?.[0] as string);
  });

  it('allows reading an obtainable Document when the player is where it is obtainable', () => {
    const state = world();
    const doc = obtainableDoc(state);
    const at = (doc.obtainableAt ?? [])[0];
    const there: WorldState = { ...state, player: { ...state.player, loc: at } };
    expect(quoteRead(there, { kind: 'read', doc: doc.id }).allowed).toBe(true);
  });

  it('disallows reading a non-existent Document', () => {
    const state = world();
    const q = quoteRead(state, { kind: 'read', doc: 'doc:nope/x' as DocId });
    expect(q.allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// resolveRead — first read seeds Claims (Req 30.3)
// ---------------------------------------------------------------------------

describe('resolveRead — first read (Req 30.3)', () => {
  it('reports the Document asserted Propositions as claimsAdded + proposition Observations and marks it read', () => {
    const state = allOpen(world());
    const doc = inHandDocWithClaims(state);
    const action: ReadAction = { kind: 'read', doc: doc.id };

    const { next, result } = resolve(state, action, createPrng('r'), CTX);

    // Every stored Proposition the Document asserts is reported.
    const expected = doc.asserts.filter((id) => state.documentPropositions[id] !== undefined);
    expect(result.claimsAdded).toEqual(expected);
    expect(result.claimsAdded.length).toBeGreaterThan(0);

    // The Observations are propositions stamped at the current time, each
    // sourced to the Document read (the source its Case File Claim is filed under).
    const propObs = result.observations.filter((o) => o.kind === 'proposition');
    expect(propObs).toHaveLength(expected.length);
    for (const obs of propObs) {
      if (obs.kind === 'proposition') {
        expect(obs.at).toEqual(state.time);
        expect(obs.source).toEqual({ kind: 'document', id: doc.id });
      }
    }
    // Fact Lines were rendered for the Observations.
    expect(result.factLines).toHaveLength(result.observations.length);

    // The Document is now marked read.
    expect(hasReadDocument(next, doc.id)).toBe(true);
    expect(next.player.readDocuments).toContain(doc.id);
  });
});

// ---------------------------------------------------------------------------
// resolveRead — idempotence (Req 30.4, Property 22)
// ---------------------------------------------------------------------------

describe('resolveRead — reading again is idempotent (Req 30.4, Property 22)', () => {
  it('a second read reports no new claimsAdded and leaves readDocuments unchanged', () => {
    const state = allOpen(world());
    const doc = inHandDocWithClaims(state);
    const action: ReadAction = { kind: 'read', doc: doc.id };

    const first = resolve(state, action, createPrng('r'), CTX);
    expect(first.result.claimsAdded.length).toBeGreaterThan(0);

    const second = resolve(first.next, action, createPrng('r'), CTX);
    expect(second.result.claimsAdded).toEqual([]);
    // No proposition Observations on the repeat read.
    expect(second.result.observations.every((o) => o.kind === 'message')).toBe(true);
    // readDocuments carries the Document exactly once, unchanged by the re-read.
    expect(second.next.player.readDocuments).toEqual(first.next.player.readDocuments);
    expect(
      second.next.player.readDocuments.filter((id) => id === doc.id),
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('resolveRead — determinism', () => {
  it('gives the same next state and claimsAdded for the same inputs', () => {
    const state = allOpen(world('read-det'));
    const doc = inHandDocWithClaims(state);
    const action: ReadAction = { kind: 'read', doc: doc.id };

    const a = resolveRead(state, action, createPrng('x'), () => []);
    const b = resolveRead(state, action, createPrng('y'), () => []);
    expect(a.result.claimsAdded).toEqual(b.result.claimsAdded);
    expect(a.next.player.readDocuments).toEqual(b.next.player.readDocuments);
  });
});
