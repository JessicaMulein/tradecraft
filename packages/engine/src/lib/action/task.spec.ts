/**
 * Tests for the task action (slice-integration task 2.3; Requirements 10.1–10.7).
 *
 * These drive a generated {@link WorldState} from the real core pack through
 * `quoteTask` and `resolveTask`, with a small Truth Store built per test so the
 * collect candidates are known exactly. They check:
 *
 * - the quote allows a running Asset with a Contact Channel at 1 phase and no
 *   money, and refuses with one of the two fixed reasons otherwise, read from
 *   the Relationship flags alone (Req 10.1, 10.2);
 * - collect reports `npc`-sourced Observations from the facts since the last
 *   report, target first, through the access filter (including org access
 *   through Truth Store membership), replaced by Chickenfeed for a
 *   hostile-controlled Asset, and sets `lastReport` (Req 10.3);
 * - introduce mints the target's Contact Channel at the inherited trust
 *   (Req 10.4);
 * - service applies the collected and left items to one of the player's own
 *   drops and leaves any other drop alone (Req 10.5);
 * - plant schedules a hidden `belief-plant` at the next Day Boundary only when
 *   placed, with the same Fact Line either way (Req 10.6);
 * - every task adds `TASKING_EXPOSURE` to the Asset's Exposure (Req 10.7);
 * - through the top-level `quote`/`resolve` dispatch (task 2.6): every kind is
 *   allowed wherever the player stands, refusals keep their reasons whatever
 *   the Truth Store holds and leave the state as it was, and each kind's effect
 *   and the tasking Exposure come through `resolve`.
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

import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import {
  asTruth,
  revealTruth,
  type DeadDropId,
  type GameTime,
  type LocId,
  type NpcId,
  type OrgId,
  type Phase,
  type Proposition,
} from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { createPrng } from '../prng/prng.js';
import { TruthStore } from '../truth/truth.js';
import { selectChickenfeed } from '../hostile/doubling.js';
import {
  newRelationship,
  type AssetAccess,
  type AssetProfile,
  type Relationship,
} from '../recruit/asset.js';
import {
  INTRODUCTION_TRUST_SHARE,
  TASKING_EXPOSURE,
  type AssetTask,
} from '../recruit/tasking.js';
import { quote, renderFactLines, resolve } from './action.js';
import type { Observation, ResolverContext } from './result.js';
import type { TaskAction } from './types.js';
import {
  factsSinceLastReport,
  witnessedFacts,
  NO_CHANNEL_REASON,
  NOT_YOUR_ASSET_REASON,
  quoteTask,
  resolveTask,
  TASK_INTRODUCED_LINE,
  TASK_MONEY_COST,
  TASK_NO_INTRODUCTION_LINE,
  TASK_NO_SUCH_DROP_LINE,
  TASK_NOTHING_NEW_LINE,
  TASK_PHASE_COST,
  TASK_PLANTED_LINE,
  TASK_REPORT_LINE,
} from './task.js';
import { compareTime } from '../model/core.js';
import { CONTENT_WEEKDAYS, weekdayForDay } from '../city/time-mapping.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors pay.spec.ts)
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
  return { content, preset: preset('standard'), scenario, cityData, descriptors, publicTexts };
}

/** One generated world, shared: every test stages its own copy on top of it. */
const BASE: WorldState = generate('task-alpha', inputs());

const NPCS = (Object.keys(BASE.npcs) as NpcId[]).sort();
const ASSET = NPCS[0];
const TARGET = NPCS[1];
const OTHER = NPCS[2];
const STRANGER = NPCS[3];
const LOC = (Object.keys(BASE.city.locations) as LocId[]).sort()[0];
const ORG = 'org:task-test' as OrgId;

/** The player's own drop, and a drop that is not theirs. */
const OWN_DROP = BASE.player.known.drops[0];
const HOSTILE_DROP = (Object.keys(BASE.deadDrops) as DeadDropId[]).find(
  (id) => !BASE.player.known.drops.includes(id),
);

/** The time every staged world is set to. */
const NOW: GameTime = { day: 3, phase: 1 };

/** The render callback used in tests: Observations to their lines or ids. */
function renderLines(_s: WorldState, obs: readonly Observation[]): string[] {
  return obs.map((o) => (o.kind === 'message' ? o.line : `prop:${o.prop.id}`));
}

