/**
 * Tests for Unidentified Subjects and identification (task 11.2; Requirements
 * 21.7, 23.4, 23.5).
 *
 * These drive a generated {@link WorldState} from the real core pack and a
 * Truth Store, checking:
 *
 * - allocating a `unk:` id for an unidentified NPC records `identityOf(unk)` in
 *   the Truth Store and reuses the same `unk:N` across calls (Req 21.7);
 * - the visible-persons listing presents an unidentified NPC by their `unk:` id
 *   and an identified NPC by their `npc:` id, allocating stable sequential ids
 *   (Req 23.4);
 * - the identity-aware namer renders an unidentified person (by `npc:` or `unk:`
 *   id) as their descriptor summary, and an identified one by name (Req 23.4);
 * - `identify` adds the NPC to the known set and reports an `IS_ALIAS_OF(unk,
 *   npc)` Claim sourced to the trigger (Req 23.5);
 * - determinism: the same inputs give the same ids and the same report.
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
  type EvaluatorKind,
  type PublicText,
} from '@tradecraft/content';

import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import { revealTruth, type NpcId, type UnkId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import {
  TruthStore,
  type PredicateEvaluatorLookup,
} from '../truth/truth.js';
import { namerContextOf } from './action.js';
import {
  allocateUnk,
  allocatedUnk,
  identify,
  identityAwareNamer,
  identityContextOf,
  isIdentified,
  nextUnkId,
  visiblePersons,
} from './identify.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors read.spec.ts / travel.spec.ts)
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

function world(seed = 'identify-alpha'): WorldState {
  return generate(seed, inputs());
}

/** A Truth Store whose only predicate is `IS_ALIAS_OF` (kind `alias`). */
function truth(): TruthStore {
  const lookup: PredicateEvaluatorLookup = {
    get: (predicate) =>
      predicate === 'IS_ALIAS_OF' ? ('alias' as EvaluatorKind) : undefined,
  };
  return TruthStore.create(lookup);
}

/** The NPC ids in a world, sorted for determinism. */
function npcIds(state: WorldState): NpcId[] {
  return (Object.keys(state.npcs) as NpcId[]).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
}

/** An NPC the player has NOT identified (not in their known set). */
function unidentifiedNpc(state: WorldState): NpcId {
  const npc = npcIds(state).find((id) => !isIdentified(state, id));
  if (npc === undefined) {
    throw new Error('no unidentified NPC in the generated world');
  }
  return npc;
}

/** An NPC the player HAS identified (in their known set), if any. */
function identifiedNpc(state: WorldState): NpcId | undefined {
  return npcIds(state).find((id) => isIdentified(state, id));
}

// ---------------------------------------------------------------------------
// Allocation (Req 21.7)
// ---------------------------------------------------------------------------

describe('allocateUnk — stable unk allocation (Req 21.7)', () => {
  it('allocates a unk:N id, records identityOf in the Truth Store, and reuses it', () => {
    const state = world();
    const store = truth();
    const npc = unidentifiedNpc(state);

    const first = allocateUnk(state, store, npc);
    expect(first.unk).toMatch(/^unk:\d+$/);
    // The Truth Store now resolves the unk back to the NPC.
    expect(revealTruth(store.identityOf(first.unk) as never)).toBe(npc);
    // The allocation table records it on the next state.
    expect(allocatedUnk(first.next, npc)).toBe(first.unk);

    // A second allocation for the same NPC reuses the id and leaves state as-is.
    const second = allocateUnk(first.next, store, npc);
    expect(second.unk).toBe(first.unk);
    expect(second.next).toBe(first.next);
  });

  it('hands out sequential ids to distinct NPCs', () => {
    const state = world();
    const store = truth();
    const ids = npcIds(state).filter((id) => !isIdentified(state, id)).slice(0, 2);
    expect(ids.length).toBe(2);

    const a = allocateUnk(state, store, ids[0]);
    expect(a.unk).toBe('unk:1');
    const b = allocateUnk(a.next, store, ids[1]);
    expect(b.unk).toBe('unk:2');
    expect(nextUnkId(b.next.player.unkIds)).toBe('unk:3');
  });
});

// ---------------------------------------------------------------------------
// Visible persons (Req 23.4)
// ---------------------------------------------------------------------------

describe('visiblePersons — identified vs. unk listing (Req 23.4)', () => {
  it('presents an unidentified NPC by their unk id and an identified NPC by their npc id', () => {
    const base = world();
    const store = truth();
    const unknown = unidentifiedNpc(base);

    // Make one NPC identified so the listing shows both cases.
    const known = npcIds(base).find((id) => id !== unknown) as NpcId;
    const state: WorldState = {
      ...base,
      player: {
        ...base.player,
        known: {
          ...base.player.known,
          entities: [...base.player.known.entities, known],
        },
      },
    };

    const { visible, next } = visiblePersons(state, store, [unknown, known]);
    // The identified NPC is listed by name; the unidentified one by a unk id.
    expect(visible[1]).toBe(known);
    expect(visible[0]).toMatch(/^unk:\d+$/);
    // The unk id is recorded and reused on a repeat listing.
    expect(allocatedUnk(next, unknown)).toBe(visible[0]);
    const again = visiblePersons(next, store, [unknown, known]);
    expect(again.visible[0]).toBe(visible[0]);
  });
});

