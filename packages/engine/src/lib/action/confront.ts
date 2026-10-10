/**
 * The confront-with-Claim action (design, "Action Resolver" → **confront** "as
 * specified in … Recruitment"; design, "Recruitment": `pressureCheck`;
 * Requirements 6.3, 6.4).
 *
 * `{ kind:'confront'; npc: NpcId; claim: ClaimId }` — the player presses an NPC
 * to their face with a Case File Claim that contradicts the NPC's Cover Story or
 * Told List (Req 6.4). It runs the deterministic cover-state pressure check
 * ({@link pressureCheck} in `../recruit/pressure.ts`): a successful check
 * degrades the NPC's cover along `intact → strained → cracking → blown`, and a
 * cover that breaks into `cracking`/`blown` changes the NPC's Agenda — a partial
 * admission, bargaining, or flight ({@link agendaShiftFor}).
 *
 * ## Quote (pure, no draws)
 *
 * The confront is allowed when:
 *
 * - the target resolves to a real NPC;
 * - that NPC is **present** at the player's current Location this phase
 *   (confront is a face-to-face press, like talk);
 * - the named Claim resolves to a {@link Proposition} the player holds — the
 *   Turn Pipeline projects the Case File's Claims onto
 *   {@link ResolverContext.claims} (the engine resolver cannot read the
 *   Player-View Case File directly); and
 * - that Claim is **about the NPC** — its subject or object is the confronted
 *   NPC, so the player is pressing them with a Claim that concerns *them*.
 *
 * The cost is {@link CONFRONT_PHASE_COST} and no money. All eligibility is read
 * from Player-View / Case File data (presence and the projected Claims), so an
 * allowed/disallowed answer never reveals ground truth.
 *
 * ## Resolve (draws exactly the pressureCheck coin)
 *
 * The resolver reads the Claim's Proposition as the confronting evidence, draws
 * {@link pressureCheck} once on the passed PRNG for the next cover state, and:
 *
 * - updates the NPC's {@link Relationship} `coverState` to the result (minting a
 *   fresh neutral relationship first if the player had none — the confront is
 *   their first recorded interaction);
 * - emits a cover-state Fact Line describing where the cover now stands, and —
 *   when the cover broke — an Agenda-shift Fact Line (partial admission,
 *   bargaining or flight), the state change Req 6.4 names.
 *
 * Confront **reads** Case File Claims; it adds none, so `claimsAdded` is empty.
 * The Agenda itself is not stored on `WorldState` (the generator keeps per-NPC
 * agendas in a separate map; wiring them onto the running state is a later
 * task), so the resolver's persisted, player-observable effect is the
 * `coverState` on the Relationship plus the Fact Lines; the dialogue layer reads
 * the broken cover to re-voice the NPC under its shifted Agenda.
 *
 * ## Purity and the Truth boundary
 *
 * `quoteConfront` draws nothing. `resolveConfront` draws exactly one coin — the
 * {@link pressureCheck} success — so the same inputs and PRNG state always yield
 * the same outcome (Property 11; task 18.4). Fact Line rendering is left to the
 * caller's `render` callback, so this module never imports `./action.ts` and no
 * import cycle forms.
 */

import type { LocId, NpcId, Proposition } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import type { Prng } from '../prng/prng.js';
import { scheduledLocation } from '../city/npc.js';
import { scheduleWeekdayIndex } from '../city/calendar.js';
import { newRelationship, type CoverState } from '../recruit/asset.js';
import {
  agendaShiftFor,
  coverBroke,
  pressureCheck,
  type AgendaShift,
} from '../recruit/pressure.js';
import type { ActionQuote, ActionResult, Observation, ResolverContext } from './result.js';
import type { ConfrontAction } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The phase cost of a confront: it consumes the current phase (a face-to-face). */
export const CONFRONT_PHASE_COST = 1;

// ---------------------------------------------------------------------------
// Local helpers (kept local to avoid an action.ts import cycle)
// ---------------------------------------------------------------------------

/**
 * The NPCs scheduled at a Location at the current time, by id in deterministic
 * order. A local copy of `./action.ts`'s `visibleNpcsAt` so this module does not
 * import `./action.ts` (which imports *this* module to route the action) and
 * form a cycle — the same local-helper pattern `./talk.ts` and `./surveil.ts`
 * use.
 */
