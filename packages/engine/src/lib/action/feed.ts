/**
 * The feed action (design, "Action Resolver" → **feed** "as specified in …
 * Hostile Service"; design, "Hostile Service" → "Feed composition" and "Feed
 * ingestion"; Requirements 37.1, 37.2, 37.6).
 *
 * `{ kind:'feed'; asset: NpcId; items: readonly FeedItem[]; label? }` — the
 * player chooses what a **turned** agent (a Double Agent the player runs) will
 * tell their Hostile-Service handler. The player builds 1–3 Propositions, each
 * either a Case File Claim they hold or one composed from the Predicate
 * Vocabulary using only entities in their known set (Req 37.1). The fed content
 * is delivered later — at the agent's next contact with their handler — as a
 * hidden `feed-delivered` event the Hostile Service ingests (Req 37.3); the
 * ingestion itself (Chickenfeed/deception classification, credibility and belief
 * updates) lives in the Hostile Service module.
 *
 * ## Validation (pure, player-side; Req 37.1, 37.2)
 *
 * The feed rules (1–3 items, held Claims, known-set entities, `unk:` ids
 * resolved through held `IS_ALIAS_OF` Claims, the derived per-predicate schema
 * and windows within the next 7 days) live in `./feed-validation.ts` as
 * {@link validateFeedItems}. It is the one function both this action and the
 * Player View facade's `validateFeed` call (slice-integration Req 14.1–14.4).
 * It reads a truth-free {@link import('./feed-validation.js').FeedView}, built
 * here by {@link feedViewOf} from the clock, the player's known set and the
 * Case File Claims the Turn Pipeline projects onto
 * {@link ResolverContext.claims} (the engine resolver cannot read the Player
 * View Case File directly, the same seam `confront` uses).
 *
 * ## Quote (pure, no draws; Req 37.6, slice-integration Req 14.4)
 *
 * {@link quoteFeed} first validates the items: an invalid feed is disallowed
 * with the first {@link import('./feed-validation.js').FeedError}'s reason, and
 * only then is the target checked. The feed is allowed when the target is a
 * **player-turned Asset** (`isAsset` and `asset.turned`) and a Contact Channel
 * to them exists. It costs **0 phases and 0 money** (design). All eligibility is
 * read from Player-View / Case File data, so an allowed/disallowed answer
 * reveals no ground truth.
 *
 * ## Resolve (deterministic, draws nothing; Req 37.3, 37.6)
 *
 * {@link resolveFeed} schedules a **hidden** `feed-delivered` event carrying the
 * resolved (alias-rewritten) Propositions at the agent's next handler contact
 * ({@link nextHandlerContact}: the first phase within {@link
 * FEED_CONTACT_HORIZON_DAYS} days where the agent and a Hostile-Service handler
 * are co-located per their schedules, else a fixed horizon), appended to
 * `WorldState.scheduled` for the Turn Pipeline to deliver. It draws nothing (the
 * contact time is a pure function of the schedules), so the same inputs always
 * schedule the same event. The optional `label` ('credibility' | 'deceive') is
 * **not** game-state truth: the resolver returns it for the view layer to record
 * as a Journal note only (Req 37.6, design: "The optional `label` goes only into
 * a Journal note; the Sim ignores it"). Fact Line rendering is left to the
 * caller's `render` callback, so this module never imports `./action.ts` and no
 * import cycle forms.
 */

import {
  compareTime,
  type GameTime,
  type LocId,
  type NpcId,
  type Phase,
} from '../model/core.js';
import { PHASES_PER_DAY } from '../model/core.js';
import type { SimEvent, WorldState } from '../model/state.js';
import { scheduledLocation } from '../city/npc.js';
import { CONTENT_WEEKDAYS, weekdayForDay } from '../city/time-mapping.js';
import { isAsset } from '../recruit/asset.js';
import { feedViewOf, validateFeedItems } from './feed-validation.js';
import type { ActionQuote, ActionResult, Observation, ResolverContext } from './result.js';
import type { FeedAction } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** A feed costs no phases (design: "It costs 0 phases and 0 money"). */
export const FEED_PHASE_COST = 0;

/** A feed costs no money (design). */
export const FEED_MONEY_COST = 0;

/** The horizon the next-handler-contact search scans (design: "from the
 * handler's schedule, at most 2 days ahead"). */
export const FEED_CONTACT_HORIZON_DAYS = 2;

