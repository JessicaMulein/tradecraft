/**
 * The arrest action (design, "Action Resolver" → **arrest** "as specified in …
 * the Arrest Evidence … section"; design, "Arrest Evidence": the arrest gate;
 * Requirements 19.1, 19.2, 19.3, 19.4, 19.5, 40.4). Task 20.1, with the arrest
 * record and the materiel seizure added by slice-integration task 1.3.
 *
 * `{ kind:'arrest'; npc: NpcId | UnkId }` — the player moves to arrest a person
 * they believe is part of the hostile Cell. Two pure functions:
 *
 * ## Quote — the arrest gate (Req 19.1, 40.4)
 *
 * {@link quoteArrest} grants an arrest only when the Case File holds at least
 * the preset's `arrest.threshold` **corroborated Implicating Claims** against
 * the target, and the player has arrest authority left. The count is
 * `evidenceCount(cf, target, …)` (task 4.7) — a pure Player-View figure the
 * engine resolver cannot compute (the Case File is a view-side store), so the
 * Turn Pipeline projects it per target into {@link ResolverContext.arrestEvidence}
 * exactly as it projects `turnEvidence` for the turn-agent action. The gate
 * reads only that projected count and the player's `arrestAuthority`, both
 * Player-View data, so an allowed/disallowed answer never reveals ground truth.
 * `evidenceCount` already counts distinct corroborated Implicating Claims
 * (Req 40.4), so the gate is a plain `count ≥ threshold` comparison.
 *
 * ## Resolve — custody, penalties and end detection (Req 19.2–19.5)
 *
 * {@link resolveArrest} applies the arrest. The gate guarantees sufficient
 * evidence, so the arrest *proceeds*; whether it was **correct** or **wrongful**
 * is ground truth the resolver reads from the Truth Store:
 *
 * - A **Station arrest starts Station Custody** on the target's
 *   {@link Relationship} (`custody = { by:'station', since: now, until: now +
 *   custodyPhases }`, the scenario's `custodyPhases`), so the detained person
 *   can be turned while held and is handed over when custody ends (design,
 *   "Turning"; Req 36.1). An `asset-arrested` event records the hidden arrest.
 * - A **correct arrest** — the target's *true* allegiance is the Hostile Service
 *   or the Cell — advances toward a win (Req 19.2); arresting the **Cell
 *   leader** disrupts the operation and ends the game in success
 *   (`leader-arrested`, Req 19.4).
 * - A **wrongful arrest** — the target is *not* a true hostile (an innocent, or
 *   the player's own side) — incurs the preset's penalties (Req 19.2, 19.3):
 *   the player's `arrestAuthority` falls by the preset's wrongful-arrest penalty
 *   magnitude, Standing drops ({@link WRONGFUL_STANDING_PENALTY}), and on the
 *   hard preset (`wrongfulRaisesAlertness`) the player's Cover Suspicion rises,
 *   a step toward being burned and losing (Req 19.5).
 *
 * ## The arrest record and end detection (slice-integration Req 6.3, 7.4)
 *
 * Every granted arrest is recorded: the target's **canonical {@link NpcId}**
 * is appended to `player.arrests`, the Station's standing arrest record, in the
 * order the arrests were granted. A `unk:` target is recorded by the NPC its
 * identity resolves to, not by the `unk:` id, so the record names one id per
 * person however the player referred to them. The Objective Evaluator decides
 * `arrest` Directive objectives from this record (Req 6.3), and
 * {@link detectEnd} reads it, alongside Station Custody, as the standing
 * `leader-arrested` condition (Req 7.4, 7.8). The record outlives the custody
 * hold, so the win stands after the leader has been handed over.
 *
 * The resolver returns an optional {@link EndCondition} when the arrest ends the
 * game, which the top-level `resolve` passes through as `{ next, result,
 * ended? }` and the Turn Pipeline writes to `WorldState.ended` (the same seam
 * the service-drop resolver uses for a materiel-seizure abort). A correct arrest
 * of the Cell leader returns {@link leaderArrestEnd}; otherwise the resolver
 * returns whatever {@link detectEnd} reports on the next state. Because the
 * arrest puts the target in Station Custody and in the arrest record, the
 * detector reports `leader-arrested` for any Station arrest of the leader, so
 * the resolver and the detector always agree.
 *
 * ## Materiel seized from an arrested carrier (slice-integration Req 4.4)
 *
 * When the arrested NPC is carrying the operation's materiel, the materiel is
 * seized with them: the resolver sets `plot.materielSeized`, which the live
 * Disruption Context reports as `isMaterielSeized()`. The World State has no NPC
 * inventory, so "carrying" is read from the Plot ({@link carriesStageMateriel}):
 * the NPC is a bound participant of a trace that carries the Plot's materiel
 * (`trace.materiel` is `plot.materiel`) in the **stage in progress**
 * ({@link stageInProgress}), the first `pending` stage in DAG order whose
 * prerequisites have all been produced. That is the stage the operation is
 * working toward, so its carriers are the people moving the materiel now. The
 * carrier of a later stage does not hold it yet, and the participants of a
 * trace that carries some other item (a courier pouch, forged papers) are not
 * carrying the operation's materiel. "The materiel" is `plot.materiel`
 * throughout, the same item a `seize` of a hostile drop must take
 * (`seizedContentsAreMateriel`, `./service-drop.ts`), so both seizure paths set
 * the flag for the same item.
 *
 * The flag is set whether the arrest is correct or wrongful, because the
 * materiel is in Station hands either way. The arrest plays the same Fact Line
 * as any other arrest, so the seizure tells the player nothing about the
 * target. The resolver does not abort the Plot itself. The abort check that the
 * Day-Boundary Hooks run reads the flag and aborts with `materiel-seized`
 * (Req 4.5), and {@link detectEnd} then reports the win.
 *
 * Determinism: the resolver draws nothing. The custody times are computed from
 * the clock; the correct/wrongful branch reads ground truth but takes no coin,
 * so the same state and target always yield the same result. Fact Line
 * rendering is left to the caller's `render` callback, so this module never
 * imports `./action.ts` and no import cycle forms.
 */

