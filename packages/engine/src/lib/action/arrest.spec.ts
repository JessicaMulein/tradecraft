/**
 * Tests for the arrest action and the win/lose detector (task 20.1;
 * Requirements 19.1, 19.2, 19.3, 19.4, 19.5, 40.4).
 *
 * These drive a generated {@link WorldState} from the real core pack through the
 * arrest gate, the arrest resolver, the top-level {@link quote}, and the pure
 * {@link detectEnd} detector, checking:
 *
 * - the arrest gate passes/fails on the projected `evidenceCount` vs the preset
 *   `arrest.threshold`, and requires arrest authority (Req 19.1, 40.4);
 * - a Station arrest starts Station Custody on the target (design, "Turning");
 * - a wrongful arrest (arresting a non-hostile) applies the preset penalties —
 *   lost arrest authority and Standing, and (hard preset) a Cover Suspicion
 *   rise (Req 19.2, 19.3, 19.5);
 * - a correct arrest of the Cell leader ends the game in success (Req 19.4);
 * - win detection includes a Plot abort (Req 19.4) and the arrest leader win;
 * - lose detection on a completed Plot and a burned player (Req 19.3, 19.5);
 * - determinism and routing (arrest is no longer the not-implemented stub);
 * - slice-integration task 1.3: the arrest record (`player.arrests`), the
 *   materiel seized from an arrested carrier (`plot.materielSeized`), and
 *   `resolve` passing the arrest's End Condition through as `ended`.
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

import { TruthStore, type PredicateEvaluatorLookup } from '../truth/truth.js';
import type { Allegiance } from '../truth/truth.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { generate, type GenerateInputs } from '../generate.js';
import { asTruth, revealTruth, type LocId, type NpcId, type OrgId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { applyAbort } from '../clock/plot-abort.js';
import {
  detectEnd,
  endConditionFromAbort,
  leaderArrestEnd,
  LOSE_OUTCOME,
  WIN_OUTCOME,
} from '../endings/end-conditions.js';
import { createPrng } from '../prng/prng.js';
import type { StageTrace } from '../city/plot.js';
import { quote, resolve, visibleNpcsAt } from './action.js';
import {
  ARREST_LINE,
  ARREST_PHASE_COST,
  arrestEvidenceOf,
  arrestTargetIsHostile,
  carriesStageMateriel,
  isPlotLeader,
  quoteArrest,
  resolveArrest,
  resolveTargetNpc,
  stageInProgress,
  WRONGFUL_ALERTNESS_COVER_SUSPICION,
  WRONGFUL_ARREST_LINE,
  WRONGFUL_STANDING_PENALTY,
} from './arrest.js';
import type { Observation, ResolverContext } from './result.js';
import type { ArrestAction } from './types.js';

// ---------------------------------------------------------------------------
// Core-pack fixtures (mirrors turn-agent.spec.ts)
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
const HARD = preset('hard');

function inputs(p: DifficultyPreset = STANDARD): GenerateInputs {
  const scenario = ScenarioConfigSchema.parse({
    difficulty: { preset: p.id },
    mole: false,
    recruitment: {
      pitch: { w1: 1, w2: 1, w3: 1, w4: 1 },
      firstContact: { a: 1, b: 1, c: 1, d: 1 },
      meeting: { trust: 1, riskAversion: 1, scheduleConflict: 1, agendaInterest: 1 },
      exposure: { k1: 1, k2: 1, k3: 1 },
      turn: { w1: 1, w2: 1, w3: 1, w4: 1, w5: 1 },
    },
  });
  return { content, preset: p, scenario, cityData, descriptors, publicTexts };
}

function world(seed = 'arrest-alpha', p: DifficultyPreset = STANDARD): WorldState {
  return generate(seed, inputs(p));
}

/** A Truth Store that answers the allegiance predicates (kinds). */
function truth(): TruthStore {
  const lookup: PredicateEvaluatorLookup = {
    get: (predicate) =>
      predicate === 'IS_ALIAS_OF' ? ('alias' as EvaluatorKind) : undefined,
  };
  return TruthStore.create(lookup);
}