// ---------------------------------------------------------------------------
// The identity-aware namer (Req 23.4)
// ---------------------------------------------------------------------------

describe('identityAwareNamer — descriptor vs. name (Req 23.4)', () => {
  it('renders an unidentified NPC as their descriptor, not their name', () => {
    const state = world();
    const npc = unidentifiedNpc(state);
    const namer = identityAwareNamer(namerContextOf(state), identityContextOf(state));

    const summary = state.npcs[npc].descriptor.summary;
    const name = state.npcs[npc].persona.name;
    expect(namer(npc)).toBe(summary);
    expect(namer(npc)).not.toBe(name);
  });

  it('renders a unk id as the descriptor of the NPC it was allocated for', () => {
    const base = world();
    const store = truth();
    const npc = unidentifiedNpc(base);
    const { next, unk } = allocateUnk(base, store, npc);
    const namer = identityAwareNamer(namerContextOf(next), identityContextOf(next));

    expect(namer(unk)).toBe(next.npcs[npc].descriptor.summary);
  });

  it('renders an identified NPC by name', () => {
    const base = world();
    const npc = identifiedNpc(base) ?? unidentifiedNpc(base);
    // Force the NPC into the known set so this case always exercises "by name".
    const state: WorldState = {
      ...base,
      player: {
        ...base.player,
        known: {
          ...base.player.known,
          entities: [...base.player.known.entities, npc],
        },
      },
    };
    const namer = identityAwareNamer(namerContextOf(state), identityContextOf(state));
    expect(namer(npc)).toBe(state.npcs[npc].persona.name);
  });
});

// ---------------------------------------------------------------------------
// Identification -> IS_ALIAS_OF (Req 23.5)
// ---------------------------------------------------------------------------

describe('identify — IS_ALIAS_OF emission (Req 23.5)', () => {
  it('reports an IS_ALIAS_OF(unk, npc) Claim and marks the NPC known (dossier source)', () => {
    const base = world();
    const store = truth();
    const npc = unidentifiedNpc(base);

    const { report, next } = identify(base, store, {
      npc,
      trigger: 'dossier',
      sourceId: 'doc:dossier/x' as never,
      observedAt: next0(base),
    });

    // The reported Claim links the unk to the npc under IS_ALIAS_OF.
    expect(report.prop.subject).toBe(report.unk);
    expect(report.prop.object).toBe(npc);
    expect(report.prop.predicate).toBe('IS_ALIAS_OF');
    expect(report.npc).toBe(npc);
    expect(report.trigger).toBe('dossier');

    // The NPC is now identified, and the Truth Store resolves the unk.
    expect(isIdentified(next, npc)).toBe(true);
    expect(revealTruth(store.identityOf(report.unk) as never)).toBe(npc);
  });

  it('reuses an already-allocated unk id when the subject was observed first', () => {
    const base = world();
    const store = truth();
    const npc = unidentifiedNpc(base);
    const observed = allocateUnk(base, store, npc);

    const { report } = identify(observed.next, store, {
      npc,
      trigger: 'introduction',
      sourceId: npc,
      observedAt: next0(base),
      unk: observed.unk,
    });
    expect(report.unk).toBe(observed.unk);
    expect(report.trigger).toBe('introduction');
    expect(report.sourceId).toBe(npc);
  });

  it('does not allocate a unk id for an already-identified NPC in a listing', () => {
    const base = world();
    const store = truth();
    const npc = unidentifiedNpc(base);
    // Identify it, then list it: no unk should be shown, and the table is stable.
    const { next } = identify(base, store, {
      npc,
      trigger: 'dossier',
      sourceId: 'doc:dossier/x' as never,
      observedAt: next0(base),
    });
    const before = next.player.unkIds[npc];
    const listed = visiblePersons(next, store, [npc]);
    expect(listed.visible[0]).toBe(npc);
    expect(listed.next.player.unkIds[npc]).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('identify / allocateUnk — determinism', () => {
  it('allocates the same unk id and reports the same Claim for the same inputs', () => {
    const state = world('identify-det');
    const npc = unidentifiedNpc(state);

    const a = identify(state, truth(), {
      npc,
      trigger: 'asset-report',
      sourceId: 'npc:asset' as never,
      observedAt: next0(state),
    });
    const b = identify(state, truth(), {
      npc,
      trigger: 'asset-report',
      sourceId: 'npc:asset' as never,
      observedAt: next0(state),
    });
    expect(a.report.unk).toBe(b.report.unk);
    expect(a.report.prop).toEqual(b.report.prop);
    expect((a.report.unk as UnkId)).toMatch(/^unk:\d+$/);
  });
});

/** The world's current time, as the observation stamp for a Claim. */
function next0(state: WorldState): WorldState['time'] {
  return state.time;
}