import {
  asTruth,
  revealTruth,
  timeToPhases,
  type GameTime,
  type LocId,
  type NpcId,
  type OrgId,
  type PropId,
  type UnkId,
} from '../model/core.js';
import type { SimEvent, WorldState } from '../model/state.js';
import { scheduledLocation } from '../city/npc.js';
import type { PlotState, StageState } from '../city/plot.js';
import { CONTENT_WEEKDAYS, weekdayForDay } from '../city/time-mapping.js';
import { newRelationship, type Custody, type Relationship } from '../recruit/asset.js';
import {
  detectEnd,
  leaderArrestEnd,
  type EndCondition,
} from '../endings/end-conditions.js';
import type { ActionQuote, ActionResult, Observation, ResolverContext } from './result.js';
import type { ArrestAction } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The phase cost of an arrest: the move and booking consume the current phase. */
export const ARREST_PHASE_COST = 1;

/**
 * The Standing a wrongful arrest costs (design, "Station, Directives and
 * Budget": "−2 per wrongful arrest"). Applied on top of the preset's authority
 * penalty, which is a separate dimension.
 */
export const WRONGFUL_STANDING_PENALTY = 2;

/**
 * The Cover Suspicion a wrongful arrest adds on a preset whose
 * `wrongfulRaisesAlertness` is set (the hard preset). A modest step that, taken
 * repeatedly, drives the player toward the burn threshold and a loss (Req 19.5).
 */
export const WRONGFUL_ALERTNESS_COVER_SUSPICION = 0.1;

/** The Fact Line a correct arrest plays. */
export const ARREST_LINE = 'You make the arrest. They are taken into custody.';

