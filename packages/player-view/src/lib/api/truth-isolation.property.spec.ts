/**
 * Property 3: Truth isolation (design, "Correctness Properties"; task 16.5).
 *
 * **Validates: Requirements 2.1, 2.2, 7.3.**
 *
 * > For any reachable state, the serialized Player View and Case File contain
 * > no truth-branded fields, true allegiances, MICE values, cipher specs, or
 * > Propositions from any NPC's `agenda.conceal` that the player has not
 * > observed. (design, Property 3)
 *
 * The engine stores ground truth only in the Truth Store and the `Truth`-branded
 * NPC fields, which never cross into the Player View (Req 2.1); the UI reads only
 * the Player View and Case File, which hold no truth values, true allegiances,
 * MICE profiles or concealed Propositions (Req 2.2); and a Claim lands in the
 * Case File *without* its recorded truth value, speaker belief or lie flag
 * (Req 7.3).
 *
 * This property sweeps real generated worlds — across many seeds and all three
 * Difficulty Presets, with the mole enabled so a cover-derived
 * `apparentAllegiance` and a hidden REPORTS_TO truth are both in play — and
 * drives every player-facing projection the facade exposes:
 *
 * - `sceneView` and `hereView` at a Location that has unidentified NPCs,
 * - `documentListView` and `documentView` over the generated Documents,
 * - `mapView` and `peopleView`, and
 * - `listClaims` over a Case File seeded from the generated worlds's own
 *   extraction-shaped Propositions.
 *
 * It serializes the lot and asserts the output carries **no** truth-branded
 * value: no true allegiance org, no MICE lever number, no money need, no
 * reliability, no `apparentAllegiance` category sourced from the NPC record, no
 * suspicion scalar, and no truth/belief/lie field name. It also asserts the
 * dual-direction rule for unidentified NPCs: they appear by physical descriptor
 * only, never by persona name.
 *
 * These complement the example-based truth-safety unit tests in `views.spec.ts`
 * and `map-people-views.spec.ts`; the property drives the same seams across the
 * input space rather than at one hand-picked world.
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import fc from 'fast-check';
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
  generateGame,
  revealTruth,
  visibleNpcsAt,
  ScenarioConfigSchema,
  type DocId,
  type GenerateInputs,
  type LocId,
  type NpcId,
  type Phase,
  type WorldState,
} from '@tradecraft/engine';

import { CaseFile } from '../casefile/casefile.js';
import {
  documentListView,
  documentView,
  hereView,
  listClaims,
  mapView,
  peopleView,
  sceneView,
} from './views.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors views.spec.ts / map-people-views.spec.ts)
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

/** The three shipped presets, by local id. */
const PRESET_IDS = ['easy', 'standard', 'hard'] as const;

/** A varied, non-empty seed set to sweep the generator over. */
const SEEDS = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo-123',
  'z',
  'q1',
  'w2',
  'seed-99',
  'fox-trot',
];

