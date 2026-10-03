/**
 * The turn-agent action (design, "Action Resolver" → **turn-agent** "as
 * specified in … Recruitment"; design, "Recruitment": `turnEligibility` /
 * `resolveTurn`; Requirements 11.3, 36.1, 36.2, 36.3, 36.4, 36.5, 36.6, 36.7).
 *
 * `{ kind:'turn-agent'; npc: NpcId; lever: MiceLever; offer? }` — the player
 * tries to turn a hostile agent they have **caught or cornered** into a Double
 * Agent who secretly works for the Station while still appearing loyal to the
 * Hostile Service (Req 11.3, 36.6).
 *
 * ## Quote and eligibility (player-side only; Req 36.1, 36.2)
 *
 * {@link turnEligibility} decides whether a turn may be attempted, and with what
 * leverage, from **Player-View and Case File data only** (Req 36.2) — never from
 * ground truth, so an allowed/disallowed answer leaks nothing. In priority order
 * (design, "Turning"):
 *
 * 1. `custody` — the NPC is in Station Custody ({@link inStationCustody}: a
 *    Station hold not yet handed over, Req 36.1);
 * 2. `cracking` — the player has observed the NPC's cover move to `cracking` or
 *    `blown` (the Relationship's `coverState`, the value the confront resolver
 *    records when it plays the cover-state Fact Line, Req 36.1);
 * 3. `evidence` — a talk scene with the NPC is open and the Case File holds at
 *    least one corroborated Implicating Claim against them
 *    ({@link ResolverContext.turnEvidence}, projected by the Turn Pipeline from
 *    the view-side arrest-evidence count, Req 36.1).
 *
 * No eligible leverage means {@link quoteTurnAgent} returns `allowed: false`
 * with a player-side reason (no custody, no observed crack, no evidence). The
 * turn costs {@link TURN_PHASE_COST} and the offered `offer` money (a `money`
 * lever sweetener; the shared Budget gate in `./action.ts` rejects an
 * unaffordable offer).
 *
 * ## Resolve (draws the turn coin; Req 36.3–36.7)
 *
 * {@link resolveTurnAgent} reads the eligibility leverage again, computes the
 * arrest-evidence count and threshold, the NPC's loyalty and the hostile-org
 * test, and draws {@link resolveTurn} — the pure verdict coin — once (plus a
 * report coin only on a success-coin miss). Then:
 *
 * - **`accepted`** (Req 36.6): the NPC's true allegiance flips to the Station in
 *   the Truth Store (`apparent` is untouched), the {@link Relationship} becomes a
 *   recruited, `turned` Asset whose `access.orgs` includes the hostile org, and
 *   the Hostile Service's belief in the agent's loyalty is left unchanged (this
 *   resolver writes no hostile belief). A turned agent still in Station Custody
 *   is released, and the release raises the Hostile Service's suspicion of them
 *   by `0.1 × phases in custody` ({@link custodyReleaseSuspicion}) — carried on
 *   the Relationship for the Hostile Service task to read — and emits a
 *   `custody-released` event. The accept Fact Line reports the turn.
 * - **`refused` / `refused-reported`** (Req 36.5): the **identical**
 *   {@link TURN_REFUSAL_LINE} is played and the NPC's suspicion of the player
 *   rises, so a refusal distinguishes an innocent from a loyal agent in neither
 *   its text nor its effect. `refused-reported` additionally marks the agent's
 *   channels compromised and raises the player's Cover Suspicion (the design's
 *   failure consequence); both are ground-truth writes the resolver performs
 *   without surfacing anything new to the player.
 *
 * The verdict is deterministic in the inputs and the PRNG state, and the
 * non-hostile branch takes no draw, so a later soundness test can pin it
 * (Property 31; task 18.7). Fact Line rendering is left to the caller's `render`
 * callback, so this module never imports `./action.ts` and no cycle forms.
 */

import { asTruth, revealTruth, type LocId, type NpcId, type OrgId } from '../model/core.js';
import type { Allegiance } from '../truth/truth.js';
import type { SimEvent, WorldState } from '../model/state.js';
import type { Prng } from '../prng/prng.js';
import { scheduledLocation } from '../city/npc.js';
import { CONTENT_WEEKDAYS, weekdayForDay } from '../city/time-mapping.js';
import {
  inStationCustody,
  newRelationship,
  type AssetProfile,
  type Relationship,
} from '../recruit/asset.js';
import {
  custodyReleaseSuspicion,
  resolveTurn,
  trueAllegianceIsHostile,
  TURN_REFUSAL_LINE,
  type TurnLeverage,
  type TurnOutcome,
  type TurnWeights,
} from '../recruit/turn.js';
import type { ActionQuote, ActionResult, Observation, ResolverContext } from './result.js';
import type { TurnAgentAction } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The phase cost of a turn attempt: a tense face-to-face consumes the phase. */
export const TURN_PHASE_COST = 1;

