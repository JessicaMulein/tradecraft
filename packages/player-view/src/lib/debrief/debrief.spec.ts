/**
 * Behaviour tests for the end-of-game debrief (task 20.2; Requirements 8.3,
 * 19.6; design, Debrief screen).
 *
 * These load the real core pack and drive a generated `{ world, truth }` pair —
 * the ground-truth {@link WorldState} and the seeded {@link TruthStore} — through
 * {@link buildDebrief} and the {@link PlayerViewEngine} facade's
 * `views.debrief()`. The point is to pin the debrief's contract on a real
 * generated world:
 *
 * - the facade returns `null` before the game ends and a populated
 *   {@link DebriefView} once `WorldState.ended` is set;
 * - the allegiances section reveals each NPC's true organisation from the Truth
 *   Store (including the mole's deception);
 * - a false Case File Claim is flagged a lie;
 * - a Claim that reports a Side Thread's people is identified as a noise lead;
 * - a fed Proposition is classified chickenfeed (holds) or deception (does not);
 * - the Directive results and the grading score/accuracy are present; and
 * - the whole build is deterministic for a fixed world.
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
  ScenarioConfigSchema,
  buildOutcomeRecord,
  generateGame,
  parseOutcomeRecord,
  revealTruth,
  type GenerateInputs,
  type GameTime,
  type NpcId,
  type Proposition,
  type ResolverContext,
  type TruthStore,
  type PlotStateV2,
  type WorldState,
} from '@tradecraft/engine';

import { CaseFile } from '../casefile/casefile.js';
import { implicationRules, type BriefView } from '../casefile/evidence.js';
import { PlayerViewEngine } from '../api/engine-api.js';
import { buildDebrief, type RecordedFeed } from './debrief.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors api/views.spec.ts)
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

/** The ground-truth world and its seeded Truth Store for a seed. */
function game(seed = 'alpha'): { world: WorldState; truth: TruthStore } {
  const { world, truth } = generateGame(seed, inputs());
  return { world, truth };
}

const EMPTY_BRIEF: BriefView = { hostileOrgs: [], hostileChannels: [], materiel: [] };
const NO_RULES = implicationRules([]);

/**
 * Set a world's `ended` to a plot-completed loss, so the debrief has an end to
 * read. The Plot is marked completed so the end is consistent, and the time is
 * fixed for determinism.
 */
function endedWorld(world: WorldState, at: GameTime = { day: 5, phase: 0 }): WorldState {
  return {
    ...world,
    time: at,
    plot: { ...world.plot, status: 'completed' },
    ended: { outcome: 'failure', at, cause: 'plot-completed' },
  };
}

/** The first true fact in the Truth Store, as a plain Proposition. */
function firstTrueFact(truth: TruthStore): Proposition {
  const facts = truth.facts();
  expect(facts.length).toBeGreaterThan(0);
  return revealTruth(facts[0]);
}

/** A Proposition that does not hold: the first true fact with a bogus object. */
function falseVariant(truth: TruthStore): Proposition {
  const base = firstTrueFact(truth);
  return { ...base, id: 'prop:test/false', object: 'npc:does-not-exist' as NpcId };
}

// ---------------------------------------------------------------------------
// Facade: null before end, populated after (design; Req 19.6)
// ---------------------------------------------------------------------------

