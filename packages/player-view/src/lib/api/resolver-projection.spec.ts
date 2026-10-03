/**
 * Focused unit tests for the per-turn Resolver Context projection (task 7.3;
 * design, "Turn Pipeline" step 4; Requirements 5.3, 6.2).
 *
 * These build a {@link ResolverContext} over a generated world and a Case File
 * holding a couple of corroborated Claims, and pin the fields
 * {@link projectResolverContext} fills:
 *
 *  - `content` is the loaded content set;
 *  - `claims` maps every held Claim id to its Proposition — the evidence
 *    `confront`/`feed` read by id;
 *  - `arrestEvidence` for a target equals the pure Case File `evidenceCount`;
 *  - `cipherKeys` resolves a known public-text Document to its body;
 *  - `truth` is exactly the draft the caller passes, so a fact staged on the
 *    draft is visible through `ctx.truth.holds` (read-your-writes, Req 5.3).
 *
 * The core-pack fixture pattern mirrors `turn-pipeline.spec.ts`.
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
  TruthDraft,
  generateGame,
  publicTextIdsOf,
  ScenarioConfigSchema,
  type EntityId,
  type GameTime,
  type GenerateInputs,
  type NpcId,
  type OrgId,
  type Proposition,
  type WorldState,
  type TruthStore,
} from '@tradecraft/engine';

import { CaseFile, type ClaimSource } from '../casefile/casefile.js';
import {
  evidenceCount,
  implicationRules,
  type BriefView,
  type ImplicationRules,
} from '../casefile/evidence.js';
import { projectResolverContext } from './resolver-projection.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors turn-pipeline.spec.ts)
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

function game(seed = 'alpha'): { world: WorldState; truth: TruthStore } {
  return generateGame(seed, inputs());
}

// ---------------------------------------------------------------------------
// Brief and rules: one hostile org, so a MEMBER_OF Claim implicates its subject.
// ---------------------------------------------------------------------------

const HOSTILE_ORG: OrgId = 'org:test-hostile';

const BRIEF: BriefView = {
  hostileOrgs: [HOSTILE_ORG],
  hostileChannels: [],
  materiel: [],
};

const RULES: ImplicationRules = implicationRules([
  ['MEMBER_OF', { role: 'subject', other: ['hostile-org'] }],
  ['IS_ALIAS_OF', undefined],
]);

const T: GameTime = { day: 0, phase: 0 };

let propCounter = 0;
function prop(subject: NpcId, predicate: string, object: EntityId): Proposition {
  propCounter += 1;
  return { id: `prop:${propCounter}`, subject, predicate, object };
}

const npcSource = (n: string): ClaimSource => ({ kind: 'npc', npc: `npc:${n}` });
const docSource = (id: string): ClaimSource => ({ kind: 'document', id: `doc:${id}` });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('projectResolverContext', () => {
  function makeInput() {
    const { world, truth } = game();
    const target = Object.keys(world.npcs)[0] as NpcId;
    const caseFile = new CaseFile();
    // Two corroborating sources assert the same implicating Proposition, so it
    // counts once as corroborated evidence against `target`.
    caseFile.add({ source: npcSource('a'), prop: prop(target, 'MEMBER_OF', HOSTILE_ORG), observedAt: T });
    caseFile.add({ source: docSource('b'), prop: prop(target, 'MEMBER_OF', HOSTILE_ORG), observedAt: T });
    return {
      input: { state: world, caseFile, content, brief: BRIEF, rules: RULES },
      world,
      truth,
      target,
      caseFile,
    };
  }

  it('sets `content` to the loaded content set', () => {
    const { input, truth } = makeInput();
    const ctx = projectResolverContext(input, TruthDraft.over(truth));
    expect(ctx.content).toBe(content);
  });

  it('maps every held Claim id to its Proposition in `claims`', () => {
    const { input, truth, caseFile } = makeInput();
    const ctx = projectResolverContext(input, TruthDraft.over(truth));
    const held = caseFile.list();
    expect(held.length).toBeGreaterThan(0);
    for (const claim of held) {
      expect(ctx.claims?.[claim.id]).toBe(claim.prop);
    }
    expect(Object.keys(ctx.claims ?? {}).length).toBe(held.length);
  });

  it('scores `arrestEvidence` for a target equal to evidenceCount', () => {
    const { input, truth, caseFile, target } = makeInput();
    const ctx = projectResolverContext(input, TruthDraft.over(truth));
    const expected = evidenceCount(caseFile, target, BRIEF, RULES);
    expect(expected).toBe(1);
    expect(ctx.arrestEvidence?.[target]).toBe(expected);
    // The matching turn-agent entry carries the same count.
    expect(ctx.turnEvidence?.[target]?.evidenceCount).toBe(expected);
  });

  it('resolves a known public text through `cipherKeys`', () => {
    const { input, truth, world } = makeInput();
    const ctx = projectResolverContext(input, TruthDraft.over(truth));
    const publicTextIds = publicTextIdsOf(world.documents);
    expect(publicTextIds.length).toBeGreaterThan(0);
    const id = publicTextIds[0];
    expect(ctx.cipherKeys?.publicText(id)).toBe(world.documents[id].body);
  });

  it('threads the draft as `truth` with read-your-writes', () => {
    const { input, truth } = makeInput();
    const draft = TruthDraft.over(truth);
    const ctx = projectResolverContext(input, draft);
    // The projection hands back the exact draft it was given.
    expect(ctx.truth).toBe(draft);

    // A fact staged on the draft after projection is visible through ctx.truth,
    // so a later resolver in the turn reads its own writes. `core/KNOWS` is a
    // `fact-match` predicate: the exact staged Proposition holds, and a novel
    // pair of ids guarantees it does not hold before staging.
    const staged: Proposition = {
      id: 'prop:staged',
      subject: 'npc:staged-subject',
      predicate: 'KNOWS',
      object: 'npc:staged-object',
    };
    expect(ctx.truth?.holds(staged, T)).toBe(false);
    draft.addFact(staged);
    expect(ctx.truth?.holds(staged, T)).toBe(true);
  });
});