/**
 * The Fact Line a wrongful arrest plays. It is **identical in form** to a
 * correct arrest's line — the player does not learn from the Fact Line whether
 * the person was really hostile; the consequences (lost authority, Standing)
 * surface through the Station, not a tell in the scene text.
 */
export const WRONGFUL_ARREST_LINE =
  'You make the arrest. They are taken into custody.';

// ---------------------------------------------------------------------------
// Local helpers (kept local to avoid an action.ts import cycle)
// ---------------------------------------------------------------------------

/**
 * The NPCs scheduled at a Location at the current time, by id in deterministic
 * order. A local copy of `./action.ts`'s `visibleNpcsAt` so this module does
 * not import `./action.ts` (which imports *this* module to route the action)
 * and form a cycle — the same local-helper pattern `./pay.ts`/`./turn-agent.ts`
 * use.
 */
function npcsScheduledAt(state: WorldState, locId: LocId): NpcId[] {
  const weekday = CONTENT_WEEKDAYS.indexOf(weekdayForDay(state.time.day));
  const out: NpcId[] = [];
  for (const npc of Object.values(state.npcs)) {
    if (scheduledLocation(npc.schedule, weekday, state.time.phase) === locId) {
      out.push(npc.id);
    }
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/** The scene descriptor for a Location, built locally to avoid an action.ts cycle. */
function sceneDescriptorAt(state: WorldState, loc: LocId): ActionResult['scene'] {
  const place = state.city.locations[loc];
  if (place === undefined) {
    return { loc, description: '', atmosphere: [], risk: 0, visible: [] };
  }
  return {
    loc,
    description: place.description,
    atmosphere: [...place.atmosphere],
    risk: place.risk,
    visible: npcsScheduledAt(state, loc),
  };
}

/** Add `phases` to a {@link GameTime}, carrying into the day counter. */
function addPhases(at: GameTime, phases: number): GameTime {
  const total = timeToPhases(at) + Math.max(0, Math.trunc(phases));
  return { day: Math.floor(total / 4), phase: (total % 4) as GameTime['phase'] };
}

// ---------------------------------------------------------------------------
// Target resolution (view-side id → canonical NpcId)
// ---------------------------------------------------------------------------

/**
 * Resolve an arrest target id to the canonical {@link NpcId} the ground-truth
 * reads need. A target may be given as a real `npc:` id or an Unidentified
 * Subject `unk:` id; a `unk:` id resolves through the Truth Store's
 * `identityOf`. Returns `undefined` when the id is a `unk:` with no recorded
 * identity (an unresolvable target) or the Truth Store is absent — the resolver
 * then cannot read ground truth and degrades to a no-op.
 */
export function resolveTargetNpc(
  target: NpcId | UnkId,
  ctx: ResolverContext,
): NpcId | undefined {
  if (!target.startsWith('unk:')) {
    return target as NpcId;
  }
  const identity = ctx.truth?.identityOf(target as UnkId);
  return identity === undefined ? undefined : revealTruth(identity);
}

/** The arrest-evidence count the Turn Pipeline projected for a target (0 if none). */
export function arrestEvidenceOf(ctx: ResolverContext, target: NpcId | UnkId): number {
  return ctx.arrestEvidence?.[target] ?? 0;
}

/** The preset's arrest-evidence threshold the gate compares against (Req 19.1). */
export function arrestThresholdOf(state: WorldState): number {
  return state.meta.preset.arrest.threshold;
}

/**
 * Whether a resolved NPC's *true* allegiance is to a hostile organisation — the
 * Hostile Service or the Cell (org kinds `hostile` / `cell`). A correct arrest
 * targets such a person; a wrongful arrest targets anyone else (the player's own
 * side or an innocent). Reads the branded true allegiance deliberately: the
 * arrest resolver is a Sim operation and only its *consequences* (custody, lost
 * authority, an end condition) cross toward the Player View, never the raw
 * allegiance. Returns `false` for an NPC with no recorded true allegiance or an
 * allegiance to an org the world does not define.
 */
export function arrestTargetIsHostile(state: WorldState, npc: NpcId): boolean {
  const record = state.npcs[npc]?.trueAllegiance;
  if (record === undefined) {
    return false;
  }
  const org = revealTruth(record).org;
  return orgIsHostile(state, org);
}

/** Whether an org id names a hostile organisation (kind `hostile` or `cell`). */
function orgIsHostile(state: WorldState, org: OrgId): boolean {
  const kind = state.orgs[org]?.kind;
  return kind === 'hostile' || kind === 'cell';
}

/** Whether the resolved NPC is the Plot's true Cell leader. */
export function isPlotLeader(state: WorldState, npc: NpcId): boolean {
  return revealTruth(state.plot.leader) === npc;
}

// ---------------------------------------------------------------------------
// The materiel carrier (slice-integration Req 4.4)
// ---------------------------------------------------------------------------

/**
 * The Plot Stage in progress: the first `pending` stage, in DAG (array) order,
 * whose `requires` have all been produced by `executed` stages. It is the stage
 * the operation is working toward, and the next one the clock runs once its
 * deadline day comes (the clock's due-stage choice adds only the deadline gate).
 * Returns `undefined` when the Plot is not `running`, or when no pending stage
 * has its prerequisites met (every stage has run, or the chain is blocked
 * behind a disrupted stage). Pure: reads the Plot, draws nothing.
 */
export function stageInProgress(plot: PlotState): StageState | undefined {
  if (plot.status !== 'running') {
    return undefined;
  }
  const produced = new Set<PropId>();
  for (const stage of plot.stages) {
    if (stage.status === 'executed') {
      for (const prop of stage.produces) {
        produced.add(prop);
      }
    }
  }
  return plot.stages.find(
    (stage) =>
      stage.status === 'pending' && stage.requires.every((req) => produced.has(req)),
  );
}

/**
 * Whether `npc` is carrying the stage's materiel (slice-integration Req 4.4):
 * they are a bound participant of a trace of the {@link stageInProgress} that
 * carries the Plot's materiel (`trace.materiel` equals `plot.materiel`). A
 * trace's bound participants are the role holders generation resolved, the
 * same set the clock's disruption check scopes a stage to, so an unbound role
 * carries nothing. Reads the Plot's ground-truth materiel: this is a Sim
 * decision, and only its consequence (`plot.materielSeized`) is recorded.
 * Pure: draws nothing.
 */
export function carriesStageMateriel(plot: PlotState, npc: NpcId): boolean {
  const stage = stageInProgress(plot);
  if (stage === undefined) {
    return false;
  }
  const materiel = revealTruth(plot.materiel);
  return stage.traces.some(
    (trace) => trace.materiel === materiel && trace.participants.includes(npc),
  );
}

// ---------------------------------------------------------------------------
// Quote — the arrest gate (Req 19.1, 40.4)
// ---------------------------------------------------------------------------

/**
 * Quote an {@link ArrestAction} (pure, no draws; the arrest gate). The arrest is
 * allowed only when:
 *
 * - the player has arrest authority left (`arrestAuthority > 0`); and
 * - the projected arrest-evidence count for the target is at least the preset's
 *   `arrest.threshold` ({@link arrestEvidenceOf} ≥ {@link arrestThresholdOf}).
 *
 * Both are Player-View figures (the view-side `evidenceCount` and the player's
 * own authority), so the gate reveals no ground truth (design: "`quote` decides
 * eligibility … from Player View and Case File data only"). The cost is
 * {@link ARREST_PHASE_COST} phases and no money. An arrest is a request the
 * Station's officers carry out, not an action at the player's Location, so it
 * has no `actionLocation` and the shared Location gate in `./action.ts` does
 * not apply: these two checks are the whole gate, as the design states.
 */
export function quoteArrest(
  state: WorldState,
  a: ArrestAction,
  ctx: ResolverContext,
): ActionQuote {
  if (state.player.arrestAuthority <= 0) {
    return {
      allowed: false,
      reason: 'you have no arrest authority left',
      phases: 0,
      money: 0,
    };
  }
  const evidence = arrestEvidenceOf(ctx, a.npc);
  const threshold = arrestThresholdOf(state);
  if (evidence < threshold) {
    return {
      allowed: false,
      reason: `an arrest needs ${threshold} corroborated implicating Claims; you hold ${evidence}`,
      phases: 0,
      money: 0,
    };
  }
  return { allowed: true, phases: ARREST_PHASE_COST, money: 0 };
}

// ---------------------------------------------------------------------------
// Resolve — custody, penalties, end detection (Req 19.2–19.5)
// ---------------------------------------------------------------------------

/**
 * The result of an arrest: the next {@link WorldState}, the {@link ActionResult},
 * and the {@link EndCondition} when the game has ended (the Cell-leader
 * disruption win, or any standing end {@link detectEnd} reports on the next
 * state). The top-level `resolve` passes `ended` through and the Turn Pipeline
 * writes it to `WorldState.ended`, the same seam the service-drop resolver uses
 * for a materiel-seizure abort.
 */
export interface ArrestResult {
  readonly next: WorldState;
  readonly result: ActionResult;
  /** Set when the game has ended: the arrest's own leader win, else `detectEnd`'s. */
  readonly ended?: EndCondition;
}

/**
 * Resolve an {@link ArrestAction} (design `resolve`; draws nothing). The caller
 * (`resolve`) has confirmed the arrest is allowed (the gate passed), so the
 * player has authority and sufficient evidence; this applies the arrest.
 *
 * It resolves the target to a canonical NPC ({@link resolveTargetNpc}), starts
 * **Station Custody** on that NPC's {@link Relationship} and emits an
 * `asset-arrested` event. Then it reads the target's *true* allegiance
 * ({@link arrestTargetIsHostile}):
 *
 * - **correct arrest** (true hostile/Cell member, Req 19.2): a plain arrest Fact
 *   Line; arresting the **Cell leader** ({@link isPlotLeader}) disrupts the
 *   operation and returns the {@link leaderArrestEnd} win (Req 19.4);
 * - **wrongful arrest** (not a true hostile, Req 19.2, 19.3): the preset
 *   penalties — the player's `arrestAuthority` falls by the preset's
 *   wrongful-arrest penalty magnitude, Standing drops by
 *   {@link WRONGFUL_STANDING_PENALTY}, and on `wrongfulRaisesAlertness` the
 *   player's Cover Suspicion rises (a step toward a burn/loss, Req 19.5).
 *
 * Either way the arrest is recorded and may seize the materiel
 * (slice-integration Req 4.4, 6.3):
 *
 * - the canonical NPC id is appended to `player.arrests`, the Station's
 *   standing arrest record (a `unk:` target is recorded by the NPC it resolves
 *   to);
 * - when the NPC is carrying the stage's materiel ({@link carriesStageMateriel}),
 *   `plot.materielSeized` is set. The Plot is left running: the Day-Boundary
 *   abort check reads the flag and aborts it.
 *
 * When no end intent is set by the arrest itself, it still runs the pure
 * {@link detectEnd} on the next state, so a standing end is reported
 * consistently: an arrest of the leader (now in Station Custody and in the
 * arrest record) reports `leader-arrested` whatever its allegiance branch, and
 * an end that already held before the arrest is reported again. The Turn
 * Pipeline writes whichever end it finds.
 *
 * A target that cannot be resolved (an unmapped `unk:` id, or an absent Truth
 * Store) degrades to a no-op empty result with the state unchanged, rather than
 * throwing. Nothing is recorded and nothing is seized. Fact Line rendering is
 * left to the caller's `render`.
 */
export function resolveArrest(
  state: WorldState,
  a: ArrestAction,
  ctx: ResolverContext,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
): ArrestResult {
  const npc = resolveTargetNpc(a.npc, ctx);

  // Defensive: an unresolvable target leaves the world unchanged.
  if (npc === undefined || state.npcs[npc] === undefined) {
    return {
      next: state,
      result: {
        observations: [],
        factLines: [],
        scene: sceneDescriptorAt(state, state.player.loc),
        events: [],
        claimsAdded: [],
      },
    };
  }

  const now = state.time;
  const correct = arrestTargetIsHostile(state, npc);

  // Station Custody begins on the target's Relationship (Req 36.1): held from
  // `now` until `now + custodyPhases`, after which they are handed over.
  const custody: Custody = {
    by: 'station',
    since: now,
    until: addPhases(now, state.meta.scenario.custodyPhases),
  };
  const base = state.relationships[npc] ?? newRelationship(npc);
  const detained: Relationship = { ...base, custody };

  const events: SimEvent[] = [
    {
      kind: 'asset-arrested',
      id: `asset-arrested:${npc}:${now.day}:${now.phase}`,
      at: now,
      visibility: 'hidden',
      npc,
    },
  ];

  // Apply the correct/wrongful consequences.
  let player = state.player;
  let standing = state.station.standing;
  let line: string;
  let ended: EndCondition | undefined;

  if (correct) {
    line = ARREST_LINE;
    // Disruption WIN: arresting the Cell leader ends the game in success.
    if (isPlotLeader(state, npc)) {
      ended = leaderArrestEnd(now);
    }
  } else {
    // Wrongful arrest penalties (Req 19.2, 19.3). The preset's
    // `wrongfulAuthorityPenalty` is <= 0, so adding it reduces authority.
    line = WRONGFUL_ARREST_LINE;
    const arrest = state.meta.preset.arrest;
    player = {
      ...player,
      arrestAuthority: player.arrestAuthority + arrest.wrongfulAuthorityPenalty,
    };
    standing = standing - WRONGFUL_STANDING_PENALTY;
    // Hard preset: a wrongful arrest raises Hostile Service alertness, which the
    // engine tracks as a rise in the player's Cover Suspicion (a step toward a
    // burn and a loss, Req 19.5).
    if (arrest.wrongfulRaisesAlertness) {
      player = {
        ...player,
        coverSuspicion: asTruth(
          revealTruth(player.coverSuspicion) + WRONGFUL_ALERTNESS_COVER_SUSPICION,
        ),
      };
    }
  }

  // The Station's arrest record (slice-integration Req 6.3): every granted
  // arrest appends the canonical NPC id, whichever id the player arrested by.
  player = { ...player, arrests: [...player.arrests, npc] };

  // An arrested carrier gives up the materiel (slice-integration Req 4.4). The
  // flag is the standing record the live Disruption Context reads; the Plot is
  // left running for the Day-Boundary abort check to abort.
  const plot: PlotState = carriesStageMateriel(state.plot, npc)
    ? { ...state.plot, materielSeized: true }
    : state.plot;

  const next: WorldState = {
    ...state,
    player,
    plot,
    station: { ...state.station, standing },
    relationships: { ...state.relationships, [npc]: detained },
  };

  // The arrest's own end (leader disruption) takes precedence; otherwise fall
  // back to any standing end the arrest surfaced: the leader now in custody and
  // in the arrest record, or an end that already held (e.g. a burn recorded).
  const detected = ended ?? detectEnd(next) ?? undefined;

  const observations: Observation[] = [{ kind: 'message', line }];
  return {
    next,
    result: {
      observations,
      factLines: render(next, observations),
      scene: sceneDescriptorAt(next, next.player.loc),
      events,
      claimsAdded: [],
    },
    ...(detected !== undefined ? { ended: detected } : {}),
  };
}