describe('views.debrief() — gated on ended', () => {
  it('returns null before the game has ended', () => {
    const { world, truth } = game();
    const engine = new PlayerViewEngine({
      state: world,
      caseFile: new CaseFile(),
      cityData,
      ctx: { content, truth } as ResolverContext,
      brief: EMPTY_BRIEF,
      rules: NO_RULES,
      truth,
    });
    expect(engine.views.debrief()).toBeNull();
  });

  it('returns a populated debrief once the game has ended', () => {
    const { world, truth } = game();
    const engine = new PlayerViewEngine({
      state: endedWorld(world),
      caseFile: new CaseFile(),
      cityData,
      ctx: { content } as ResolverContext,
      brief: EMPTY_BRIEF,
      rules: NO_RULES,
      truth,
    });
    const debrief = engine.views.debrief();
    expect(debrief).not.toBeNull();
    expect(debrief?.outcome).toBe('failure');
    expect(debrief?.cause).toBe('plot-completed');
    expect(debrief?.endedAt).toEqual({ day: 5, phase: 0 });
    expect(debrief?.allegiances.length).toBeGreaterThan(0);
    expect(debrief?.timeline.length).toBe(world.plot.stages.length);
  });

  it('returns null when no Truth Store is in reach, even once ended', () => {
    const { world } = game();
    const engine = new PlayerViewEngine({
      state: endedWorld(world),
      caseFile: new CaseFile(),
      cityData,
      ctx: { content } as ResolverContext,
      brief: EMPTY_BRIEF,
      rules: NO_RULES,
      // no `truth` dep and no `ctx.truth`
    });
    expect(engine.views.debrief()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// True allegiances (Req 19.6)
// ---------------------------------------------------------------------------

describe('buildDebrief — true allegiances', () => {
  it('reveals every NPC with a recorded allegiance and flags the mole deceptive', () => {
    const { world, truth } = game();
    const debrief = buildDebrief(endedWorld(world), truth, new CaseFile());

    // Every NPC is listed, in id order.
    const npcIds = Object.keys(world.npcs).sort();
    expect(debrief.allegiances.map((a) => a.npc)).toEqual(npcIds);

    // The mole truly serves the Hostile Service while presenting as Station —
    // the one NPC whose true org must disagree with its apparent category.
    const mole = world.station.mole === undefined ? undefined : revealTruth(world.station.mole);
    if (mole !== undefined) {
      const entry = debrief.allegiances.find((a) => a.npc === mole);
      expect(entry).toBeDefined();
      expect(entry?.deceptive).toBe(true);
      expect(entry?.trueOrg).toBeDefined();
    }

    // Every revealed true org matches what the Truth Store records.
    for (const a of debrief.allegiances) {
      const recorded = truth.allegiance(a.npc);
      if (recorded === undefined) {
        expect(a.trueOrg).toBeUndefined();
      } else {
        expect(a.trueOrg).toBe(revealTruth(recorded).org);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Lies (Req 19.6)
// ---------------------------------------------------------------------------

describe('buildDebrief — lies', () => {
  it('flags a false Case File Claim as a lie and leaves a true one alone', () => {
    const { world, truth } = game();
    const caseFile = new CaseFile();
    const at: GameTime = { day: 1, phase: 0 };

    const trueProp = firstTrueFact(truth);
    const trueClaim = caseFile.add({
      source: { kind: 'surveillance', loc: trueProp.place ?? ('loc:x' as never) },
      prop: trueProp,
      observedAt: at,
    });
    const falseClaim = caseFile.add({
      source: { kind: 'surveillance', loc: 'loc:x' as never },
      prop: falseVariant(truth),
      observedAt: at,
    });

    const debrief = buildDebrief(endedWorld(world), truth, caseFile);
    const lieIds = debrief.lies.map((l) => l.claim);
    expect(lieIds).toContain(falseClaim.id);
    expect(lieIds).not.toContain(trueClaim.id);
  });
});

// ---------------------------------------------------------------------------
// Side-Thread / Rumour leads (Req 19.6)
// ---------------------------------------------------------------------------

describe('buildDebrief — Side-Thread and Rumour leads', () => {
  it('identifies a Claim carrying a Side-Thread PropId as a noise lead', () => {
    const { world, truth } = game();
    // Find a seed with at least one Side Thread that produced a proposition.
    const thread = world.sideThreads.find((t) => t.propositions.length > 0);
    expect(thread).toBeDefined();
    if (thread === undefined) return;

    const caseFile = new CaseFile();
    const at: GameTime = { day: 1, phase: 0 };
    const lead = caseFile.add({
      source: { kind: 'surveillance', loc: thread.traces[0]?.loc ?? ('loc:x' as never) },
      prop: thread.propositions[0],
      observedAt: at,
    });

    const debrief = buildDebrief(endedWorld(world), truth, caseFile);
    const entry = debrief.noiseLeads.find((l) => l.claim === lead.id);
    expect(entry).toBeDefined();
    expect(entry?.kind).toBe('side-thread');
    expect(entry?.thread).toBe(thread.id);
  });
});

// ---------------------------------------------------------------------------
// Fed Propositions (Req 19.6; design "Feed ingestion")
// ---------------------------------------------------------------------------

describe('buildDebrief — fed Propositions', () => {
  it('classifies a true fed Proposition chickenfeed and a false one deception', () => {
    const { world, truth } = game();
    const trueProp = firstTrueFact(truth);
    const at: GameTime = { day: 2, phase: 1 };
    const feeds: RecordedFeed[] = [
      { agent: 'npc:asset' as NpcId, props: [trueProp, falseVariant(truth)], at },
    ];

    const debrief = buildDebrief(endedWorld(world), truth, new CaseFile(), feeds);
    expect(debrief.fedPropositions).toHaveLength(2);
    expect(debrief.fedPropositions[0].classification).toBe('chickenfeed');
    expect(debrief.fedPropositions[1].classification).toBe('deception');
  });

  it('leaves the fed-Propositions section empty when no feeds were recorded', () => {
    const { world, truth } = game();
    const debrief = buildDebrief(endedWorld(world), truth, new CaseFile());
    expect(debrief.fedPropositions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Directive results and score (Req 8.3, 19.6)
// ---------------------------------------------------------------------------

describe('buildDebrief — Directive results and score', () => {
  it('reports every Directive with its status and the final Standing', () => {
    const { world, truth } = game();
    const ended = endedWorld(world);
    const debrief = buildDebrief(ended, truth, new CaseFile());

    expect(debrief.directives.map((d) => d.id)).toEqual(
      ended.station.directives.map((d) => d.id),
    );
    expect(debrief.score.standing).toBe(ended.station.standing);
  });

  it('scores grading accuracy against ground truth', () => {
    const { world, truth } = game();
    const caseFile = new CaseFile();
    const at: GameTime = { day: 1, phase: 0 };

    // A true Claim graded credible (correct) and a false Claim graded credible
    // (incorrect): accuracy should be 1/2.
    const trueClaim = caseFile.add({
      source: { kind: 'surveillance', loc: 'loc:x' as never },
      prop: firstTrueFact(truth),
      observedAt: at,
    });
    const falseClaim = caseFile.add({
      source: { kind: 'surveillance', loc: 'loc:x' as never },
      prop: falseVariant(truth),
      observedAt: at,
    });
    caseFile.grade(trueClaim.id, { reliability: 'B', credibility: 2 });
    caseFile.grade(falseClaim.id, { reliability: 'B', credibility: 2 });

    const debrief = buildDebrief(endedWorld(world), truth, caseFile);
    expect(debrief.score.claimsTotal).toBe(2);
    expect(debrief.score.claimsTrue).toBe(1);
    expect(debrief.score.gradedTotal).toBe(2);
    expect(debrief.score.gradedCorrect).toBe(1);
    expect(debrief.score.gradingAccuracy).toBeCloseTo(0.5, 10);
  });

  it('reports zero grading accuracy when the player graded nothing', () => {
    const { world, truth } = game();
    const debrief = buildDebrief(endedWorld(world), truth, new CaseFile());
    expect(debrief.score.gradedTotal).toBe(0);
    expect(debrief.score.gradingAccuracy).toBe(0);
  });
});

function libraryPlot(predicate: string): PlotStateV2 {
  return {
    id: 'plot:test',
    templateId: 'test',
    displayName: 'Test',
    archetype: 'surveillance',
    role: 'primary',
    variantKey: 'test@1',
    cells: [],
    cutouts: [],
    bindings: {},
    roleHolders: {},
    knowledge: {},
    runtimeBranches: [],
    twist: { kind: 'false-flag', facadeStages: [], propositions: [predicate, 'NOT_HELD'] },
    outcomes: { success: [], failure: [] },
    offMap: [],
    stages: [],
    subPlots: [],
    standingPenalty: 0,
    standingReward: 0,
  };
}

describe('buildDebrief — library cells', () => {
  it('lists the cutouts of each cell', () => {
    const { world, truth } = game();
    const plot = {
      ...libraryPlot('HELD'),
      cells: [
        { org: 'org:a', spec: 'recon', security: 0.2, members: ['npc:ada', 'npc:bo'] },
        { org: 'org:b', spec: 'action', security: 0.2, members: ['npc:cy'] },
      ],
      cutouts: ['npc:bo'],
    };
    const debrief = buildDebrief({ ...endedWorld(world), plots: [plot] }, truth, new CaseFile());
    expect(debrief.plots?.[0]?.cells).toEqual([
      { name: 'recon', members: ['npc:ada', 'npc:bo'], cutouts: ['npc:bo'] },
      { name: 'action', members: ['npc:cy'], cutouts: [] },
    ]);
  });
});

describe('buildDebrief — library twist propositions', () => {
  it('marks a twist proposition held only when the case file has that predicate', () => {
    const { world, truth } = game();
    const prop = firstTrueFact(truth);
    const bare = prop.predicate.includes('/')
      ? prop.predicate.slice(prop.predicate.lastIndexOf('/') + 1)
      : prop.predicate;
    const caseFile = new CaseFile();
    caseFile.add({
      source: { kind: 'surveillance', loc: prop.place ?? ('loc:x' as never) },
      prop,
      observedAt: { day: 1, phase: 0 },
    });
    const ended = { ...endedWorld(world), plots: [libraryPlot(bare)] };
    const held = buildDebrief(ended, truth, caseFile);
    const empty = buildDebrief(ended, truth, new CaseFile());
    expect(held.plots?.[0]?.twist?.propositions).toEqual([
      { text: bare, heldInCaseFile: true },
      { text: 'NOT_HELD', heldInCaseFile: false },
    ]);
    expect(empty.plots?.[0]?.twist?.propositions[0]?.heldInCaseFile).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('Property 20: Debrief coherence and Outcome Record', () => {
  it('lists every plot, only the stages that happened, and a matching schema-2 record', () => {
    // Feature: plot-library, Property 20: Debrief coherence and Outcome Record
    const { world, truth } = game('debrief-property');
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            status: fc.constantFrom('pending' as const, 'executed' as const, 'disrupted' as const),
            offMap: fc.boolean(),
            facade: fc.boolean(),
          }),
          { minLength: 1, maxLength: 4 },
        ),
        fc.boolean(),
        fc.array(fc.stringMatching(/^[a-z]{4}$/), { minLength: 1, maxLength: 3 }),
        fc.constantFrom('disrupted' as const, 'succeeded' as const, undefined),
        fc.constantFrom('primary' as const, 'secondary' as const),
        (stages, withTwist, propositions, result, role) => {
          const plot: PlotStateV2 = {
            ...libraryPlot(propositions[0] ?? 'HELD'),
            templateId: 'one',
            variantKey: 'one@1',
            displayName: 'One',
            archetype: 'sabotage',
            role,
            stages: stages.map((stage, index) => ({
              id: `s${index}`,
              status: stage.status,
              deadlineDay: 1,
              offMap: stage.offMap,
              facade: stage.facade,
              roles: [],
            })),
            offMap: stages.flatMap((stage, index) => (stage.offMap ? [`s${index}`] : [])),
            ...(withTwist
              ? { twist: { kind: 'false-flag' as const, facadeStages: [], propositions } }
              : { twist: undefined }),
            ...(result === undefined
              ? { resolution: undefined }
              : { resolution: { result, at: { day: 1, phase: 0 as const }, by: 'stage-completed' } }),
          };
          const state: WorldState = {
            ...endedWorld(world),
            plots: [plot],
            meta: {
              ...world.meta,
              selection: { primary: plot.templateId, secondaries: [], historyHash: 'hash-one' },
            },
          };
          const debrief = buildDebrief(state, truth, new CaseFile());
          expect(debrief.plots?.map((item) => item.displayName)).toEqual([plot.displayName]);
          const told = debrief.plots?.[0]?.timeline.map((entry) => entry.stage) ?? [];
          const happened = plot.stages
            .filter((stage) => stage.status === 'executed' || stage.status === 'disrupted' || stage.offMap)
            .map((stage) => stage.id);
          expect(told).toEqual(happened);
          if (withTwist) {
            expect(debrief.plots?.[0]?.twist?.propositions.map((item) => item.text)).toEqual(propositions);
          } else {
            expect(debrief.plots?.[0]?.twist).toBeUndefined();
          }
          const record = buildOutcomeRecord(state, truth);
          expect(record.schema).toBe(2);
          expect(parseOutcomeRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
          expect(record.plots).toEqual([
            {
              templateId: plot.templateId,
              variantKey: plot.variantKey,
              archetype: plot.archetype,
              role: plot.role,
              outcome: plot.resolution?.result ?? 'unresolved',
            },
          ]);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('buildDebrief — determinism', () => {
  it('builds an identical debrief for the same ended world', () => {
    const { world, truth } = game('determinism-seed');
    const ended = endedWorld(world);
    const a = buildDebrief(ended, truth, new CaseFile());
    const b = buildDebrief(ended, truth, new CaseFile());
    expect(a).toEqual(b);
  });
});