/** An Asset profile; by default fully reliable, honest, with access to the target. */
function profile(
  options: {
    reliability?: number;
    access?: Partial<AssetAccess>;
    hostileControlled?: boolean;
  } = {},
): AssetProfile {
  return {
    access: asTruth({ locs: [], orgs: [], npcs: [TARGET], ...options.access }),
    reliability: asTruth(options.reliability ?? 1),
    turned: false,
    hostileControlled: asTruth(options.hostileControlled ?? false),
  };
}

/** A running Asset with a Contact Channel. */
function assetRel(overrides: Partial<Relationship> = {}, prof = profile()): Relationship {
  return {
    ...newRelationship(ASSET),
    recruited: true,
    channel: true,
    trust: 0.6,
    exposure: 0.1,
    asset: prof,
    ...overrides,
  };
}

/** The base world at {@link NOW}, with the given Relationships staged on it. */
function staged(...rels: readonly Relationship[]): WorldState {
  const relationships = { ...BASE.relationships };
  for (const rel of rels) {
    relationships[rel.npc] = rel;
  }
  return { ...BASE, time: NOW, relationships };
}

/** A Truth Store holding exactly the given facts. */
function truthWith(facts: readonly Proposition[]): TruthStore {
  return TruthStore.from(content.predicates.evaluators, {
    facts,
    allegiances: new Map(),
    identities: new Map(),
    claimTruths: [],
  });
}

function fact(
  id: string,
  subject: NpcId,
  object: NpcId,
  window?: Proposition['window'],
): Proposition {
  return {
    id: `prop:task-test/${id}`,
    subject,
    predicate: 'MEETS_AT',
    object,
    place: LOC,
    ...(window === undefined ? {} : { window }),
  };
}

/** A standing fact about the target (no window). */
const STANDING = fact('standing', TARGET, OTHER);
/** A fact about the target that came into force on day 2. */
const RECENT = fact('recent', TARGET, OTHER, { from: { day: 2, phase: 0 } });
/** A fact about the target that comes into force on day 9 (after {@link NOW}). */
const FUTURE = fact('future', TARGET, OTHER, { from: { day: 9, phase: 0 } });
/** A fact outside the default access (neither party is the target). */
const ELSEWHERE = fact('elsewhere', STRANGER, OTHER);

const FACTS = [STANDING, RECENT, FUTURE, ELSEWHERE];

function task(t: AssetTask): TaskAction {
  return { kind: 'task', asset: ASSET, task: t };
}

const COLLECT = task({ kind: 'collect', target: TARGET });

/** The Propositions a result reports, with their sources. */
function reported(obs: readonly Observation[]): { id: string; source: unknown; at: GameTime }[] {
  return obs.flatMap((o) =>
    o.kind === 'proposition' ? [{ id: o.prop.id, source: o.source, at: o.at }] : [],
  );
}

function run(
  state: WorldState,
  a: TaskAction,
  ctx: ResolverContext = { content, truth: truthWith(FACTS) },
  seed = 'task',
) {
  return resolveTask(state, a, createPrng(seed), ctx, renderLines);
}

// ---------------------------------------------------------------------------
// Quote (Req 10.1, 10.2)
// ---------------------------------------------------------------------------

