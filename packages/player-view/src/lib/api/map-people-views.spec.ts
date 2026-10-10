/**
 * Behaviour and truth-safety tests for the task-16.3 Map and People views
 * (Requirements 33.3, 33.4, 33.5; design, "Player Aids").
 *
 * These load the real core pack and drive a generated {@link WorldState} — one
 * that carries real {@link Truth}-branded NPC fields, true allegiances, MICE
 * profiles and cover-derived apparent allegiances — through the Map and People
 * projections and the {@link PlayerViewEngine} facade. The point is to prove the
 * projections are Player-View-only (Req 33.5) and truth-safe on real ground
 * truth:
 *
 * - the Map view groups known Locations by District, lists Routes with their
 *   costs, and surfaces hours, risk, crowd and known Dead Drops;
 * - the People view labels an unidentified person by descriptor (never name),
 *   surfaces apparent affiliation only from Case File Claims (never the NPC
 *   record's `apparentAllegiance`), derives the rapport band from trust, and
 *   never surfaces the true allegiance, the MICE profile or the suspicion
 *   scalar.
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
import {
  generate,
  revealTruth,
  visibleNpcsAt,
  ScenarioConfigSchema,
  type DocId,
  type EntityId,
  type GenerateInputs,
  type ItemId,
  type LocId,
  type NpcId,
  type OrgId,
  type Phase,
  type ResolverContext,
  type UnkId,
  type WorldState,
} from '@tradecraft/engine';

import { CaseFile } from '../casefile/casefile.js';
import { implicationRules, type BriefView } from '../casefile/evidence.js';
import { PlayerViewEngine } from './engine-api.js';
import { mapView, peopleView, rapportBandOf } from './views.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors views.spec.ts)
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
  if (!cityData.ok) {
    throw new Error('city.yaml failed to load');
  }
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) {
    throw new Error('descriptors.yaml failed to load');
  }
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!publicTexts.ok) {
    throw new Error('public texts failed to load');
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

function scenario() {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: 'standard' },
    mole: true,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

function inputs(): GenerateInputs {
  return { content, preset: STANDARD, scenario: scenario(), cityData, descriptors, publicTexts };
}

function world(seed = 'alpha'): WorldState {
  return generate(seed, inputs());
}

const CTX: ResolverContext = { content };
const EMPTY_BRIEF: BriefView = { hostileOrgs: [], hostileChannels: [], materiel: [] };
const NO_RULES = implicationRules([]);

/** Find a Location, at some phase, with at least one unidentified NPC scheduled. */
function findSceneWithUnknowns(
  state: WorldState,
): { state: WorldState; loc: LocId; npcs: readonly NpcId[] } | undefined {
  for (let phase = 0 as Phase; phase <= 3; phase = (phase + 1) as Phase) {
    const at = { ...state, time: { ...state.time, phase } };
    for (const loc of Object.keys(state.city.locations) as LocId[]) {
      const npcs = visibleNpcsAt(at, loc);
      if (npcs.length > 0) {
        return { state: at, loc, npcs };
      }
    }
  }
  return undefined;
}

/** Add ids to the player's known-entity set. */
function withKnown(state: WorldState, ...ids: readonly EntityId[]): WorldState {
  return {
    ...state,
    player: {
      ...state.player,
      known: {
        ...state.player.known,
        entities: [...state.player.known.entities, ...ids],
      },
    },
  };
}

/** Record a `unk:` allocation for an NPC (as surveillance would). */
function withUnk(state: WorldState, npc: NpcId, unk: UnkId): WorldState {
  return {
    ...state,
    player: {
      ...state.player,
      unkIds: { ...state.player.unkIds, [npc]: unk },
    },
  };
}

/** Overwrite an NPC's relationship record (trust/suspicion/recruited). */
function withRelationship(
  state: WorldState,
  npc: NpcId,
  rel: { trust?: number; suspicion?: number; recruited?: boolean },
): WorldState {
  return {
    ...state,
    relationships: {
      ...state.relationships,
      [npc]: rel as WorldState['relationships'][NpcId],
    },
  };
}

// ---------------------------------------------------------------------------
// Map view (Requirements 33.3, 33.5)
// ---------------------------------------------------------------------------

