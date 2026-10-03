/**
 * Focused unit tests for the Player-View Objective Evaluator (slice-integration
 * task 7.4; design, "Player View: Objective Evaluator"; Requirements 6.1, 6.2,
 * 6.3).
 *
 * These build an evaluator over a generated world and a Case File, and for each
 * of the four Directive objective kinds assert the met/unmet result both ways:
 *
 *  - `identify` — met when the entity is in `player.known.entities`, or an
 *    `unk:` id resolves to it through a held `IS_ALIAS_OF` Claim; unmet before;
 *  - `recruit` — met when at least `count` Relationships are `recruited`, unmet
 *    when fewer;
 *  - `arrest` — met when the entity is in `player.arrests` by its own id and by
 *    the `unk:` id the player knows it by, unmet otherwise;
 *  - `intercept` — met when a collected Intercept on the Channel exists, unmet
 *    otherwise.
 *
 * The last block also pins Req 6.3/6.5: a non-knowledge objective's result is a
 * function of the player's recorded actions, independent of ground truth.
 *
 * The core-pack fixture pattern mirrors `resolver-projection.spec.ts`.
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
  generateGame,
  newRelationship,
  ScenarioConfigSchema,
  type ChannelId,
  type DirectiveObjective,
  type EntityId,
  type GameTime,
  type GenerateInputs,
  type Intercept,
  type InterceptId,
  type NpcId,
  type Proposition,
  type Relationship,
  type UnkId,
  type WorldState,
} from '@tradecraft/engine';

import { CaseFile, type ClaimSource } from '../casefile/casefile.js';
import { buildObjectiveEvaluator } from './objective-evaluator.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors resolver-projection.spec.ts)
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
  if (!content.ok) throw new Error('core pack failed to load');
  const cityData = loadCityData(CORE_DIR);
  if (!cityData.ok) throw new Error('city.yaml failed to load');
  const descriptors = loadDescriptorData(CORE_DIR);
  if (!descriptors.ok) throw new Error('descriptors.yaml failed to load');
  const publicTexts = loadPublicTexts(CORE_DIR);
  if (!publicTexts.ok) throw new Error('public texts failed to load');
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
    if (key === id || key.endsWith(`/${id}`)) return value;
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

function game(seed = 'alpha'): WorldState {
  return generateGame(seed, inputs()).world;
}

// ---------------------------------------------------------------------------
// Helpers for overriding the draft's player-progress records
// ---------------------------------------------------------------------------

const T: GameTime = { day: 0, phase: 0 };

/** Replace the world's `player` slice with the given overrides. */
function withPlayer(world: WorldState, patch: Partial<WorldState['player']>): WorldState {
  return { ...world, player: { ...world.player, ...patch } };
}

/** A recruited Relationship for an NPC (the evaluator reads only `recruited`). */
function recruited(npc: NpcId): Relationship {
  return { ...newRelationship(npc), recruited: true };
}

/**
 * A collected Intercept captured off `channel`. The evaluator reads only
 * `channel`, so the heavy Truth-bearing fields are stubbed behind one localised
 * cast — this spec exercises the Channel match, not the cipher record.
 */
function interceptOn(id: InterceptId, channel: ChannelId): Intercept {
  return { id, channel } as unknown as Intercept;
}

/** An `IS_ALIAS_OF(unk, npc)` Claim, as the identification machinery files it. */
function aliasClaim(caseFile: CaseFile, unk: UnkId, npc: NpcId): void {
  const source: ClaimSource = { kind: 'npc', npc };
  const prop: Proposition = {
    id: `alias:${unk}->${npc}`,
    subject: unk,
    predicate: 'IS_ALIAS_OF',
    object: npc,
  };
  caseFile.add({ source, prop, observedAt: T });
}

/** An NPC the generated world does not already list as known (unidentified). */
function unknownNpc(world: WorldState, skip: ReadonlySet<NpcId> = new Set()): NpcId {
  const known = new Set<EntityId>(world.player.known.entities);
  for (const id of Object.keys(world.npcs) as NpcId[]) {
    if (!known.has(id) && !skip.has(id)) return id;
  }
  throw new Error('no unidentified NPC in the generated world');
}