/** The suspicion a failed turn adds to the NPC's suspicion of the player (Req 36.5). */
export const TURN_FAIL_SUSPICION = 0.2;

/** The Cover Suspicion a *reported* failed turn adds to the player (design). */
export const TURN_REPORTED_COVER_SUSPICION = 0.1;

/** The Asset reliability a freshly-turned Double Agent reports at. */
export const TURNED_ASSET_RELIABILITY = 0.6;

/** The Fact Line a successful turn plays. */
export const TURN_ACCEPT_LINE =
  'They hesitate, then agree. From here they work for you — and their own service must never know.';

// ---------------------------------------------------------------------------
// Local helpers (kept local to avoid an action.ts import cycle)
// ---------------------------------------------------------------------------

/**
 * The NPCs scheduled at a Location at the current time, by id in deterministic
 * order. A local copy of `./action.ts`'s `visibleNpcsAt` so this module does not
 * import `./action.ts` (which imports *this* module to route the action) and
 * form a cycle — the same local-helper pattern `./confront.ts`/`./pay.ts` use.
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

/** The id of the org whose kind is `hostile` (the Hostile Service), if any. */
export function hostileOrgId(state: WorldState): OrgId | undefined {
  for (const org of Object.values(state.orgs)) {
    if (org.kind === 'hostile') {
      return org.id;
    }
  }
  return undefined;
}

/** The arrest-evidence threshold the `evidence` leverage scales against (preset). */
function arrestThresholdOf(state: WorldState): number {
  return state.meta.preset.arrest.threshold;
}

/** The scenario `recruitment.turn` weights the success σ reads. */
function turnWeightsOf(state: WorldState): TurnWeights {
  return state.meta.scenario.recruitment.turn;
}

/** The NPC's loyalty, defaulting to a neutral `0.5` when the model omits it. */
export function npcLoyalty(state: WorldState, npc: NpcId): number {
  const loyalty = state.npcs[npc]?.loyalty;
  return loyalty === undefined ? 0.5 : clamp01(revealTruth(loyalty));
}

// ---------------------------------------------------------------------------
// turnEligibility (Req 36.1, 36.2)
// ---------------------------------------------------------------------------

/**
 * The player-side turn leverage against an NPC, or `null` when no turn may be
 * attempted (design: `turnEligibility`; Req 36.1, 36.2). Decided **only** from
 * Player-View and Case File data — the Relationship's custody and observed cover
 * state, and the Turn Pipeline's projected arrest-evidence count and scene flag
 * — so it never reads ground truth and is invariant under any Truth Store change
 * (Property 31).
 *
 * Priority order (design, "Turning"): `custody`, then `cracking`, then
 * `evidence`. Returns the first that holds, or `null`.
 */
export function turnEligibility(
  state: WorldState,
  npc: NpcId,
  ctx: ResolverContext,
): TurnLeverage | null {
  const rel = state.relationships[npc];
  if (rel !== undefined && inStationCustody(rel, state.time)) {
    return 'custody';
  }
  if (rel !== undefined && (rel.coverState === 'cracking' || rel.coverState === 'blown')) {
    return 'cracking';
  }
  const evidence = ctx.turnEvidence?.[npc];
  if (evidence !== undefined && evidence.sceneOpen && evidence.evidenceCount >= 1) {
    return 'evidence';
  }
  return null;
}

/** The corroborated Implicating Claim count the pipeline projected for an NPC. */
function evidenceCountOf(ctx: ResolverContext, npc: NpcId): number {
  return ctx.turnEvidence?.[npc]?.evidenceCount ?? 0;
}

// ---------------------------------------------------------------------------
// Quote (Req 36.1, 36.2)
// ---------------------------------------------------------------------------