/** The render callback used in tests: observations to their lines/ids. */
function renderLines(_s: WorldState, obs: readonly Observation[]): string[] {
  return obs.map((o) => (o.kind === 'message' ? o.line : `prop:${o.prop.id}`));
}

/** A Location where at least one NPC is present this phase. */
function populatedLocation(state: WorldState): { loc: LocId; npcs: NpcId[] } {
  for (const loc of Object.keys(state.city.locations) as LocId[]) {
    const npcs = visibleNpcsAt(state, loc);
    if (npcs.length > 0) {
      return { loc, npcs };
    }
  }
  throw new Error('no populated Location in the generated world at this time');
}

/** The id of the org whose kind is `hostile` (the Hostile Service). */
function hostileOrgId(state: WorldState): OrgId {
  for (const org of Object.values(state.orgs)) {
    if (org.kind === 'hostile') {
      return org.id;
    }
  }
  throw new Error('no hostile org in the generated world');
}

/** The id of the player's own Station org (kind `station`). */
function stationOrgId(state: WorldState): OrgId {
  return state.station.org;
}

/**
 * Stage the player at a populated, open Location with the first present NPC,
 * give that NPC the given true allegiance, project an arrest-evidence count for
 * them, give the player arrest authority, and return the state, the NPC and a
 * resolver context.
 */
function staged(
  base: WorldState,
  trueOrg: OrgId,
  arrestEvidence: number,
  overrides: Partial<WorldState['player']> = {},
): { state: WorldState; npc: NpcId; ctx: ResolverContext } {
  const { loc, npcs } = populatedLocation(base);
  const npc = npcs[0];
  const state: WorldState = {
    ...base,
    npcs: {
      ...base.npcs,
      [npc]: { ...base.npcs[npc], trueAllegiance: asTruth<Allegiance>({ org: trueOrg }) },
    },
    player: { ...base.player, loc, arrestAuthority: 3, ...overrides },
    city: {
      ...base.city,
      locations: {
        ...base.city.locations,
        [loc]: {
          ...base.city.locations[loc],
          hours: { 0: true, 1: true, 2: true, 3: true },
        },
      },
    },
  };
  const ctx: ResolverContext = {
    content,
    truth: truth(),
    arrestEvidence: { [npc]: arrestEvidence },
  };
  return { state, npc, ctx };
}

// ---------------------------------------------------------------------------
// The arrest gate (Req 19.1, 40.4)
// ---------------------------------------------------------------------------