/** The Fact Line a scheduled feed plays. */
export const FEED_SCHEDULED_LINE =
  'You brief the agent on exactly what to carry back. It will reach their handler at the next contact.';

// ---------------------------------------------------------------------------
// Next handler contact (design: "the turned agent's next contact with its
// handler, from the handler's schedule, at most 2 days ahead")
// ---------------------------------------------------------------------------

/** The Hostile-Service handler NPCs (the hostile officers), by id. */
export function handlerNpcs(state: WorldState): NpcId[] {
  const out: NpcId[] = [];
  for (const npc of Object.values(state.npcs)) {
    if (npc.role === 'hostile-officer') {
      out.push(npc.id);
    }
  }
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * The next time the turned agent is co-located with a Hostile-Service handler
 * per their schedules, scanning forward from the phase *after* now up to
 * {@link FEED_CONTACT_HORIZON_DAYS} days (design: "from the handler's schedule,
 * at most 2 days ahead"). When no co-location is found in the horizon (or the
 * agent/handlers carry no schedule), it falls back to the end of the horizon so
 * the feed is always delivered. Pure in the schedules and the clock, so the
 * contact time is deterministic.
 */
export function nextHandlerContact(state: WorldState, agent: NpcId): GameTime {
  const agentNpc = state.npcs[agent];
  const handlers = handlerNpcs(state);
  const horizonPhases = FEED_CONTACT_HORIZON_DAYS * PHASES_PER_DAY;
  const start = state.time.day * PHASES_PER_DAY + state.time.phase;

  for (let step = 1; step <= horizonPhases; step += 1) {
    const abs = start + step;
    const day = Math.floor(abs / PHASES_PER_DAY);
    const phase = (abs % PHASES_PER_DAY) as Phase;
    const weekday = CONTENT_WEEKDAYS.indexOf(weekdayForDay(day));
    const agentLoc =
      agentNpc === undefined
        ? undefined
        : scheduledLocation(agentNpc.schedule, weekday, phase);
    if (agentLoc === undefined) {
      continue;
    }
    for (const handler of handlers) {
      const handlerNpc = state.npcs[handler];
      if (handlerNpc === undefined) {
        continue;
      }
      const handlerLoc = scheduledLocation(handlerNpc.schedule, weekday, phase);
      if (handlerLoc !== undefined && handlerLoc === agentLoc) {
        return { day, phase };
      }
    }
  }

  // Fallback: the end of the horizon, so a fed Proposition is always delivered.
  const abs = start + horizonPhases;
  return { day: Math.floor(abs / PHASES_PER_DAY), phase: (abs % PHASES_PER_DAY) as Phase };
}

// ---------------------------------------------------------------------------
// Local scene helper (kept local to avoid an action.ts import cycle)
// ---------------------------------------------------------------------------

/** The NPCs scheduled at a Location at the current time, by id (local copy). */
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

// ---------------------------------------------------------------------------
// Quote (Req 37.1, 37.2, 37.6; slice-integration Req 14.4)
// ---------------------------------------------------------------------------

/**
 * Whether an NPC is a player-turned Asset (`isAsset` and `asset.turned`). Feed
 * is only valid on a Double Agent the player runs (design: "`feed` is allowed
 * when `asset.turned` holds").
 */
export function isTurnedAsset(state: WorldState, npc: NpcId): boolean {
  const rel = state.relationships[npc];
  return rel !== undefined && isAsset(rel) && rel.asset?.turned === true;
}

/**
 * Quote a {@link FeedAction} (pure, no draws; Req 37.1, 37.2, 37.6). The items
 * are validated first, with {@link validateFeedItems} over the
 * {@link feedViewOf} view of the state and the projected Claims: the quote is
 * disallowed with the first {@link import('./feed-validation.js').FeedError}'s
 * reason exactly when validation fails (slice-integration Req 14.4), whoever the
 * target is. A valid feed is then allowed when the target resolves to a real
 * NPC who is a **player-turned** Asset ({@link isTurnedAsset}) with a Contact
 * Channel. The cost is {@link FEED_PHASE_COST} (0) and {@link FEED_MONEY_COST}
 * (0). All eligibility is read from Player-View / Case File data, so an
 * allowed/disallowed answer never reveals ground truth, and a disallowed feed
 * leaves state unchanged (design, "Error handling").
 */
export function quoteFeed(
  state: WorldState,
  a: FeedAction,
  ctx: ResolverContext,
): ActionQuote {
  const validation = validateFeedItems(a.items, feedViewOf(state, ctx.claims), ctx.content);
  if (!validation.ok) {
    return {
      allowed: false,
      // A failed validation always carries at least one error; the fallback
      // only keeps the quote total.
      reason: validation.error[0]?.reason ?? 'the feed is invalid',
      phases: 0,
      money: 0,
    };
  }
  const npc = state.npcs[a.asset];
  if (npc === undefined) {
    return { allowed: false, reason: `no such person ${a.asset}`, phases: 0, money: 0 };
  }
  if (!isTurnedAsset(state, a.asset)) {
    return {
      allowed: false,
      reason: 'you can only feed a double agent you have turned',
      phases: 0,
      money: 0,
    };
  }
  if (!state.player.contacts.includes(a.asset)) {
    return {
      allowed: false,
      reason: 'you have no contact channel to this agent',
      phases: 0,
      money: 0,
    };
  }
  return { allowed: true, phases: FEED_PHASE_COST, money: FEED_MONEY_COST };
}

// ---------------------------------------------------------------------------
// Resolve (Req 37.3, 37.6)
// ---------------------------------------------------------------------------

/** What {@link resolveFeed} returns to the view layer beyond the result. */
export interface FeedResolveResult {
  readonly next: WorldState;
  readonly result: ActionResult;
  /**
   * The optional feed label, returned for the view layer to record as a Journal
   * note only (Req 37.6; design: "The optional `label` goes only into a Journal
   * note; the Sim ignores it"). It is never written into game-state truth.
   */
  readonly label?: 'credibility' | 'deceive';
}

/** A deterministic id for the scheduled `feed-delivered` event. */
function feedEventId(agent: NpcId, at: GameTime): string {
  return `event:feed-delivered:${agent}:${at.day}.${at.phase}`;
}

/**
 * Resolve a {@link FeedAction} (design `resolve`; draws nothing; Req 37.3, 37.6).
 * The caller (`resolve`) has confirmed the action is allowed, so the agent is a
 * player-turned Asset and {@link validateFeedItems} accepts the items. It
 * schedules a **hidden** `feed-delivered` event carrying the resolved
 * (alias-rewritten) Propositions at {@link nextHandlerContact}, appended to
 * `WorldState.scheduled` in time order for the Turn Pipeline to deliver and the
 * Hostile Service to ingest. A composed item's Proposition gets the stable id
 * `prop:feed/<agent>/<index>`. The optional `label` is returned (not persisted)
 * for a Journal note (Req 37.6). It adds no Case File Claims and draws no
 * randomness, so the same inputs always schedule the same event. Fact Line
 * rendering is left to the caller's `render`.
 */
export function resolveFeed(
  state: WorldState,
  a: FeedAction,
  ctx: ResolverContext,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
): FeedResolveResult {
  const validation = validateFeedItems(
    a.items,
    feedViewOf(state, ctx.claims),
    ctx.content,
    { agent: a.asset },
  );
  // Defensive: the caller confirmed the feed is valid; if not, degrade to a
  // no-op empty result rather than throwing.
  if (!validation.ok) {
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

  const at = nextHandlerContact(state, a.asset);
  const delivered: SimEvent = {
    kind: 'feed-delivered',
    id: feedEventId(a.asset, at),
    at,
    visibility: 'hidden',
    agent: a.asset,
    props: validation.value,
  };

  // Insert into the scheduled queue in time order (the design keeps `scheduled`
  // ordered by time), so the Turn Pipeline delivers it at the contact.
  const scheduled = insertScheduled(state.scheduled, delivered);
  const next: WorldState = { ...state, scheduled };

  const observations: Observation[] = [{ kind: 'message', line: FEED_SCHEDULED_LINE }];
  const result: ActionResult = {
    observations,
    factLines: render(next, observations),
    scene: sceneDescriptorAt(next, next.player.loc),
    events: [],
    claimsAdded: [],
  };
  return { next, result, ...(a.label === undefined ? {} : { label: a.label }) };
}

/** Insert an event into a time-ordered scheduled queue, keeping it ordered. */
function insertScheduled(
  queue: readonly SimEvent[],
  event: SimEvent,
): readonly SimEvent[] {
  const out = [...queue];
  let i = out.length;
  while (i > 0 && compareTime(out[i - 1].at, event.at) > 0) {
    i -= 1;
  }
  out.splice(i, 0, event);
  return out;
}