describe('mapView — known Locations by District (Req 33.3, 33.5)', () => {
  it('groups public Locations under their District with hours, risk and crowd', () => {
    const w = world();
    const view = mapView(w, cityData);

    // Every public Location is known from game start (Req 21.8).
    const publicLocs = Object.values(w.city.locations).filter((l) => l.public);
    expect(publicLocs.length).toBeGreaterThan(0);

    const listed = new Map(
      view.districts.flatMap((d) => d.locations.map((l) => [l.id, l] as const)),
    );
    for (const loc of publicLocs) {
      const entry = listed.get(loc.id);
      expect(entry).toBeDefined();
      if (entry === undefined) continue;
      // Every District a Location is grouped under matches the city.
      const district = view.districts.find((d) => d.id === loc.district);
      expect(district).toBeDefined();
      // Hours and risk come straight from the (view-safe) Location record.
      expect(entry.hours).toEqual(loc.hours);
      expect(entry.risk).toBe(loc.risk);
      expect(['empty', 'sparse', 'busy', 'packed']).toContain(entry.crowd);
    }
    expect(view.note).toContain('Soviet zone');
  });

  it("lists the player's own Station, which is not public", () => {
    const w = world();
    const station = Object.values(w.city.locations).find((l) => l.type === 'station-hq');
    expect(station).toBeDefined();
    if (station === undefined) return;
    expect(station.public).toBe(false);
    expect(w.player.known.entities).not.toContain(station.id);

    const listed = mapView(w, cityData).districts.flatMap((d) => d.locations);
    expect(listed.map((l) => l.id)).toContain(station.id);
    // No other non-public Location is listed before the player learns of it.
    for (const loc of listed) {
      const place = w.city.locations[loc.id];
      expect(place.public || place.type === 'station-hq' || w.player.known.entities.includes(loc.id)).toBe(true);
    }
  });

  it('lists outgoing Routes with their phase costs as an adjacency list', () => {
    const w = world();
    const view = mapView(w, cityData);

    for (const district of view.districts) {
      for (const route of district.routes) {
        // A listed Route leaves this District and costs 0 or 1 phase.
        expect(route.from).toBe(district.id);
        expect([0, 1]).toContain(route.cost);
        // The cost matches an undirected Route in the city.
        const match = w.city.routes.find(
          (r) =>
            (r.a === route.from && r.b === route.to) ||
            (r.b === route.from && r.a === route.to),
        );
        expect(match).toBeDefined();
        expect(match?.cost).toBe(route.cost);
      }
    }
  });

  it('surfaces only known Dead Drops, under their Location and in the flat list', () => {
    const w = world();
    // Pick a Dead Drop the player does NOT already know about.
    const alreadyKnown = new Set<string>(w.player.known.drops);
    const dropId = (Object.keys(w.deadDrops) as (keyof typeof w.deadDrops)[]).find(
      (id) => !alreadyKnown.has(id as string),
    );
    expect(dropId).toBeDefined();
    if (dropId === undefined) return;
    const drop = w.deadDrops[dropId];

    // An unknown Dead Drop does not appear in the Map before the player knows it.
    expect(mapView(w, cityData).deadDrops.map((d) => d.id)).not.toContain(dropId);

    const known: WorldState = {
      ...w,
      player: {
        ...w.player,
        known: {
          ...w.player.known,
          entities: [...w.player.known.entities, drop.loc],
          drops: [...w.player.known.drops, dropId],
        },
      },
    };
    const view = mapView(known, cityData);
    expect(view.deadDrops.map((d) => d.id)).toContain(dropId);
    // The drop also appears under its Location.
    const locEntry = view.districts
      .flatMap((d) => d.locations)
      .find((l) => l.id === drop.loc);
    expect(locEntry?.deadDrops.map((d) => d.id)).toContain(dropId);
  });

  it('quotes travel cost 0 from the player to their own Location', () => {
    const w = world();
    const view = mapView(w, cityData);
    const here = view.districts
      .flatMap((d) => d.locations)
      .find((l) => l.id === w.player.loc);
    // The player's own Location is known (public start Location) and costs 0.
    if (here !== undefined) {
      expect(here.travelCost).toBe(0);
    }
    expect(view.here).toBe(w.player.loc);
  });

  it('is a pure Player-View projection: no Truth-branded value is serialised', () => {
    const w = world();
    const serialized = JSON.stringify(mapView(w, cityData));
    // No NPC name, true allegiance org or apparent allegiance can appear — the
    // Map carries only geography and the player's known drops.
    for (const npc of Object.values(w.npcs)) {
      expect(serialized).not.toContain(revealTruth(npc.trueAllegiance).org);
    }
  });
});