/**
 * Quote a {@link TurnAgentAction} (pure, no draws). The target must resolve to a
 * real NPC with an eligible turn leverage ({@link turnEligibility}); a `money`
 * lever's `offer` must be a non-negative, finite number (a non-money lever
 * ignores it). The cost is {@link TURN_PHASE_COST} and `offer` money; the shared
 * Budget gate in `./action.ts` rejects an unaffordable offer. All eligibility is
 * read from Player-View / Case File data (Req 36.2), so an allowed/disallowed
 * answer never reveals ground truth. The shared Location gate handles the
 * player's Location being open and allowing `turn-agent`.
 */
export function quoteTurnAgent(
  state: WorldState,
  a: TurnAgentAction,
  ctx: ResolverContext,
): ActionQuote {
  const npc = state.npcs[a.npc];
  if (npc === undefined) {
    return { allowed: false, reason: `no such person ${a.npc}`, phases: 0, money: 0 };
  }
  const offer = a.offer ?? 0;
  if (a.lever === 'money' && (!Number.isFinite(offer) || offer < 0)) {
    return {
      allowed: false,
      reason: 'a money offer must be a non-negative amount',
      phases: 0,
      money: 0,
    };
  }
  const leverage = turnEligibility(state, a.npc, ctx);
  if (leverage === null) {
    return {
      allowed: false,
      reason:
        'you cannot turn this agent: they are not in custody, you have not seen their cover crack, and you hold no corroborated evidence against them in an open scene',
      phases: 0,
      money: 0,
    };
  }
  return { allowed: true, phases: TURN_PHASE_COST, money: a.lever === 'money' ? offer : 0 };
}

// ---------------------------------------------------------------------------
// Resolve (Req 36.3, 36.4, 36.5, 36.6, 36.7)
// ---------------------------------------------------------------------------

/**
 * Build the recruited, `turned` {@link Relationship} a successful turn produces
 * (Req 36.6). The agent becomes an Asset whose profile is `turned` with its
 * hostile org in `access.orgs` (design: "A turned agent's `access.orgs`
 * includes its hostile org"), carried on the Relationship. The custody hold is
 * released (cleared) when present. Pure in the inputs.
 */
function turnedRelationship(
  base: Relationship,
  hostileOrg: OrgId,
): Relationship {
  const existing = base.asset;
  const access = existing?.access;
  const turnedAccess = access
    ? asTruth({
        ...revealTruth(access),
        orgs: Array.from(new Set([...revealTruth(access).orgs, hostileOrg])),
      })
    : asTruth({ locs: [], orgs: [hostileOrg], npcs: [base.npc] });
  const profile: AssetProfile = {
    access: turnedAccess,
    reliability: existing?.reliability ?? asTruth(TURNED_ASSET_RELIABILITY),
    turned: true,
    hostileControlled: existing?.hostileControlled ?? asTruth(false),
  };
  return {
    ...base,
    recruited: true,
    asset: profile,
    custody: undefined,
  };
}

/**
 * Resolve a {@link TurnAgentAction} (design `resolve`; draws the turn coin). The
 * caller (`resolve`) has confirmed the action is allowed, so the NPC exists and
 * a leverage holds. It reads the leverage, the arrest-evidence count/threshold,
 * the NPC's loyalty and the hostile-org test, and draws {@link resolveTurn}
 * once.
 *
 * On `accepted` it flips the true allegiance to the Station in the Truth Store
 * (apparent untouched), makes the NPC a `turned` Asset, releases any Station
 * Custody and applies the custody-release suspicion penalty (Req 36.6, 36.7).
 * On either refusal it plays the identical {@link TURN_REFUSAL_LINE} and raises
 * the NPC's suspicion of the player (Req 36.5); a `refused-reported` also raises
 * the player's Cover Suspicion. It adds no Case File Claims. Fact Line rendering
 * is left to the caller's `render`.
 *
 * The Truth Store write is the sole place ground truth changes; a missing Truth
 * Store or hostile org degrades the accept to a view-only turn (the Asset flag
 * is still set) rather than throwing.
 */
