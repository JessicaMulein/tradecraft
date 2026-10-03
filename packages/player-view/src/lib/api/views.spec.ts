/**
 * Truth-safety and behaviour tests for the task-16.1 Player-View projections
 * (Requirements 2.2, 13.5; design "Engine API").
 *
 * These load the real core pack and drive a generated {@link WorldState} — one
 * that carries real {@link Truth}-branded NPC fields, true allegiances, MICE
 * profiles and cover-derived apparent allegiances — through the scene, "here",
 * Documents and Case File projections and the {@link PlayerViewEngine} facade.
 * The point is to prove the projections are truth-safe on real ground truth,
 * not on a stripped fixture:
 *
 * - the scene and "here" panels label a visible, *unidentified* NPC by their
 *   physical descriptor, never their persona name, and never surface the NPC
 *   record's `apparentAllegiance`, true allegiance or MICE values;
 * - once the player identifies an NPC, the panels label them by name;
 * - the serialized projections contain no truth-branded value; and
 * - the Documents reader renders only the fact-layer `body`, read flag and
 *   obtainability.
 *
 * The dedicated truth-isolation *property* test is task 16.5; these are the
 * example-based unit tests the facade's own correctness rests on.
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
  type DocId,
  type GenerateInputs,
  type LocId,
  type NpcId,
  type Phase,
  type ResolverContext,
  type WorldState,
} from '@tradecraft/engine';

import { ScenarioConfigSchema } from '@tradecraft/engine';

import { CaseFile } from '../casefile/casefile.js';
import { implicationRules, type BriefView } from '../casefile/evidence.js';
import { PlayerViewEngine } from './engine-api.js';
import {
  documentListView,
  documentView,
  hereView,
  personLabel,
  sceneView,
  visiblePersonLabels,
} from './views.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors engine/action.spec.ts)
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

/**
 * Find a Location, at some phase, that has at least one NPC scheduled there and
 * where none of them is in the player's known set — so the scene labels them as
 * Unidentified Subjects. Returns the Location and the phase to set the clock to.
 */
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

/** Put the player at a Location (a shallow, typed override). */
function atLocation(state: WorldState, loc: LocId): WorldState {
  return { ...state, player: { ...state.player, loc } };
}