const identify = (entity: EntityId): DirectiveObjective => ({ kind: 'identify', entity });
const recruit = (count: number): DirectiveObjective => ({ kind: 'recruit', count });
const arrest = (entity: EntityId): DirectiveObjective => ({ kind: 'arrest', entity });
const intercept = (channel: ChannelId): DirectiveObjective => ({ kind: 'intercept', channel });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildObjectiveEvaluator', () => {
  describe('identify', () => {
    it('is met when the entity is in the known set by name', () => {
      const world = game();
      const npc = unknownNpc(world);
      const caseFile = new CaseFile();

      const before = buildObjectiveEvaluator({ state: world, caseFile });
      expect(before(identify(npc), T)).toBe(false);

      const known = withPlayer(world, {
        known: { ...world.player.known, entities: [...world.player.known.entities, npc] },
      });
      const after = buildObjectiveEvaluator({ state: known, caseFile });
      expect(after(identify(npc), T)).toBe(true);
    });

    it('is met for an `unk:` id resolved to it through a held IS_ALIAS_OF Claim', () => {
      const world = game();
      const npc = unknownNpc(world);
      const unk: UnkId = 'unk:1';
      const caseFile = new CaseFile();

      // The player knows `npc` by name, and holds the alias linking `unk:1`.
      const known = withPlayer(world, {
        known: { ...world.player.known, entities: [...world.player.known.entities, npc] },
      });

      const beforeAlias = buildObjectiveEvaluator({ state: known, caseFile });
      // Without the alias Claim, an objective naming the `unk:` id is unmet.
      expect(beforeAlias(identify(unk), T)).toBe(false);

      aliasClaim(caseFile, unk, npc);
      const afterAlias = buildObjectiveEvaluator({ state: known, caseFile });
      // The `unk:` id now resolves to the known `npc:` id, so it is identified.
      expect(afterAlias(identify(unk), T)).toBe(true);
    });

    it('is unmet for an entity the player has neither named nor aliased', () => {
      const world = game();
      const npc = unknownNpc(world);
      const caseFile = new CaseFile();
      const evaluator = buildObjectiveEvaluator({ state: world, caseFile });
      expect(evaluator(identify(npc), T)).toBe(false);
    });
  });

  describe('recruit', () => {
    it('is met when enough Relationships are recruited and unmet when fewer', () => {
      const world = game();
      const [a, b] = Object.keys(world.npcs) as NpcId[];
      const caseFile = new CaseFile();

      const twoRecruited = {
        ...world,
        relationships: { ...world.relationships, [a]: recruited(a), [b]: recruited(b) },
      };
      const evaluator = buildObjectiveEvaluator({ state: twoRecruited, caseFile });

      expect(evaluator(recruit(2), T)).toBe(true);
      expect(evaluator(recruit(1), T)).toBe(true);
      // Three required, only two recruited.
      expect(evaluator(recruit(3), T)).toBe(false);
    });

    it('counts only recruited Relationships', () => {
      const world = game();
      const a = Object.keys(world.npcs)[0] as NpcId;
      const caseFile = new CaseFile();
      // A present-but-unrecruited Relationship does not count.
      const oneContact = { ...world, relationships: { ...world.relationships, [a]: newRelationship(a) } };
      const evaluator = buildObjectiveEvaluator({ state: oneContact, caseFile });
      expect(evaluator(recruit(1), T)).toBe(false);
    });
  });

  describe('arrest', () => {
    it('is met when the entity is in player.arrests by its own id', () => {
      const world = game();
      const npc = Object.keys(world.npcs)[0] as NpcId;
      const caseFile = new CaseFile();

      const before = buildObjectiveEvaluator({ state: world, caseFile });
      expect(before(arrest(npc), T)).toBe(false);

      const arrested = withPlayer(world, { arrests: [npc] });
      const after = buildObjectiveEvaluator({ state: arrested, caseFile });
      expect(after(arrest(npc), T)).toBe(true);
    });

    it('is met when the arrest is recorded under the `unk:` alias the player knows', () => {
      const world = game();
      const npc = Object.keys(world.npcs)[0] as NpcId;
      const unk: UnkId = 'unk:7';
      const caseFile = new CaseFile();

      // The Station granted the arrest against the Unidentified-Subject id, and
      // the player's allocation table maps the NPC to that id.
      const arrested = withPlayer(world, { arrests: [unk], unkIds: { ...world.player.unkIds, [npc]: unk } });
      const evaluator = buildObjectiveEvaluator({ state: arrested, caseFile });

      // An objective naming the `npc:` id is met via the alias.
      expect(evaluator(arrest(npc), T)).toBe(true);
      // An objective naming the `unk:` id directly is met too.
      expect(evaluator(arrest(unk), T)).toBe(true);
    });

    it('is unmet for an entity the Station has not arrested', () => {
      const world = game();
      const npc = Object.keys(world.npcs)[0] as NpcId;
      const other = Object.keys(world.npcs)[1] as NpcId;
      const caseFile = new CaseFile();
      const arrested = withPlayer(world, { arrests: [npc] });
      const evaluator = buildObjectiveEvaluator({ state: arrested, caseFile });
      expect(evaluator(arrest(other), T)).toBe(false);
    });
  });

  describe('intercept', () => {
    it('is met when a collected Intercept on the Channel exists and unmet otherwise', () => {
      const world = game();
      const channel: ChannelId = 'chan:hostile-net';
      const otherChannel: ChannelId = 'chan:noise';
      const caseFile = new CaseFile();

      const before = buildObjectiveEvaluator({ state: world, caseFile });
      expect(before(intercept(channel), T)).toBe(false);

      const collected = { ...world, intercepts: { ...world.intercepts, 'int:1': interceptOn('int:1', channel) } };
      const after = buildObjectiveEvaluator({ state: collected, caseFile });
      expect(after(intercept(channel), T)).toBe(true);
      // A different Channel's objective stays unmet.
      expect(after(intercept(otherChannel), T)).toBe(false);
    });
  });

  describe('truth independence (Req 6.3, 6.5)', () => {
    it('decides recruit/arrest/intercept from recorded actions alone', () => {
      const world = game();
      const npc = Object.keys(world.npcs)[0] as NpcId;
      const channel: ChannelId = 'chan:x';
      const caseFile = new CaseFile();

      // All three progress records present on the draft, independent of truth.
      const progressed = withPlayer(
        {
          ...world,
          relationships: { ...world.relationships, [npc]: recruited(npc) },
          intercepts: { ...world.intercepts, 'int:1': interceptOn('int:1', channel) },
        },
        { arrests: [npc] },
      );
      const evaluator = buildObjectiveEvaluator({ state: progressed, caseFile });

      expect(evaluator(recruit(1), T)).toBe(true);
      expect(evaluator(arrest(npc), T)).toBe(true);
      expect(evaluator(intercept(channel), T)).toBe(true);
    });
  });
});