export function resolveTurnAgent(
  state: WorldState,
  a: TurnAgentAction,
  rng: Prng,
  ctx: ResolverContext,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
): { next: WorldState; result: ActionResult } {
  const npc = state.npcs[a.npc];
  const leverage = turnEligibility(state, a.npc, ctx);
  const hostileOrg = hostileOrgId(state);

  // Defensive: the caller confirmed the action is allowed, so these resolve; if
  // not, degrade to an empty no-op result rather than throwing.
  if (npc === undefined || leverage === null) {
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

  const evidence = evidenceCountOf(ctx, a.npc);
  const loyalty = npcLoyalty(state, a.npc);
  const isHostile =
    hostileOrg !== undefined && trueAllegianceIsHostile(npc, hostileOrg);

  const outcome: TurnOutcome = resolveTurn(
    npc,
    state.relationships[a.npc] ?? newRelationship(a.npc),
    a.lever,
    a.offer ?? 0,
    leverage,
    evidence,
    loyalty,
    arrestThresholdOf(state),
    turnWeightsOf(state),
    isHostile,
    rng,
  );

  if (outcome === 'accepted') {
    return applyAccepted(state, a.npc, hostileOrg, ctx, render);
  }
  return applyRefused(state, a.npc, outcome, render);
}

/**
 * Apply an `accepted` turn (Req 36.6, 36.7): flip the true allegiance to the
 * Station in the Truth Store, make the NPC a `turned` Asset, release any Station
 * Custody and apply the custody-release suspicion penalty.
 */
function applyAccepted(
  state: WorldState,
  npcId: NpcId,
  hostileOrg: OrgId | undefined,
  ctx: ResolverContext,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
): { next: WorldState; result: ActionResult } {
  const stationOrg = state.station.org;
  const base = state.relationships[npcId] ?? newRelationship(npcId);
  const wasInCustody = inStationCustody(base, state.time);

  // Req 36.6: the true allegiance becomes the Station. The Truth Store is the
  // only place ground truth lives; the Player View never saw the old allegiance.
  if (ctx.truth !== undefined) {
    ctx.truth.setAllegiance(npcId, { org: stationOrg } as Allegiance);
  }

  const turned = turnedRelationship(base, hostileOrg ?? stationOrg);

  // Req 36.7: a release from Station Custody raises the Hostile Service's
  // suspicion of the agent by 0.1 × phases in custody. The Hostile Service
  // belief model is a later task; the magnitude is carried on the Relationship's
  // suspicion accumulator so that task can read it, and the release is announced.
  const observations: Observation[] = [{ kind: 'message', line: TURN_ACCEPT_LINE }];
  const events: SimEvent[] = [];
  let withSuspicion = turned;
  if (wasInCustody && base.custody !== undefined) {
    const penalty = custodyReleaseSuspicion(base.custody, state.time);
    withSuspicion = { ...turned, suspicion: turned.suspicion + penalty };
    events.push({
      kind: 'custody-released',
      id: `custody-released:${npcId}:${state.time.day}:${state.time.phase}`,
      at: state.time,
      visibility: 'player',
      npc: npcId,
    });
  }

  const next: WorldState = {
    ...state,
    relationships: { ...state.relationships, [npcId]: withSuspicion },
  };

  return {
    next,
    result: {
      observations,
      factLines: render(next, observations),
      scene: sceneDescriptorAt(next, next.player.loc),
      events,
      claimsAdded: [],
    },
  };
}

/**
 * Apply a `refused` / `refused-reported` turn (Req 36.5): play the identical
 * refusal Fact Line and raise the NPC's suspicion of the player. A
 * `refused-reported` additionally raises the player's Cover Suspicion. Neither
 * reveals the NPC's true allegiance.
 */
function applyRefused(
  state: WorldState,
  npcId: NpcId,
  outcome: TurnOutcome,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
): { next: WorldState; result: ActionResult } {
  const base = state.relationships[npcId] ?? newRelationship(npcId);
  const nextRel: Relationship = {
    ...base,
    suspicion: base.suspicion + TURN_FAIL_SUSPICION,
  };

  let player = state.player;
  if (outcome === 'refused-reported') {
    player = {
      ...state.player,
      coverSuspicion: asTruth(
        revealTruth(state.player.coverSuspicion) + TURN_REPORTED_COVER_SUSPICION,
      ),
    };
  }

  const next: WorldState = {
    ...state,
    player,
    relationships: { ...state.relationships, [npcId]: nextRel },
  };

  // Req 36.5: the SAME refusal Fact Line regardless of the target's ground
  // truth, so a refusal distinguishes nothing.
  const observations: Observation[] = [{ kind: 'message', line: TURN_REFUSAL_LINE }];
  return {
    next,
    result: {
      observations,
      factLines: render(next, observations),
      scene: sceneDescriptorAt(next, next.player.loc),
      events: [],
      claimsAdded: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/** Clamp a value into `[0, 1]`. */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