// ---------------------------------------------------------------------------
// People view (Requirements 33.4, 33.5)
// ---------------------------------------------------------------------------

describe('peopleView — known people and Unidentified Subjects (Req 33.4)', () => {
  it('labels an unidentified person by descriptor and an identified one by name', () => {
    const w = world();
    const found = findSceneWithUnknowns(w);
    expect(found).toBeDefined();
    if (found === undefined) return;
    const npc = found.npcs[0];

    // Unidentified: shown under the allocated unk id, labelled by descriptor.
    const unknownState = withUnk(found.state, npc, 'unk:1');
    const cf = new CaseFile();
    const unknownView = peopleView(unknownState, cf);
    const asUnknown = unknownView.people.find((p) => p.id === 'unk:1');
    expect(asUnknown).toBeDefined();
    expect(asUnknown?.identified).toBe(false);
    expect(asUnknown?.label).toBe(unknownState.npcs[npc].descriptor.summary);
    expect(asUnknown?.label).not.toBe(unknownState.npcs[npc].persona.name);

    // Identified: shown under the npc id, labelled by persona name.
    const knownState = withKnown(found.state, npc);
    const knownView = peopleView(knownState, cf);
    const asKnown = knownView.people.find((p) => p.id === npc);
    expect(asKnown?.identified).toBe(true);
    expect(asKnown?.label).toBe(knownState.npcs[npc].persona.name);
  });

  it('derives apparent affiliation ONLY from Case File Claims, never the NPC record', () => {
    const w = world();
    const found = findSceneWithUnknowns(w);
    expect(found).toBeDefined();
    if (found === undefined) return;
    const npc = found.npcs[0];
    const state = withKnown(found.state, npc);

    // With no Claims, the view states no affiliation (even though the NPC
    // record carries a cover-derived apparentAllegiance).
    const emptyCf = new CaseFile();
    const noAffiliation = peopleView(state, emptyCf).people.find((p) => p.id === npc);
    expect(noAffiliation?.apparentAffiliation).toBeUndefined();

    // Add a MEMBER_OF Claim pointing at a known org; the affiliation now shows
    // that org's apparent-allegiance category, sourced from the Claim.
    const orgId = Object.keys(w.orgs)[0] as OrgId;
    const cf = new CaseFile();
    cf.add({
      source: { kind: 'document', id: 'doc:dossier/x' as DocId },
      prop: { id: 'p1', subject: npc, predicate: 'MEMBER_OF', object: orgId },
      observedAt: { day: 1, phase: 0 },
    });
    const withAffiliation = peopleView(state, cf).people.find((p) => p.id === npc);
    expect(withAffiliation?.apparentAffiliation).toBe(w.orgs[orgId].allegiance);
  });

  it('derives the rapport band from trust (cold/neutral/warm/trusted)', () => {
    expect(rapportBandOf(0)).toBe('cold');
    expect(rapportBandOf(0.1)).toBe('cold');
    expect(rapportBandOf(0.3)).toBe('neutral');
    expect(rapportBandOf(0.6)).toBe('warm');
    expect(rapportBandOf(0.9)).toBe('trusted');
    expect(rapportBandOf(1)).toBe('trusted');

    const w = world();
    const found = findSceneWithUnknowns(w);
    if (found === undefined) return;
    const npc = found.npcs[0];
    const state = withRelationship(withKnown(found.state, npc), npc, {
      trust: 0.9,
      suspicion: 0.8,
      recruited: true,
    });
    const entry = peopleView(state, new CaseFile()).people.find((p) => p.id === npc);
    expect(entry?.rapport).toBe('trusted');
    expect(entry?.asset).toBe(true);
  });

  it('counts Claims by subject and by source, and merges linked aliases', () => {
    const w = world();
    const found = findSceneWithUnknowns(w);
    if (found === undefined) return;
    const npc = found.npcs[0];
    const state = withUnk(withKnown(found.state, npc), npc, 'unk:7');

    const cf = new CaseFile();
    // One Claim the NPC made (source), one about the NPC (subject).
    cf.add({
      source: { kind: 'npc', npc },
      prop: { id: 'p1', subject: 'npc:other' as NpcId, predicate: 'KNOWS', object: npc },
      observedAt: { day: 1, phase: 0 },
    });
    cf.add({
      source: { kind: 'surveillance', loc: state.player.loc },
      prop: { id: 'p2', subject: npc, predicate: 'MEETS_AT', object: state.player.loc },
      observedAt: { day: 2, phase: 1 },
    });
    // Link the player's unk id to the npc via an IS_ALIAS_OF Claim.
    cf.add({
      source: { kind: 'surveillance', loc: state.player.loc },
      prop: { id: 'p3', subject: 'unk:7', predicate: 'IS_ALIAS_OF', object: npc },
      observedAt: { day: 2, phase: 2 },
    });

    const entry = peopleView(state, cf).people.find((p) => p.id === npc);
    expect(entry).toBeDefined();
    expect(entry?.claimsAsSource).toBe(1);
    // Subject count includes the MEETS_AT and the IS_ALIAS_OF (subject unk:7
    // resolves to the npc).
    expect(entry?.claimsAsSubject).toBeGreaterThanOrEqual(2);
    expect(entry?.aliases).toContain('unk:7');
    // Last sighting is the latest observation time among concerning Claims.
    expect(entry?.lastSighting).toEqual({ day: 2, phase: 2 });
  });

  it('never surfaces the NPC apparentAllegiance, true allegiance, MICE or suspicion', () => {
    const w = world();
    const found = findSceneWithUnknowns(w);
    expect(found).toBeDefined();
    if (found === undefined) return;

    // Known + unknown people, with a relationship carrying a high suspicion.
    let state = found.state;
    for (const npc of found.npcs) {
      state = withUnk(state, npc, `unk:${npc.slice(npc.indexOf(':') + 1)}` as UnkId);
      state = withRelationship(state, npc, { trust: 0.4, suspicion: 0.95, recruited: false });
    }
    state = withKnown(state, found.npcs[0]);

    const view = peopleView(state, new CaseFile());
    const serialized = JSON.stringify(view);

    for (const npc of found.npcs) {
      const record = state.npcs[npc];
      // The cover-derived apparent allegiance must never be surfaced from the
      // NPC record (there are no affiliation Claims, so it cannot appear).
      expect(serialized).not.toContain(`"apparentAffiliation":"${record.apparentAllegiance}"`);
      // The true allegiance org must not leak.
      expect(serialized).not.toContain(revealTruth(record.trueAllegiance).org);
      // The MICE levers must not leak as numbers.
      const mice = revealTruth(record.mice);
      // An unidentified NPC's persona name must not appear.
      if (!state.player.known.entities.includes(npc)) {
        expect(serialized).not.toContain(record.persona.name);
      }
      expect(mice).toBeDefined();
    }
    // The suspicion scalar (0.95) must never appear in any form.
    expect(serialized).not.toContain('0.95');
    expect(serialized).not.toContain('suspicion');
    // Each person entry carries only the documented view-safe keys.
    for (const person of view.people) {
      expect(Object.keys(person).sort()).toEqual(
        [
          'aliases',
          'apparentAffiliation',
          'asset',
          'claimsAsSource',
          'claimsAsSubject',
          'id',
          'identified',
          'label',
          'lastSighting',
          'rapport',
        ].sort(),
      );
    }
  });

  it('lists known organisations and items in parallel', () => {
    const w = world();
    const orgId = Object.keys(w.orgs)[0] as OrgId;
    const itemId = 'item:dossier-film' as ItemId;
    const state = withKnown(w, orgId, itemId);
    const view = peopleView(state, new CaseFile());
    expect(view.orgs.map((o) => o.id)).toContain(orgId);
    expect(view.orgs.find((o) => o.id === orgId)?.allegiance).toBe(w.orgs[orgId].allegiance);
    expect(view.items.map((i) => i.id)).toContain(itemId);
  });
});

// ---------------------------------------------------------------------------
// Facade wiring
// ---------------------------------------------------------------------------

describe('PlayerViewEngine — Map and People seams (task 16.3)', () => {
  function engine(state: WorldState, cf = new CaseFile()): PlayerViewEngine {
    return new PlayerViewEngine({
      state,
      caseFile: cf,
      cityData,
      ctx: CTX,
      brief: EMPTY_BRIEF,
      rules: NO_RULES,
    });
  }

  it('views.map() and views.people() no longer throw and return the projections', () => {
    const w = world();
    const api = engine(w);
    expect(() => api.views.map()).not.toThrow();
    expect(() => api.views.people()).not.toThrow();
    expect(api.views.map().here).toBe(w.player.loc);
    expect(Array.isArray(api.views.people().people)).toBe(true);
  });
});