describe('task — quote (Req 10.1, 10.2)', () => {
  const kinds: AssetTask[] = [
    { kind: 'collect', target: TARGET },
    { kind: 'introduce', target: TARGET },
    { kind: 'service', drop: OWN_DROP },
    { kind: 'plant', prop: STANDING },
  ];

  it('allows every task kind for a running Asset with a Contact Channel, at 1 phase and no money', () => {
    const state = staged(assetRel());
    for (const t of kinds) {
      expect(quoteTask(state, task(t))).toEqual({
        allowed: true,
        phases: TASK_PHASE_COST,
        money: TASK_MONEY_COST,
      });
    }
    expect(TASK_PHASE_COST).toBe(1);
    expect(TASK_MONEY_COST).toBe(0);
  });

  it('refuses someone who is not the player\'s Asset', () => {
    const cases: WorldState[] = [
      staged(), // no Relationship at all
      staged({ ...newRelationship(ASSET), channel: true }), // never recruited
      staged(assetRel({ asset: undefined })), // recruited, but no Asset profile
    ];
    for (const state of cases) {
      const q = quoteTask(state, COLLECT);
      expect(q.allowed).toBe(false);
      expect(q.reason).toBe(NOT_YOUR_ASSET_REASON);
    }
  });

  it('refuses an Asset the player has no way to reach', () => {
    const q = quoteTask(staged(assetRel({ channel: false })), COLLECT);
    expect(q.allowed).toBe(false);
    expect(q.reason).toBe(NO_CHANNEL_REASON);
  });

  it('decides from the Relationship flags alone, never the hidden profile', () => {
    const profiles = [
      profile(),
      profile({ reliability: 0, hostileControlled: true }),
      profile({ access: { npcs: [], locs: [LOC], orgs: [ORG] } }),
    ];
    for (const flags of [{}, { channel: false }, { recruited: false }]) {
      const quotes = profiles.map((p) => quoteTask(staged(assetRel(flags, p)), COLLECT));
      for (const q of quotes) {
        expect(q).toEqual(quotes[0]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Collect (Req 10.3)
// ---------------------------------------------------------------------------

describe('task — collect (Req 10.3)', () => {
  it('reports in-access facts as npc-sourced Observations and sets lastReport', () => {
    const { next, result } = run(staged(assetRel()), COLLECT);

    // The future fact and the out-of-access fact are not reported.
    const source = { kind: 'npc', npc: ASSET };
    expect(reported(result.observations)).toEqual([
      { id: STANDING.id, source, at: NOW },
      { id: RECENT.id, source, at: NOW },
    ]);
    expect(result.claimsAdded).toEqual([STANDING.id, RECENT.id]);
    expect(result.factLines[0]).toBe(TASK_REPORT_LINE);
    expect(next.relationships[ASSET].lastReport).toEqual(NOW);
  });

  it('reports only the facts that came into force since the last report', () => {
    const state = staged(assetRel({ lastReport: { day: 1, phase: 0 } }));
    const { result } = run(state, COLLECT);
    expect(result.claimsAdded).toEqual([RECENT.id]);
  });

  it('has nothing new to report when nothing came into force since, and still counts as a report', () => {
    const state = staged(assetRel({ lastReport: { day: 2, phase: 1 } }));
    const { next, result } = run(state, COLLECT);
    expect(result.factLines).toEqual([TASK_NOTHING_NEW_LINE]);
    expect(result.claimsAdded).toEqual([]);
    expect(next.relationships[ASSET].lastReport).toEqual(NOW);
  });

  it('reports on the target first', () => {
    const aboutOther = [1, 2, 3].map((n) => fact(`other-${n}`, OTHER, STRANGER));
    const aboutTarget = fact('target', TARGET, STRANGER);
    const state = staged(assetRel({}, profile({ access: { npcs: [TARGET, OTHER] } })));
    const { result } = run(state, COLLECT, {
      content,
      truth: truthWith([...aboutOther, aboutTarget]),
    });
    // At most three are reported; the target's fact leads.
    expect(result.claimsAdded).toEqual([aboutTarget.id, aboutOther[0].id, aboutOther[1].id]);
  });

  it('reaches org access through Truth Store membership', () => {
    const member: Proposition = {
      id: 'prop:task-test/member',
      subject: STRANGER,
      predicate: 'MEMBER_OF',
      object: ORG,
    };
    const sighting = fact('member-seen', STRANGER, OTHER);
    const state = staged(assetRel({}, profile({ access: { npcs: [], orgs: [ORG] } })));
    const { result } = run(state, COLLECT, { content, truth: truthWith([member, sighting]) });
    expect(result.claimsAdded).toEqual([member.id, sighting.id]);
  });

  it('a hostile-controlled Asset reports the Hostile Service\'s Chickenfeed instead', () => {
    // At reliability 0 an honest report would be empty; the doubled Asset still
    // passes back the doctrine-sized Chickenfeed from its in-access candidates.
    const state = staged(assetRel({}, profile({ reliability: 0, hostileControlled: true })));
    const { next, result } = run(state, COLLECT);
    const expected = selectChickenfeed(BASE.hostile.doctrine, [
      { prop: STANDING },
      { prop: RECENT },
    ]).props.map((p) => p.id);
    expect(expected.length).toBeGreaterThan(0);
    expect(result.claimsAdded).toEqual(expected);
    for (const r of reported(result.observations)) {
      expect(r.source).toEqual({ kind: 'npc', npc: ASSET });
    }
    expect(next.relationships[ASSET].lastReport).toEqual(NOW);
  });

  it('ends a notified silence', () => {
    const state = staged(assetRel({ silenceNotified: true }));
    const { next } = run(state, COLLECT);
    expect('silenceNotified' in next.relationships[ASSET]).toBe(false);
  });

  it('reports nothing without a Truth Store, but still counts as a report', () => {
    const { next, result } = run(staged(assetRel()), COLLECT, { content });
    expect(result.factLines).toEqual([TASK_NOTHING_NEW_LINE]);
    expect(next.relationships[ASSET].lastReport).toEqual(NOW);
  });

  it('is deterministic for a seed', () => {
    const state = staged(assetRel({}, profile({ reliability: 0.5 })));
    const a = run(state, COLLECT, { content, truth: truthWith(FACTS) }, 'same');
    const b = run(state, COLLECT, { content, truth: truthWith(FACTS) }, 'same');
    expect(a).toEqual(b);
  });
});

describe('factsSinceLastReport', () => {
  const truth = truthWith(FACTS);
  const ids = (lastReport: GameTime | undefined) =>
    factsSinceLastReport(truth, lastReport, NOW).map((f) => revealTruth(f).id);

  it('covers everything in force by now on the first report', () => {
    expect(ids(undefined)).toEqual([STANDING.id, RECENT.id, ELSEWHERE.id]);
  });

  it('covers only what came into force after the last report later on', () => {
    expect(ids({ day: 1, phase: 3 })).toEqual([RECENT.id]);
    expect(ids({ day: 2, phase: 0 })).toEqual([]);
  });

  it('is empty without a Truth Store', () => {
    expect(factsSinceLastReport(undefined, undefined, NOW)).toEqual([]);
  });
});

describe('witnessedFacts', () => {
  /** The world with its first stage executed and the clock just past it. */
  function afterFirstStage(): { state: WorldState; loc: LocId; at: GameTime } {
    const stages = [...BASE.plot.stages].sort((a, b) => compareTime(a.deadline, b.deadline));
    const first = stages[0];
    const trace = first.traces.find(
      (t) => t.kind === 'meeting' && t.place?.kind === 'loc' && t.participants.length > 0,
    );
    if (trace === undefined || trace.place?.kind !== 'loc') {
      throw new Error('the fixture Plot has no located meeting in its first stage');
    }
    const plot = {
      ...BASE.plot,
      stages: BASE.plot.stages.map((st) =>
        st.id === first.id ? { ...st, status: 'executed' as const } : st,
      ),
    };
    const time = { day: first.deadline.day + 1, phase: 0 as const };
    return { state: { ...BASE, plot, time }, loc: trace.place.loc, at: first.deadline };
  }

  /** The base world with ASSET's routine on `at`'s weekday taking them to `loc`. */
  function regularAt(state: WorldState, loc: LocId, at: GameTime): WorldState {
    const weekday = CONTENT_WEEKDAYS.indexOf(weekdayForDay(at.day));
    const npc = state.npcs[ASSET];
    return {
      ...state,
      npcs: {
        ...state.npcs,
        [ASSET]: {
          ...npc,
          schedule: { ...npc.schedule, entries: [{ weekday, phase: 0, loc }] },
        },
      },
    };
  }

  it('reports what happened at a haunt on the day, stamped with the event time', () => {
    const { state, loc, at } = afterFirstStage();
    const facts = witnessedFacts(regularAt(state, loc, at), ASSET, undefined).map(revealTruth);
    expect(facts.length).toBeGreaterThan(0);
    for (const f of facts) {
      expect(f.place).toBe(loc);
      expect(f.window).toEqual({ from: at });
      expect(['LOCATED_AT', 'MEETS_AT']).toContain(f.predicate);
    }
  });

  it('sees nothing of a stage that has not executed, or at a place off the routine', () => {
    const { state, loc, at } = afterFirstStage();
    expect(witnessedFacts(regularAt(BASE, loc, at), ASSET, undefined)).toEqual([]);
    const elsewhere = (Object.keys(BASE.city.locations) as LocId[]).find((l) => l !== loc)!;
    const offRoutine = witnessedFacts(regularAt(state, elsewhere, at), ASSET, undefined)
      .map(revealTruth)
      .filter((f) => f.place === loc);
    expect(offRoutine).toEqual([]);
  });

  it('reports each event once: nothing since a report made after it', () => {
    const { state, loc, at } = afterFirstStage();
    const regular = regularAt(state, loc, at);
    expect(witnessedFacts(regular, ASSET, { day: at.day, phase: 3 })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Introduce (Req 10.4)
// ---------------------------------------------------------------------------

describe('task — introduce (Req 10.4)', () => {
  const INTRODUCE = task({ kind: 'introduce', target: TARGET });

  it('mints a Contact Channel to the target at the inherited trust', () => {
    const state = staged(assetRel({ trust: 0.6 }));
    expect(state.relationships[TARGET]).toBeUndefined();
    const { next, result } = run(state, INTRODUCE);

    const introduced = next.relationships[TARGET];
    expect(introduced.channel).toBe(true);
    expect(introduced.trust).toBeCloseTo(0.6 * INTRODUCTION_TRUST_SHARE, 10);
    expect(introduced.recruited).toBe(false);
    expect(next.player.contacts).toContain(TARGET);
    expect(next.player.known.entities).toContain(TARGET);
    expect(result.factLines).toEqual([TASK_INTRODUCED_LINE]);
  });

  it('keeps a higher trust the target already has', () => {
    const existing: Relationship = { ...newRelationship(TARGET), trust: 0.9 };
    const { next } = run(staged(assetRel({ trust: 0.6 }), existing), INTRODUCE);
    expect(next.relationships[TARGET].channel).toBe(true);
    expect(next.relationships[TARGET].trust).toBe(0.9);
  });

  it('cannot introduce someone who does not exist', () => {
    const state = staged(assetRel());
    const nobody = 'npc:task-test/nobody' as NpcId;
    const { next, result } = run(state, task({ kind: 'introduce', target: nobody }));
    expect(result.factLines).toEqual([TASK_NO_INTRODUCTION_LINE]);
    expect(next.relationships[nobody]).toBeUndefined();
    expect(next.player.contacts).toEqual(state.player.contacts);
  });
});

// ---------------------------------------------------------------------------
// Service (Req 10.5)
// ---------------------------------------------------------------------------

describe('task — service (Req 10.5)', () => {
  it('applies the collected and left items to one of the player\'s own drops', () => {
    expect(OWN_DROP).toBeDefined();
    const state = staged(assetRel());
    const { next, result } = resolveTask(
      state,
      task({ kind: 'service', drop: OWN_DROP, leave: ['item:task-test/pad'] }),
      createPrng('service'),
      { content, truth: truthWith(FACTS) },
      renderLines,
      { dropContents: [asTruth(STANDING), asTruth(ELSEWHERE)] },
    );

    // The collected item in the Asset's access is reported, sourced to it.
    expect(reported(result.observations)).toEqual([
      { id: STANDING.id, source: { kind: 'npc', npc: ASSET }, at: NOW },
    ]);
    expect(result.claimsAdded).toEqual([STANDING.id]);
    // The left item is now in the drop.
    expect(next.deadDrops[OWN_DROP].contents).toEqual([
      ...state.deadDrops[OWN_DROP].contents,
      'item:task-test/pad',
    ]);
    const loaded = result.events.find((e) => e.kind === 'drop-loaded');
    expect(loaded).toMatchObject({ drop: OWN_DROP, by: ASSET, visibility: 'hidden' });
  });

  it('collects nothing by default: slice drop items carry no Propositions', () => {
    const { result } = run(staged(assetRel()), task({ kind: 'service', drop: OWN_DROP }));
    expect(reported(result.observations)).toEqual([]);
    expect(result.claimsAdded).toEqual([]);
  });

  it('leaves a drop that is not the player\'s alone', () => {
    expect(HOSTILE_DROP).toBeDefined();
    const drop = HOSTILE_DROP as DeadDropId;
    const state = staged(assetRel());
    const { next, result } = run(
      state,
      task({ kind: 'service', drop, leave: ['item:task-test/pad'] }),
    );
    expect(next.deadDrops[drop]).toBe(state.deadDrops[drop]);
    expect(result.factLines).toEqual([TASK_NO_SUCH_DROP_LINE]);
    expect(result.events).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Plant (Req 10.6)
// ---------------------------------------------------------------------------

describe('task — plant (Req 10.6)', () => {
  const PLANT = task({ kind: 'plant', prop: STANDING, at: LOC });

  it('schedules a placed plant as a hidden belief-plant at the next Day Boundary', () => {
    const truth = truthWith(FACTS);
    const state = staged(assetRel());
    const { next, result } = run(state, PLANT, { content, truth });

    const plants = next.scheduled.filter((e) => e.kind === 'belief-plant');
    expect(plants).toHaveLength(1);
    expect(plants[0]).toMatchObject({
      kind: 'belief-plant',
      visibility: 'hidden',
      at: { day: NOW.day + 1, phase: 0 },
      prop: STANDING,
      by: ASSET,
      loc: LOC,
    });
    expect(next.scheduled).toHaveLength(state.scheduled.length + 1);
    expect(result.factLines).toEqual([TASK_PLANTED_LINE]);
    // Planting a lead does not make it true.
    expect(truth.facts()).toHaveLength(FACTS.length);
  });

  it('schedules nothing when the Asset muffs the plant, with the same Fact Line', () => {
    const state = staged(assetRel({}, profile({ reliability: 0 })));
    const { next, result } = run(state, PLANT);
    expect(next.scheduled).toBe(state.scheduled);
    expect(result.factLines).toEqual([TASK_PLANTED_LINE]);
  });
});

// ---------------------------------------------------------------------------
// Exposure (Req 10.7)
// ---------------------------------------------------------------------------

describe('task — Exposure (Req 10.7)', () => {
  it('adds TASKING_EXPOSURE to the Asset for every task, whatever its outcome', () => {
    const tasks: AssetTask[] = [
      { kind: 'collect', target: TARGET },
      { kind: 'introduce', target: TARGET },
      { kind: 'introduce', target: 'npc:task-test/nobody' as NpcId },
      { kind: 'service', drop: OWN_DROP, leave: ['item:task-test/pad'] },
      { kind: 'service', drop: HOSTILE_DROP as DeadDropId },
      { kind: 'plant', prop: STANDING },
    ];
    for (const reliability of [0, 1]) {
      const state = staged(assetRel({ exposure: 0.1 }, profile({ reliability })));
      for (const t of tasks) {
        const { next } = run(state, task(t));
        expect(next.relationships[ASSET].exposure).toBeCloseTo(0.1 + TASKING_EXPOSURE, 10);
        // Tasking costs no money.
        expect(next.station.ledger).toBe(state.station.ledger);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Through the top-level quote/resolve dispatch (Req 10.1, 10.2, 10.7; task 2.6)
// ---------------------------------------------------------------------------

describe('task through the top-level quote and resolve', () => {
  /** The render callback the top-level resolver hands each kind. */
  function render(state: WorldState, obs: readonly Observation[]): string[] {
    return renderFactLines(content, state, obs);
  }

  /** One task of each kind, against the staged fixtures. */
  const kinds: readonly AssetTask[] = [
    { kind: 'collect', target: TARGET },
    { kind: 'introduce', target: TARGET },
    { kind: 'service', drop: OWN_DROP, leave: ['item:task-test/pad'] },
    { kind: 'plant', prop: STANDING, at: LOC },
  ];

  const PHASES: readonly Phase[] = [0, 1, 2, 3];

  it('allows every task kind wherever the player stands, for 1 phase and no money (Req 10.1)', () => {
    const base = staged(assetRel());
    const ctx: ResolverContext = { content, truth: truthWith(FACTS) };
    // A task runs over the Contact Channel, not at a Location, so neither a
    // Location Type's allowed actions nor its opening hours can refuse it.
    for (const loc of (Object.keys(base.city.locations) as LocId[]).sort()) {
      for (const phase of PHASES) {
        const there: WorldState = {
          ...base,
          time: { ...base.time, phase },
          player: { ...base.player, loc },
        };
        for (const t of kinds) {
          expect(quote(there, task(t), ctx), `${t.kind} at ${loc} phase ${phase}`).toEqual({
            allowed: true,
            phases: TASK_PHASE_COST,
            money: TASK_MONEY_COST,
          });
        }
      }
    }
  });

  it('refuses a non-Asset or an unreachable Asset with its reason, whatever the Truth Store holds, leaving the state as it was (Req 10.2)', () => {
    // The refusal reason must not depend on ground truth: a world with facts
    // and one without must refuse identically.
    const truths: readonly (ResolverContext['truth'] | undefined)[] = [
      undefined,
      truthWith([]),
      truthWith(FACTS),
    ];
    const refusals: readonly (readonly [WorldState, string])[] = [
      [staged(), NOT_YOUR_ASSET_REASON], // no Relationship
      [staged({ ...newRelationship(ASSET), channel: true }), NOT_YOUR_ASSET_REASON], // not recruited
      [staged(assetRel({ asset: undefined })), NOT_YOUR_ASSET_REASON], // no profile
      [staged(assetRel({ channel: false })), NO_CHANNEL_REASON], // no Channel
    ];
    for (const [state, reason] of refusals) {
      for (const truth of truths) {
        const ctx: ResolverContext = truth === undefined ? { content } : { content, truth };
        const q = quote(state, COLLECT, ctx);
        expect(q).toEqual({ allowed: false, reason, phases: 0, money: 0 });
        const out = resolve(state, COLLECT, createPrng('task-refused'), ctx);
        expect(out.next).toBe(state);
        expect(out.result.observations).toEqual([]);
        expect(out.result.factLines).toEqual([]);
        expect(out.ended).toBeUndefined();
      }
    }
  });

  it('routes an allowed task to the task resolver, applying its effect and the tasking Exposure (Req 10.3–10.7)', () => {
    const rel = assetRel({ exposure: 0.1 });
    const base = staged(rel);
    const ctx: ResolverContext = { content, truth: truthWith(FACTS) };
    for (const t of kinds) {
      const a = task(t);
      // The top-level resolve is exactly the task resolver's result, with the
      // Fact Lines rendered through the core pack's templates.
      const top = resolve(base, a, createPrng(`task-top-${t.kind}`), ctx);
      const direct = resolveTask(base, a, createPrng(`task-top-${t.kind}`), ctx, render);
      expect(top.next, t.kind).toEqual(direct.next);
      expect(top.result, t.kind).toEqual(direct.result);
      // Every task adds the tasking Exposure to the Asset (Req 10.7).
      expect(top.next.relationships[ASSET].exposure, t.kind).toBeCloseTo(
        rel.exposure + TASKING_EXPOSURE,
        10,
      );
      // No money moves, the clock is left to the Turn Pipeline, and no end.
      expect(top.next.station.ledger, t.kind).toBe(base.station.ledger);
      expect(top.next.time, t.kind).toEqual(base.time);
      expect(top.ended, t.kind).toBeUndefined();
    }
  });

  it('reaches the collect, introduce, service and plant effects through resolve', () => {
    const ctx: ResolverContext = { content, truth: truthWith(FACTS) };

    // collect: npc-sourced Claims from the facts since the last report.
    const collected = resolve(staged(assetRel()), COLLECT, createPrng('top-collect'), ctx);
    expect(collected.result.claimsAdded).toEqual([STANDING.id, RECENT.id]);
    expect(collected.next.relationships[ASSET].lastReport).toEqual(NOW);

    // introduce: a Contact Channel to the target at the inherited trust.
    const introduced = resolve(
      staged(assetRel({ trust: 0.6 })),
      task({ kind: 'introduce', target: TARGET }),
      createPrng('top-introduce'),
      ctx,
    );
    expect(introduced.next.relationships[TARGET].channel).toBe(true);
    expect(introduced.next.player.contacts).toContain(TARGET);

    // service: the left item lands in one of the player's own drops.
    const base = staged(assetRel());
    const serviced = resolve(
      base,
      task({ kind: 'service', drop: OWN_DROP, leave: ['item:task-test/pad'] }),
      createPrng('top-service'),
      ctx,
    );
    expect(serviced.next.deadDrops[OWN_DROP].contents).toEqual([
      ...base.deadDrops[OWN_DROP].contents,
      'item:task-test/pad',
    ]);

    // plant: a placed plant scheduled as a hidden belief-plant.
    const planted = resolve(
      staged(assetRel()),
      task({ kind: 'plant', prop: STANDING, at: LOC }),
      createPrng('top-plant'),
      ctx,
    );
    expect(planted.next.scheduled.some((e) => e.kind === 'belief-plant')).toBe(true);
  });
});