function npcsScheduledAt(state: WorldState, locId: LocId): NpcId[] {
  const weekday = scheduleWeekdayIndex(state.time.day, state.meta.setting.startDate);
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

/**
 * Whether a Proposition is *about* an NPC — the NPC is its subject or (entity)
 * object. A confront must press an NPC with a Claim that concerns them (Req 6.4).
 */
export function claimConcernsNpc(prop: Proposition, npc: NpcId): boolean {
  if (prop.subject === npc) {
    return true;
  }
  return typeof prop.object === 'string' && prop.object === npc;
}

/** The Proposition the named Claim asserts, from the resolver context, if held. */
export function claimPropositionOf(
  ctx: ResolverContext,
  claim: ConfrontAction['claim'],
): Proposition | undefined {
  return ctx.claims?.[claim];
}

// ---------------------------------------------------------------------------
// Fact Lines
// ---------------------------------------------------------------------------

/** The Fact Line reporting where an NPC's cover now stands after a confront. */
export function coverStateLine(state: CoverState): string {
  switch (state) {
    case 'intact':
      return 'They hold your gaze. Their story does not budge.';
    case 'strained':
      return 'A flicker of doubt crosses their face. The story is beginning to strain.';
    case 'cracking':
      return 'Their composure slips. The cover is cracking.';
    case 'blown':
      return 'The pretence collapses. Their cover is blown.';
  }
}

/** The Fact Line describing the Agenda shift a broken cover produced (Req 6.4). */
export function agendaShiftLine(shift: AgendaShift): string | undefined {
  switch (shift) {
    case 'partial-admission':
      return 'They concede a piece of it — a partial admission, offered to make you stop.';
    case 'bargaining':
      return 'They stop denying and start bargaining, feeling for terms.';
    case 'flight':
      return 'They break off and move to leave — this has become about getting away.';
    case 'none':
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Quote (Req 6.4)
// ---------------------------------------------------------------------------

/**
 * Quote a {@link ConfrontAction} (pure, no draws). The target must resolve to a
 * real NPC present at the player's current Location this phase; the named Claim
 * must resolve to a Proposition the player holds ({@link ResolverContext.claims})
 * that is **about** the confronted NPC. The cost is {@link CONFRONT_PHASE_COST}
 * and no money. The shared Location gate in `./action.ts` handles the player's
 * Location being open and allowing `confront`.
 */
export function quoteConfront(
  state: WorldState,
  a: ConfrontAction,
  ctx: ResolverContext,
): ActionQuote {
  const npc = state.npcs[a.npc];
  if (npc === undefined) {
    return { allowed: false, reason: `no such person ${a.npc}`, phases: 0, money: 0 };
  }
  const here = npcsScheduledAt(state, state.player.loc);
  if (!here.includes(a.npc)) {
    return {
      allowed: false,
      reason: 'that person is not present to confront',
      phases: 0,
      money: 0,
    };
  }
  const prop = claimPropositionOf(ctx, a.claim);
  if (prop === undefined) {
    return {
      allowed: false,
      reason: `you hold no Case File Claim ${a.claim}`,
      phases: 0,
      money: 0,
    };
  }
  if (!claimConcernsNpc(prop, a.npc)) {
    return {
      allowed: false,
      reason: 'that Claim does not concern this person',
      phases: 0,
      money: 0,
    };
  }
  return { allowed: true, phases: CONFRONT_PHASE_COST, money: 0 };
}

// ---------------------------------------------------------------------------
// Resolve (Req 6.3, 6.4)
// ---------------------------------------------------------------------------

/**
 * Resolve a {@link ConfrontAction} (design `resolve`; draws exactly the
 * {@link pressureCheck} coin). The caller (`resolve`) has confirmed the action
 * is allowed, so the NPC is present and the Claim resolves and concerns them.
 *
 * It reads the Claim's Proposition as the confronting evidence, draws
 * {@link pressureCheck} once on the passed {@link Prng} for the next cover
 * state, updates the NPC's {@link Relationship} `coverState` (minting a fresh
 * neutral relationship if the player had none), and emits a cover-state Fact
 * Line plus — when the cover broke into `cracking`/`blown` — an Agenda-shift
 * Fact Line (partial admission, bargaining or flight; Req 6.4). It adds no Case
 * File Claims. Fact Line rendering is left to the caller's `render`.
 */
export function resolveConfront(
  state: WorldState,
  a: ConfrontAction,
  rng: Prng,
  ctx: ResolverContext,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
): { next: WorldState; result: ActionResult } {
  const npc = state.npcs[a.npc];
  const prop = claimPropositionOf(ctx, a.claim);
  // Defensive: the caller confirmed both resolve; if not, degrade to a no-op
  // empty result rather than throwing.
  if (npc === undefined || prop === undefined) {
    const observations: Observation[] = [];
    return {
      next: state,
      result: {
        observations,
        factLines: [],
        scene: sceneDescriptorAt(state, state.player.loc),
        events: [],
        claimsAdded: [],
      },
    };
  }

  const rel = state.relationships[a.npc] ?? newRelationship(a.npc);
  const before = rel.coverState;
  const after = pressureCheck(npc, rel, [prop], rng);
  const shift = agendaShiftFor(before, after);

  const next: WorldState = {
    ...state,
    relationships: {
      ...state.relationships,
      [a.npc]: { ...rel, coverState: after },
    },
  };

  const observations: Observation[] = [{ kind: 'message', line: coverStateLine(after) }];
  if (coverBroke(before, after)) {
    const line = agendaShiftLine(shift);
    if (line !== undefined) {
      observations.push({ kind: 'message', line });
    }
  }

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