describe('arrest — the gate (Req 19.1, 40.4)', () => {
  it('is allowed when the projected evidence count reaches the threshold', () => {
    const base = world();
    const { state, npc, ctx } = staged(base, hostileOrgId(base), STANDARD.arrest.threshold);
    const q = quoteArrest(state, { kind: 'arrest', npc }, ctx);
    expect(q.allowed).toBe(true);
    expect(q.phases).toBe(ARREST_PHASE_COST);
    expect(q.money).toBe(0);
  });

  it('is not allowed when the evidence count is below the threshold', () => {
    const base = world();
    const { state, npc, ctx } = staged(base, hostileOrgId(base), STANDARD.arrest.threshold - 1);
    const q = quoteArrest(state, { kind: 'arrest', npc }, ctx);
    expect(q.allowed).toBe(false);
  });

  it('is not allowed with no projected evidence at all (count treated as 0)', () => {
    const base = world();
    const { loc, npcs } = populatedLocation(base);
    const npc = npcs[0];
    const state: WorldState = {
      ...base,
      player: { ...base.player, loc, arrestAuthority: 3 },
      city: {
        ...base.city,
        locations: {
          ...base.city.locations,
          [loc]: { ...base.city.locations[loc], hours: { 0: true, 1: true, 2: true, 3: true } },
        },
      },
    };
    const ctx: ResolverContext = { content, truth: truth() };
    expect(arrestEvidenceOf(ctx, npc)).toBe(0);
    expect(quoteArrest(state, { kind: 'arrest', npc }, ctx).allowed).toBe(false);
  });

  it('is not allowed with no arrest authority left', () => {
    const base = world();
    const { state, npc, ctx } = staged(base, hostileOrgId(base), STANDARD.arrest.threshold, {
      arrestAuthority: 0,
    });
    expect(quoteArrest(state, { kind: 'arrest', npc }, ctx).allowed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Station Custody (design, "Turning"; Req 36.1)
// ---------------------------------------------------------------------------

describe('arrest — Station Custody', () => {
  it('starts Station Custody on the target that ends after custodyPhases', () => {
    const base = world();
    const { state, npc, ctx } = staged(base, hostileOrgId(base), STANDARD.arrest.threshold);
    const { next } = resolveArrest(state, { kind: 'arrest', npc }, ctx, renderLines);

    const custody = next.relationships[npc]?.custody;
    expect(custody?.by).toBe('station');
    expect(custody?.since).toEqual(state.time);
    const phases = state.meta.scenario.custodyPhases;
    const sincePhases = state.time.day * 4 + state.time.phase;
    const untilPhases = sincePhases + phases;
    expect(custody?.until).toEqual({ day: Math.floor(untilPhases / 4), phase: untilPhases % 4 });
  });

  it('emits a hidden asset-arrested event for the target', () => {
    const base = world();
    const { state, npc, ctx } = staged(base, hostileOrgId(base), STANDARD.arrest.threshold);
    const { result } = resolveArrest(state, { kind: 'arrest', npc }, ctx, renderLines);
    const evt = result.events.find((e) => e.kind === 'asset-arrested');
    expect(evt).toBeDefined();
    expect(evt?.visibility).toBe('hidden');
  });
});

// ---------------------------------------------------------------------------
// Correct arrest (Req 19.2)
// ---------------------------------------------------------------------------

describe('arrest — a correct arrest (Req 19.2)', () => {
  it('leaves arrest authority and Standing untouched for a true hostile', () => {
    const base = world();
    const { state, npc, ctx } = staged(base, hostileOrgId(base), STANDARD.arrest.threshold);
    expect(arrestTargetIsHostile(state, npc)).toBe(true);
    const { next, result } = resolveArrest(state, { kind: 'arrest', npc }, ctx, renderLines);
    expect(next.player.arrestAuthority).toBe(state.player.arrestAuthority);
    expect(next.station.standing).toBe(state.station.standing);
    expect(result.factLines).toContain(ARREST_LINE);
  });

  it('treats a Cell member (org kind cell) as a correct arrest', () => {
    const base = world();
    const cellOrg = Object.values(base.orgs).find((o) => o.kind === 'cell');
    if (cellOrg === undefined) {
      throw new Error('no cell org in the generated world');
    }
    const { state, npc, ctx } = staged(base, cellOrg.id, STANDARD.arrest.threshold);
    expect(arrestTargetIsHostile(state, npc)).toBe(true);
    const { next } = resolveArrest(state, { kind: 'arrest', npc }, ctx, renderLines);
    expect(next.player.arrestAuthority).toBe(state.player.arrestAuthority);
  });
});

// ---------------------------------------------------------------------------
// Wrongful arrest penalties (Req 19.2, 19.3, 19.5)
// ---------------------------------------------------------------------------

describe('arrest — wrongful-arrest penalties (Req 19.2, 19.3, 19.5)', () => {
  it('reduces arrest authority and Standing when arresting a non-hostile', () => {
    const base = world();
    // The player's own side is not hostile — arresting them is wrongful.
    const { state, npc, ctx } = staged(base, stationOrgId(base), STANDARD.arrest.threshold);
    expect(arrestTargetIsHostile(state, npc)).toBe(false);
    const { next, result } = resolveArrest(state, { kind: 'arrest', npc }, ctx, renderLines);

    expect(next.player.arrestAuthority).toBe(
      state.player.arrestAuthority + STANDARD.arrest.wrongfulAuthorityPenalty,
    );
    expect(next.station.standing).toBe(state.station.standing - WRONGFUL_STANDING_PENALTY);
    // The Fact Line is identical in form to a correct arrest (no tell).
    expect(result.factLines).toContain(WRONGFUL_ARREST_LINE);
  });

  it('does not raise Cover Suspicion on the standard preset (no alertness)', () => {
    const base = world();
    const { state, npc, ctx } = staged(base, stationOrgId(base), STANDARD.arrest.threshold);
    expect(STANDARD.arrest.wrongfulRaisesAlertness).toBe(false);
    const { next } = resolveArrest(state, { kind: 'arrest', npc }, ctx, renderLines);
    expect(revealTruth(next.player.coverSuspicion)).toBe(revealTruth(state.player.coverSuspicion));
  });

  it('raises Cover Suspicion on the hard preset (wrongfulRaisesAlertness)', () => {
    const base = world('arrest-hard', HARD);
    expect(HARD.arrest.wrongfulRaisesAlertness).toBe(true);
    const { state, npc, ctx } = staged(base, stationOrgId(base), HARD.arrest.threshold);
    const { next } = resolveArrest(state, { kind: 'arrest', npc }, ctx, renderLines);
    expect(revealTruth(next.player.coverSuspicion)).toBeCloseTo(
      revealTruth(state.player.coverSuspicion) + WRONGFUL_ALERTNESS_COVER_SUSPICION,
      10,
    );
  });
});

// ---------------------------------------------------------------------------
// Win detection — the arrest leader win (Req 19.4)
// ---------------------------------------------------------------------------

describe('arrest — the leader-arrest win (Req 19.4)', () => {
  it('ends the game in success when the arrested target is the Cell leader', () => {
    const base = world();
    const { loc, npcs } = populatedLocation(base);
    const npc = npcs[0];
    const hostile = hostileOrgId(base);
    const state: WorldState = {
      ...base,
      npcs: {
        ...base.npcs,
        [npc]: { ...base.npcs[npc], trueAllegiance: asTruth<Allegiance>({ org: hostile }) },
      },
      plot: { ...base.plot, leader: asTruth(npc) },
      player: { ...base.player, loc, arrestAuthority: 3 },
      city: {
        ...base.city,
        locations: {
          ...base.city.locations,
          [loc]: { ...base.city.locations[loc], hours: { 0: true, 1: true, 2: true, 3: true } },
        },
      },
    };
    const ctx: ResolverContext = {
      content,
      truth: truth(),
      arrestEvidence: { [npc]: STANDARD.arrest.threshold },
    };
    expect(isPlotLeader(state, npc)).toBe(true);
    const { ended } = resolveArrest(state, { kind: 'arrest', npc }, ctx, renderLines);
    expect(ended?.outcome).toBe(WIN_OUTCOME);
    expect(ended?.cause).toBe('leader-arrested');
  });

  it('does not end the game arresting a hostile who is not the leader', () => {
    const base = world();
    const { state, npc, ctx } = staged(base, hostileOrgId(base), STANDARD.arrest.threshold);
    // The leader is some other NPC (not our target), so no leader win.
    if (revealTruth(base.plot.leader) === npc) {
      return; // in the rare case the first NPC is the leader, skip
    }
    const { ended } = resolveArrest(state, { kind: 'arrest', npc }, ctx, renderLines);
    expect(ended).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// The win/lose detector (Req 19.3, 19.4, 19.5)
// ---------------------------------------------------------------------------

describe('detectEnd — win/lose detection (Req 19.3, 19.4, 19.5)', () => {
  it('returns null while the game runs on', () => {
    expect(detectEnd(world())).toBeNull();
  });

  it('detects a Plot abort as a WIN (Req 19.4)', () => {
    const base = world();
    const aborted: WorldState = {
      ...base,
      plot: { ...base.plot, status: 'aborted', abortCause: 'pressure' },
    };
    const end = detectEnd(aborted);
    expect(end?.outcome).toBe(WIN_OUTCOME);
    expect(end?.cause).toBe('pressure');
  });

  it('agrees with the task-7.4 abort EndedIntent (Req 19.4)', () => {
    const base = world();
    const decision = applyAbort(base.plot, 'materiel-seized', base.time);
    const fromIntent = endConditionFromAbort(decision.ended);
    expect(fromIntent.outcome).toBe(WIN_OUTCOME);
    expect(fromIntent.cause).toBe('materiel-seized');

    const aborted: WorldState = { ...base, plot: decision.plot };
    const detected = detectEnd(aborted);
    expect(detected?.outcome).toBe(fromIntent.outcome);
    expect(detected?.cause).toBe(fromIntent.cause);
  });

  it('detects a completed Plot as a LOSE (Req 19.3)', () => {
    const base = world();
    const completed: WorldState = { ...base, plot: { ...base.plot, status: 'completed' } };
    const end = detectEnd(completed);
    expect(end?.outcome).toBe(LOSE_OUTCOME);
    expect(end?.cause).toBe('plot-completed');
  });

  it('detects a burned player as a LOSE (Req 19.5)', () => {
    const base = world();
    const burned: WorldState = { ...base, player: { ...base.player, burned: true } };
    const end = detectEnd(burned);
    expect(end?.outcome).toBe(LOSE_OUTCOME);
    expect(end?.cause).toBe('burned');
  });

  it('prefers the Plot-abort WIN over a coincident burn (priority order)', () => {
    const base = world();
    const both: WorldState = {
      ...base,
      plot: { ...base.plot, status: 'aborted', abortCause: 'leader-suspicion' },
      player: { ...base.player, burned: true },
    };
    expect(detectEnd(both)?.outcome).toBe(WIN_OUTCOME);
  });

  it('is idempotent once a game has ended', () => {
    const base = world();
    const ended: WorldState = {
      ...base,
      ended: { outcome: WIN_OUTCOME, at: base.time, cause: 'leader-arrested' },
    };
    expect(detectEnd(ended)).toEqual({
      outcome: WIN_OUTCOME,
      at: base.time,
      cause: 'leader-arrested',
    });
  });

  it('leaderArrestEnd is a WIN caused by leader-arrested', () => {
    const end = leaderArrestEnd({ day: 2, phase: 1 });
    expect(end).toEqual({ outcome: WIN_OUTCOME, at: { day: 2, phase: 1 }, cause: 'leader-arrested' });
  });
});

// ---------------------------------------------------------------------------
// Target resolution, determinism, routing
// ---------------------------------------------------------------------------

describe('arrest — resolution, determinism, routing', () => {
  it('resolves a unk: target through the Truth Store identity', () => {
    const base = world();
    const { npcs } = populatedLocation(base);
    const npc = npcs[0];
    const store = truth();
    store.setIdentity('unk:7', npc);
    const ctx: ResolverContext = { content, truth: store };
    expect(resolveTargetNpc('unk:7', ctx)).toBe(npc);
  });

  it('degrades to a no-op for an unresolvable unk: target', () => {
    const base = world();
    const ctx: ResolverContext = { content, truth: truth() };
    const { next, result } = resolveArrest(
      base,
      { kind: 'arrest', npc: 'unk:99' },
      ctx,
      renderLines,
    );
    expect(next).toBe(base);
    expect(result.factLines).toEqual([]);
  });

  it('is deterministic: the same inputs give the same result', () => {
    const base = world();
    const { state, npc, ctx } = staged(base, hostileOrgId(base), STANDARD.arrest.threshold);
    const a: ArrestAction = { kind: 'arrest', npc };
    const r1 = resolveArrest(state, a, ctx, renderLines);
    const r2 = resolveArrest(state, a, ctx, renderLines);
    expect(r1.next.relationships[npc]).toEqual(r2.next.relationships[npc]);
    expect(r1.result.factLines).toEqual(r2.result.factLines);
    expect(r1.ended).toEqual(r2.ended);
  });

  it('is routed by quote (no longer a not-implemented stub)', () => {
    const base = world();
    const { state, npc, ctx } = staged(base, hostileOrgId(base), STANDARD.arrest.threshold);
    const q = quote(state, { kind: 'arrest', npc }, ctx);
    expect(q.reason ?? '').not.toContain('not yet implemented');
  });
});

// ---------------------------------------------------------------------------
// The arrest record and the materiel carrier (slice-integration task 1.3)
// ---------------------------------------------------------------------------

/**
 * `state` with one trace carrying the Plot's materiel, its only participant
 * `carrier`, as the sole trace of stage `index`. Every stage is pending, every
 * other stage has no traces, and the first stage requires nothing, so the first
 * stage is the one in progress.
 */
function withMaterielCarrier(state: WorldState, carrier: NpcId, index: number): WorldState {
  const trace: StageTrace = {
    index: 0,
    kind: 'drop-emptied',
    participants: [carrier],
    materiel: revealTruth(state.plot.materiel),
    evidences: [],
    template: 'A courier collects the materiel from the drop.',
  };
  const stages = state.plot.stages.map((stage, i) => ({
    ...stage,
    status: 'pending' as const,
    requires: i === 0 ? [] : stage.requires,
    traces: i === index ? [trace] : [],
  }));
  return { ...state, plot: { ...state.plot, status: 'running', stages } };
}

describe('arrest — the Station arrest record (slice-integration Req 6.3)', () => {
  it('appends the arrested NPC to player.arrests, correct or wrongful', () => {
    const base = world();
    expect(base.player.arrests).toEqual([]);
    const correct = staged(base, hostileOrgId(base), STANDARD.arrest.threshold);
    const wrongful = staged(base, stationOrgId(base), STANDARD.arrest.threshold);
    const a = resolveArrest(correct.state, { kind: 'arrest', npc: correct.npc }, correct.ctx, renderLines);
    const b = resolveArrest(wrongful.state, { kind: 'arrest', npc: wrongful.npc }, wrongful.ctx, renderLines);
    expect(a.next.player.arrests).toEqual([correct.npc]);
    expect(b.next.player.arrests).toEqual([wrongful.npc]);
  });

  it('records a unk: target by the canonical NPC id it resolves to', () => {
    const base = world();
    const { state, npc } = staged(base, hostileOrgId(base), STANDARD.arrest.threshold);
    const store = truth();
    store.setIdentity('unk:7', npc);
    const ctx: ResolverContext = {
      content,
      truth: store,
      arrestEvidence: { 'unk:7': STANDARD.arrest.threshold },
    };
    const { next } = resolveArrest(state, { kind: 'arrest', npc: 'unk:7' }, ctx, renderLines);
    expect(next.player.arrests).toEqual([npc]);
  });
});

describe('arrest — materiel seized from an arrested carrier (slice-integration Req 4.4)', () => {
  it('sets plot.materielSeized when the NPC carries the materiel in the stage in progress', () => {
    const base = world();
    const { state, npc, ctx } = staged(base, hostileOrgId(base), STANDARD.arrest.threshold);
    const carrying = withMaterielCarrier(state, npc, 0);
    expect(stageInProgress(carrying.plot)?.id).toBe(carrying.plot.stages[0].id);
    expect(carriesStageMateriel(carrying.plot, npc)).toBe(true);
    expect(carrying.plot.materielSeized).toBe(false);

    const { next, result } = resolveArrest(carrying, { kind: 'arrest', npc }, ctx, renderLines);
    expect(next.plot.materielSeized).toBe(true);
    // The Plot is left running for the Day-Boundary abort check, and the Fact
    // Line is the plain arrest line (the seizure is no tell).
    expect(next.plot.status).toBe('running');
    expect(result.factLines).toEqual([ARREST_LINE]);
  });

  it('seizes nothing from the carrier of a later stage, or from a non-carrier', () => {
    const base = world();
    const { state, npc, ctx } = staged(base, hostileOrgId(base), STANDARD.arrest.threshold);
    const later = withMaterielCarrier(state, npc, 1);
    expect(stageInProgress(later.plot)?.id).toBe(later.plot.stages[0].id);
    expect(carriesStageMateriel(later.plot, npc)).toBe(false);
    expect(
      resolveArrest(later, { kind: 'arrest', npc }, ctx, renderLines).next.plot.materielSeized,
    ).toBe(false);

    const someoneElse = (Object.keys(base.npcs) as NpcId[]).find((id) => id !== npc) as NpcId;
    const otherCarrier = withMaterielCarrier(state, someoneElse, 0);
    expect(
      resolveArrest(otherCarrier, { kind: 'arrest', npc }, ctx, renderLines).next.plot
        .materielSeized,
    ).toBe(false);
  });

  it('has no stage in progress once the Plot has stopped running', () => {
    const base = world();
    const { state, npc } = staged(base, hostileOrgId(base), STANDARD.arrest.threshold);
    const carrying = withMaterielCarrier(state, npc, 0);
    const aborted = { ...carrying.plot, status: 'aborted' as const };
    expect(stageInProgress(aborted)).toBeUndefined();
    expect(carriesStageMateriel(aborted, npc)).toBe(false);
  });
});

describe('resolve — passes the arrest End Condition through (slice-integration Req 7.4)', () => {
  it('returns leader-arrested as ended and leaves WorldState.ended unwritten', () => {
    const base = world();
    const { state, npc, ctx } = staged(base, hostileOrgId(base), STANDARD.arrest.threshold);
    const leaderState: WorldState = { ...state, plot: { ...state.plot, leader: asTruth(npc) } };
    // An arrest is not gated by the Location (slice-integration task 2.4), so
    // the top-level `resolve` grants it with the real core pack.
    const out = resolve(leaderState, { kind: 'arrest', npc }, createPrng('arrest-resolve'), ctx);
    expect(out.ended).toEqual(leaderArrestEnd(leaderState.time));
    expect(out.next.ended).toBeUndefined();
    expect(out.next.player.arrests).toEqual([npc]);
  });

  it('returns no ended for an arrest that ends nothing, or a disallowed one', () => {
    const base = world();
    const staging = staged(base, hostileOrgId(base), STANDARD.arrest.threshold);
    const { npc, ctx } = staging;
    // Make sure the target is not the leader, so the arrest ends nothing.
    const leader = (Object.keys(base.npcs) as NpcId[]).find((id) => id !== npc) as NpcId;
    const state: WorldState = {
      ...staging.state,
      plot: { ...staging.state.plot, leader: asTruth(leader) },
    };
    const allowed = resolve(state, { kind: 'arrest', npc }, createPrng('a'), ctx);
    expect(allowed.next.player.arrests).toEqual([npc]);
    expect(allowed.ended).toBeUndefined();

    // With no arrest authority left the quote rejects it: state unchanged, no end.
    const powerless: WorldState = { ...state, player: { ...state.player, arrestAuthority: 0 } };
    const rejected = resolve(powerless, { kind: 'arrest', npc }, createPrng('a'), ctx);
    expect(rejected.next).toBe(powerless);
    expect(rejected.ended).toBeUndefined();
  });
});