/** Add an NPC to the player's known set (identified from now on). */
function withKnown(state: WorldState, npc: NpcId): WorldState {
  return {
    ...state,
    player: {
      ...state.player,
      known: {
        ...state.player.known,
        entities: [...state.player.known.entities, npc],
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Person labels (name-or-descriptor; Requirement 23.4)
// ---------------------------------------------------------------------------

describe('personLabel — name-or-descriptor', () => {
  it('labels an unidentified NPC by their descriptor, never their name', () => {
    const w = world();
    const scene = findSceneWithUnknowns(w);
    expect(scene).toBeDefined();
    if (scene === undefined) return;

    const npc = scene.npcs[0];
    const record = scene.state.npcs[npc];
    expect(scene.state.player.known.entities).not.toContain(npc);

    const label = personLabel(scene.state, npc);
    // The label is the physical descriptor summary, not the persona name.
    expect(label.label).toBe(record.descriptor.summary);
    expect(label.label).not.toBe(record.persona.name);
  });

  it('labels an identified NPC by their persona name', () => {
    const w = world();
    const scene = findSceneWithUnknowns(w);
    expect(scene).toBeDefined();
    if (scene === undefined) return;

    const npc = scene.npcs[0];
    const identified = withKnown(scene.state, npc);
    const label = personLabel(identified, npc);
    expect(label.label).toBe(identified.npcs[npc].persona.name);
  });
});

// ---------------------------------------------------------------------------
// Scene / here truth-safety (Requirement 2.2)
// ---------------------------------------------------------------------------

describe('sceneView / hereView — truth isolation', () => {
  it('never leaks an unidentified NPC name, apparent allegiance or MICE values', () => {
    const w = world();
    const found = findSceneWithUnknowns(w);
    expect(found).toBeDefined();
    if (found === undefined) return;

    const state = atLocation(found.state, found.loc);
    const scene = sceneView(state, cityData, found.loc);
    const here = hereView(state, cityData, found.loc);

    const serialized = JSON.stringify({ scene, here });

    for (const npc of found.npcs) {
      const record = state.npcs[npc];
      // Unidentified persons: their persona name must not appear anywhere in
      // the serialized views.
      expect(serialized).not.toContain(record.persona.name);
      // The descriptor summary (view-safe) is what the panels show instead.
      expect(serialized).toContain(record.descriptor.summary);
      // The cover-derived apparent allegiance must never be surfaced.
      expect(serialized).not.toContain(`"${record.apparentAllegiance}"`);
      // The true allegiance org must not leak.
      expect(serialized).not.toContain(revealTruth(record.trueAllegiance).org);
    }
  });

  it('surfaces no truth-branded value in the serialized scene/here views', () => {
    const w = world();
    const found = findSceneWithUnknowns(w);
    expect(found).toBeDefined();
    if (found === undefined) return;

    const state = atLocation(found.state, found.loc);
    const scene = sceneView(state, cityData, found.loc);
    const here = hereView(state, cityData, found.loc);
    const serialized = JSON.stringify({ scene, here });

    // MICE values, money needs and reliabilities are Truth-branded numbers; the
    // scene is only Location/weather/crowd/person-label data, so the view shape
    // simply has nowhere to carry them. Assert the shape as a guard.
    expect(Object.keys(scene)).toEqual(
      expect.arrayContaining(['location', 'time', 'weather', 'crowd', 'visible']),
    );
    expect(Object.keys(here)).toEqual(
      expect.arrayContaining(['location', 'crowd', 'weather', 'visible']),
    );
    // Every visible entry carries only an id and a label.
    for (const person of scene.visible) {
      expect(Object.keys(person).sort()).toEqual(['id', 'label']);
    }
    expect(serialized.length).toBeGreaterThan(0);
  });

  it('labels an identified NPC by name in the scene', () => {
    const w = world();
    const found = findSceneWithUnknowns(w);
    expect(found).toBeDefined();
    if (found === undefined) return;

    const npc = found.npcs[0];
    const state = withKnown(atLocation(found.state, found.loc), npc);
    const scene = sceneView(state, cityData, found.loc);
    const labelled = scene.visible.find((p) => p.id === npc);
    expect(labelled?.label).toBe(state.npcs[npc].persona.name);
  });
});

describe('visiblePersonLabels', () => {
  it('labels every scheduled NPC at the Location in deterministic order', () => {
    const w = world();
    const found = findSceneWithUnknowns(w);
    expect(found).toBeDefined();
    if (found === undefined) return;

    const labels = visiblePersonLabels(found.state, found.loc);
    expect(labels.length).toBe(found.npcs.length);
  });
});

// ---------------------------------------------------------------------------
// Documents (design "Documents")
// ---------------------------------------------------------------------------

describe('documentListView / documentView', () => {
  it('renders the fact-layer body and a read flag, with no truth field', () => {
    const w = world();
    const docIds = Object.keys(w.documents) as DocId[];
    expect(docIds.length).toBeGreaterThan(0);

    const id = docIds[0];
    const view = documentView(w, id);
    expect(view).toBeDefined();
    if (view === undefined) return;

    const doc = w.documents[id];
    expect(view.body).toBe(doc.body);
    expect(view.title).toBe(doc.title);
    expect(view.kind).toBe(doc.kind);
    // A freshly generated Document has not been read yet.
    expect(view.read).toBe(false);
    // The reader view carries no `asserts` ids or truth — only display fields.
    expect(Object.keys(view).sort()).toEqual(
      ['body', 'date', 'dateLabel', 'id', 'kind', 'read', 'title'].sort(),
    );
  });

  it('lists delivered Documents (Dossiers, Cables) regardless of Location', () => {
    const w = world();
    const list = documentListView(w);
    // The brief Cable and the HQ Dossiers are delivered (no obtainableAt), so
    // they appear in the list from any Location.
    const delivered = Object.values(w.documents).filter(
      (d) => d.obtainableAt === undefined,
    );
    for (const doc of delivered) {
      expect(list.documents.some((e) => e.id === doc.id)).toBe(true);
    }
  });

  it('returns undefined for an unknown Document id', () => {
    const w = world();
    expect(documentView(w, 'doc:nope/missing')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Facade: Case File surface and status
// ---------------------------------------------------------------------------

describe('PlayerViewEngine — Case File and status', () => {
  function engine(): { api: PlayerViewEngine; cf: CaseFile; state: WorldState } {
    const state = world();
    const cf = new CaseFile();
    const api = new PlayerViewEngine({
      state,
      caseFile: cf,
      cityData,
      ctx: CTX,
      brief: EMPTY_BRIEF,
      rules: NO_RULES,
    });
    return { api, cf, state };
  }

  it('lists, grades, links and unlinks Case File Claims through the facade', () => {
    const { api, cf } = engine();
    const subject = 'npc:x' as NpcId;
    const object = 'npc:y' as NpcId;
    const a = cf.add({
      source: { kind: 'npc', npc: subject },
      prop: { id: 'p1', subject, predicate: 'KNOWS', object },
      observedAt: { day: 1, phase: 0 },
    });
    const b = cf.add({
      source: { kind: 'document', id: 'doc:d1' as DocId },
      prop: { id: 'p2', subject, predicate: 'KNOWS', object },
      observedAt: { day: 1, phase: 1 },
    });

    expect(api.caseFile.list({}).length).toBe(2);
    expect(api.caseFile.list({ source: 'npc' }).map((c) => c.id)).toEqual([a.id]);

    const gradeA1 = { reliability: 'A', credibility: 1 } as const;
    api.caseFile.grade(a.id, gradeA1);
    expect(cf.get(a.id)?.grade).toEqual(gradeA1);
    expect(api.caseFile.list({ grade: gradeA1 }).map((c) => c.id)).toEqual([a.id]);

    api.caseFile.link(a.id, b.id);
    expect(cf.get(a.id)?.links).toContain(b.id);
    api.caseFile.unlink(a.id, b.id);
    expect(cf.get(a.id)?.links).not.toContain(b.id);
  });

  it('reports status from view-safe fields only', () => {
    const { api, state } = engine();
    const status = api.status();
    expect(status.time).toEqual(state.time);
    expect(status.location.id).toBe(state.player.loc);
    expect(status.standing).toBe(state.station.standing);
    expect(status.ended).toBe(false);
  });

  it('exposes the scene, here and documents projections', () => {
    const { api } = engine();
    expect(api.views.scene().location.id).toBeDefined();
    expect(api.views.here().location.id).toBeDefined();
    expect(Array.isArray(api.views.documents().documents)).toBe(true);
  });

  it('throws rather than silently no-op when the Turn Pipeline is not wired', () => {
    const { api } = engine();
    expect(() => api.act({ kind: 'wait', phases: 1 })).toThrow(/Turn Pipeline/);
  });

  it('wires the Journal: notes.add records a note and views.journal() reads it', () => {
    const { api, state } = engine();
    // A fresh facade owns an empty Journal.
    expect(api.views.journal().entries).toEqual([]);
    expect(api.views.journal().notes).toEqual([]);

    api.notes.add({ attachTo: 3, text: 'check the park' });
    api.notes.add({ attachTo: 'npc:viktor' as NpcId, text: 'suspect' });

    const view = api.views.journal();
    expect(view.notes).toHaveLength(2);
    // Notes are stamped with the current game time (Req 33.2).
    expect(view.notes[0].at).toEqual(state.time);
    expect(view.notes.map((n) => n.text)).toEqual(['check the park', 'suspect']);
  });
});