/** A minimal valid scenario config, with the mole enabled. */
function scenario(presetId: string, ambient = false) {
  return ScenarioConfigSchema.parse({
    difficulty: { preset: presetId },
    mole: true,
    ...(ambient ? { ambient: { enabled: true, density: 'sparse' as const } } : {}),
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
}

function inputs(presetId: string, ambient = false): GenerateInputs {
  return {
    content,
    preset: preset(presetId),
    scenario: scenario(presetId, ambient),
    cityData,
    descriptors,
    publicTexts,
  };
}

// ---------------------------------------------------------------------------
// Helpers for driving the player-facing seams
// ---------------------------------------------------------------------------

/** Put the player at a Location (a shallow, typed override). */
function atLocation(state: WorldState, loc: LocId): WorldState {
  return { ...state, player: { ...state.player, loc } };
}

/**
 * Find a Location, at some phase, that has at least one NPC scheduled there and
 * where none of them is in the player's known set — so the scene labels them as
 * unidentified subjects. Returns the state (clock set to that phase, player
 * moved to the Location), the Location and its visible, unidentified NPCs.
 */
function findSceneWithUnknowns(
  state: WorldState,
): { state: WorldState; loc: LocId; npcs: readonly NpcId[] } | undefined {
  const known = new Set<string>(state.player.known.entities);
  for (let phase = 0 as Phase; phase <= 3; phase = (phase + 1) as Phase) {
    const at = { ...state, time: { ...state.time, phase } };
    for (const loc of Object.keys(state.city.locations) as LocId[]) {
      const npcs = visibleNpcsAt(at, loc).filter((npc) => !known.has(npc));
      if (npcs.length > 0) {
        return { state: atLocation(at, loc), loc, npcs };
      }
    }
  }
  return undefined;
}

/**
 * Seed a Case File from a world's own view-safe Propositions — the shape
 * extraction would land. We draw MEMBER_OF / KNOWS / MEETS_AT Claims from the
 * generated NPC and org ids so `listClaims` has real content to serialize, yet
 * none of the Truth-Store fields (truth value, belief, lie) can appear: the Case
 * File `Claim` shape has no slot for them (Req 7.3).
 */
function seedCaseFile(state: WorldState): CaseFile {
  const cf = new CaseFile();
  const npcIds = Object.keys(state.npcs) as NpcId[];
  if (npcIds.length === 0) {
    return cf;
  }
  const subject = npcIds[0];
  // Deliberately *no* MEMBER_OF Claim: with no affiliation Claim, the People
  // view must surface no `apparentAffiliation` at all (it may derive affiliation
  // only from a Case File Claim, never from the NPC record's cover-derived
  // `apparentAllegiance`). The KNOWS and MEETS_AT Claims give `listClaims` real
  // content without driving an affiliation.
  if (npcIds.length > 1) {
    cf.add({
      source: { kind: 'npc', npc: subject },
      prop: { id: 'c2', subject, predicate: 'KNOWS', object: npcIds[1] },
      observedAt: { day: 1, phase: 1 },
    });
  }
  cf.add({
    source: { kind: 'surveillance', loc: state.player.loc },
    prop: { id: 'c3', subject, predicate: 'MEETS_AT', object: state.player.loc },
    observedAt: { day: 2, phase: 2 },
  });
  return cf;
}

/**
 * Serialize every player-facing projection the facade exposes for a world, as
 * one JSON string. Drives the scene/here panels at a Location with unidentified
 * NPCs when one exists (otherwise at the player's own Location), the Documents
 * list and each reader, the Map and People views, and the Case File list.
 */
function serializeAllViews(
  state: WorldState,
): {
  json: string;
  mapJson: string;
  scene?: { loc: LocId; npcs: readonly NpcId[] };
} {
  const scene = findSceneWithUnknowns(state);
  const at = scene?.state ?? state;
  const loc = scene?.loc ?? state.player.loc;

  const cf = seedCaseFile(at);
  const docIds = Object.keys(at.documents) as DocId[];

  const map = mapView(at, cityData);
  const payload = {
    scene: sceneView(at, cityData, loc),
    here: hereView(at, cityData, loc),
    documentList: documentListView(at),
    documents: docIds.map((id) => documentView(at, id)),
    map,
    people: peopleView(at, cf),
    claims: listClaims(cf),
  };

  return {
    json: JSON.stringify(payload),
    mapJson: JSON.stringify(map),
    scene: scene === undefined ? undefined : { loc: scene.loc, npcs: scene.npcs },
  };
}

/**
 * The forbidden Truth-Store field names: a serialized Player View or Case File
 * must never carry a *key* that names one of these (Req 2.2, 7.3). We match the
 * JSON key form `"<name>":` rather than a bare substring, so free-text in a
 * Document body (which legitimately contains English words like "held") cannot
 * trip the oracle; only a serialized object key can. `apparentAllegiance` is the
 * NPC-record cover field — distinct from the People view's own view-safe
 * `apparentAffiliation` key, which is sourced only from Case File Claims.
 */
const FORBIDDEN_FIELD_NAMES = [
  'trueAllegiance',
  'apparentAllegiance',
  'mice',
  'moneyNeed',
  'reliability',
  'tradecraft',
  'securityConsciousness',
  'suspicion',
  'conceal',
  'held',
  'believed',
  'lie',
] as const;

// ---------------------------------------------------------------------------
// Property 3 — Truth isolation
// ---------------------------------------------------------------------------

describe('Property 3: Truth isolation (Req 2.1, 2.2, 7.3)', () => {
  const seedArb = fc.constantFrom(...SEEDS);
  const presetArb = fc.constantFrom(...PRESET_IDS);

  it('serializes no truth-branded value from any player-facing projection', () => {
    fc.assert(
      fc.property(seedArb, presetArb, fc.boolean(), (seed, presetId, ambient) => {
        const { world } = generateGame(seed, inputs(presetId, ambient));
        const { json, mapJson } = serializeAllViews(world);

        // No Truth-field name appears as a serialized key in the views.
        for (const name of FORBIDDEN_FIELD_NAMES) {
          expect(json).not.toContain(`"${name}":`);
        }

        for (const npc of Object.values(world.npcs)) {
          // No NPC's true allegiance org leaks into the Map projection. (Org
          // ids are view-safe and may legitimately appear in the People view's
          // known-orgs list and in observed MEMBER_OF Claims; the leak the Map
          // view must never make is to pair geography with a hidden allegiance,
          // so the Map — which carries only places — must contain no org id.)
          expect(mapJson).not.toContain(revealTruth(npc.trueAllegiance).org);
          // The cover-derived apparent allegiance is never surfaced from the
          // NPC record. The seeded Case File holds no affiliation Claim, so the
          // People view must emit no `apparentAffiliation` key at all — if it
          // read the NPC record it would appear here.
          expect(json).not.toContain('"apparentAffiliation":');
          // No MICE lever number leaks. Levers are full-precision doubles in
          // [0, 1]; only a distinctive (long) decimal is a reliable oracle,
          // since a short value like "0" or "1" collides with crowd counts and
          // Route costs that legitimately appear. A leaked lever would carry its
          // full precision, so the long-string guard still catches a real leak.
          const mice = revealTruth(npc.mice);
          for (const lever of [mice.money, mice.ideology, mice.coercion, mice.ego]) {
            const text = String(lever);
            if (text.length >= 6) {
              expect(json).not.toContain(text);
            }
          }
        }
      }),
      { numRuns: 40 },
    );
  });

  it('references every visible unidentified NPC by descriptor, never by name', () => {
    fc.assert(
      fc.property(seedArb, presetArb, fc.boolean(), (seed, presetId, ambient) => {
        const { world } = generateGame(seed, inputs(presetId, ambient));
        const { json, scene } = serializeAllViews(world);
        // Not every world has an unidentified NPC visible at a Location at some
        // phase; when one does, assert the dual-direction rule.
        fc.pre(scene !== undefined);
        if (scene === undefined) return;

        for (const npc of scene.npcs) {
          const record = world.npcs[npc];
          // The persona name of an unidentified NPC must not appear anywhere.
          expect(json).not.toContain(record.persona.name);
          // The physical descriptor summary is what the panels show instead.
          expect(json).toContain(record.descriptor.summary);
        }
      }),
      { numRuns: 40 },
    );
  });

  it('lands Case File Claims with no truth value, belief or lie field (Req 7.3)', () => {
    fc.assert(
      fc.property(seedArb, presetArb, fc.boolean(), (seed, presetId, ambient) => {
        const { world } = generateGame(seed, inputs(presetId, ambient));
        const scene = findSceneWithUnknowns(world);
        const at = scene?.state ?? world;
        const cf = seedCaseFile(at);
        const claims = listClaims(cf);
        expect(claims.length).toBeGreaterThan(0);

        for (const claim of claims) {
          const keys = Object.keys(claim);
          // The Case File Claim slice carries only view-safe fields: it has no
          // slot for the Truth-Store's truth value, speaker belief or lie flag.
          expect(keys).not.toContain('held');
          expect(keys).not.toContain('believed');
          expect(keys).not.toContain('lie');
          expect(keys).not.toContain('truth');
          // The documented view-safe Claim shape. `grade` is optional and
          // absent until the player grades the Claim, so an ungraded Claim
          // carries exactly these keys.
          expect(keys.sort()).toEqual(
            ['hedged', 'id', 'links', 'observedAt', 'prop', 'relation', 'source'].sort(),
          );
        }
      }),
      { numRuns: 40 },
    );
  });
});
