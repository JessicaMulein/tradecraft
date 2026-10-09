/**
 * The cable action (slice-integration design, "Engine: actions" → `cable`;
 * Requirements 9.1, 9.2, 9.3; slice Requirements 27.4, 27.5).
 *
 * `{ kind:'cable'; body: CableRequest }`: the player sends HQ a `trace`,
 * `funds` or `report` request. HQ does not answer at once. The request becomes
 * a {@link import('../station/cable-types.js').PendingCable} on
 * `station.pendingCables`, and the Phase Step delivers the reply through
 * `processDueCables` once it falls due (Requirement 9.4, which this module does
 * not implement).
 *
 * ## Quote (pure, no draws)
 *
 * - **At the Station.** A Cable is sent from the Station. The rule is the one
 *   the `intercept` action already uses: the player's current Location is a
 *   Station HQ Location ({@link isAtStation}, Location Type `station-hq`), and
 *   that Location is open in the current phase. The shared Location gate in
 *   `./action.ts` does not cover this, because `actionLocation` gives `cable` no
 *   Location, so this quote applies the check itself. Away from the Station
 *   every request is disallowed.
 * - **Trace.** Allowed only when `target` is in `player.known.entities`
 *   (Requirement 9.2; {@link isKnownTraceTarget}). An Unidentified Subject
 *   (`unk:N`) is outside that set, so a trace on one is disallowed.
 * - **Funds and report.** Always allowed at the Station (Requirement 9.1). A
 *   funds request may name an `amount`; when it does, the amount must be a
 *   positive, finite number, so that a malformed request cannot put `NaN` or
 *   `Infinity` into the pending Cable.
 *
 * Every allowed request costs {@link CABLE_PHASE_COST} phase and no money. A
 * disallowed quote costs nothing and carries a reason.
 *
 * ## Resolve (draws nothing)
 *
 * `submitCable(body, time, { delayPhases })` with the preset's
 * `traceRequestDelayPhases` ({@link cableReplyDelayPhases}), and the returned
 * PendingCable appended to `station.pendingCables` (Requirement 9.3). The reply
 * is due `delayPhases` phases after the send time. The result carries one
 * confirmation Fact Line ({@link CABLE_SENT_LINES}) as a `message`
 * Observation, so no Case File Claim, and no SimEvent: the reply's `cable`
 * event is minted when it is delivered. A disallowed action resolves to an
 * empty result with the state unchanged (`next === state`).
 *
 * Fact Line rendering is left to the caller's `render` callback, so this module
 * never imports `./action.ts` and no import cycle forms (the pattern `./pay.ts`
 * uses).
 */

import type { EntityId, LocId, NpcId, UnkId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { DEFAULT_CABLE_DELAY_PHASES, submitCable } from '../station/cables.js';
import { cableLatency } from '../region/notices.js';
import {
  arrestEvidenceOf,
  arrestThresholdOf,
  resolveTargetNpc,
  WRONGFUL_STANDING_PENALTY,
} from './arrest.js';
import { isAtStation } from './intercept.js';
import type { ActionQuote, ActionResult, Observation, ResolverContext } from './result.js';
import { npcsScheduledAt } from './surveil.js';
import type { CableAction, CableRequest } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The phase cost of sending a Cable (design: phases 1, money 0). */
export const CABLE_PHASE_COST = 1;

/** The reason a Cable quoted away from the Station is disallowed. */
export const CABLE_NOT_AT_STATION_REASON =
  'you can only send a Cable from the Station';

/** The reason a trace on an entity outside the known set is disallowed (Req 9.2). */
export const CABLE_UNKNOWN_TARGET_REASON =
  'HQ can only trace a name you already know';

/** The reason a funds request naming a non-positive or non-finite amount is disallowed. */
export const CABLE_FUNDS_AMOUNT_REASON =
  'a funds request must name a positive amount';

/**
 * The reason an identification report is refused: the Case File evidence count
 * is below the arrest threshold. The quote reads that count only.
 */
export const CABLE_IDENTIFY_EVIDENCE_REASON =
  'HQ will not hear that identification until the evidence is in the file';

/**
 * The acknowledgement for an identification report. Correct and wrong reports
 * play this same line.
 */
export const IDENTIFY_REPORT_ACK = 'HQ acknowledges your report.';

/**
 * The confirmation Fact Line a sent Cable plays, by request kind. The reply
 * arrives later as its own Cable Document and Notification.
 */
export const CABLE_SENT_LINES: Readonly<Record<CableRequest['kind'], string>> =
  {
    trace: 'You cable HQ for a trace. The reply will follow.',
    funds: 'You cable HQ for funds. The reply will follow.',
    report: 'You cable your report to HQ. The reply will follow.',
  };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * True when HQ can be asked to trace `target`: it is in the player's known set
 * (`player.known.entities`, Requirement 9.2). Reads only Player View data.
 */
export function isKnownTraceTarget(
  state: WorldState,
  target: EntityId,
): boolean {
  return state.player.known.entities.includes(target);
}

/**
 * The reply delay a sent Cable is given, in phases: the Difficulty Preset's
 * `traceRequestDelayPhases`. Falls back to {@link DEFAULT_CABLE_DELAY_PHASES}
 * when the value is not a non-negative finite number (the content schema rules
 * that out; the fallback matches `retentionDays` in `./intercept.ts`).
 */
export function cableReplyDelayPhases(state: WorldState): number {
  const raw = state.meta.preset.traceRequestDelayPhases;
  const slice = Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_CABLE_DELAY_PHASES;
  return cableLatency(state, slice);
}

/** The allowed quote every accepted Cable gets: one phase, no money. */
function allowedQuote(): ActionQuote {
  return { allowed: true, phases: CABLE_PHASE_COST, money: 0 };
}

/** A disallowed quote: no cost, with the reason. */
function disallowed(reason: string): ActionQuote {
  return { allowed: false, reason, phases: 0, money: 0 };
}

/**
 * The Station-presence check: `undefined` when the player is at an open
 * Station, else the reason the Cable cannot be sent from here. The closed
 * reason uses the same words as the shared Location gate.
 */
function stationGate(state: WorldState): string | undefined {
  if (!isAtStation(state)) {
    return CABLE_NOT_AT_STATION_REASON;
  }
  const loc = state.city.locations[state.player.loc];
  if (loc !== undefined && loc.hours[state.time.phase] !== true) {
    return `${loc.name} is closed in this phase`;
  }
  return undefined;
}

/**
 * The scene descriptor for a Location, built locally so this module does not
 * import `./action.ts` (which routes the action here) and form a cycle.
 */
function sceneDescriptorAt(
  state: WorldState,
  loc: LocId,
): ActionResult['scene'] {
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
// Quote (Req 9.1, 9.2)
// ---------------------------------------------------------------------------

function isPersonId(entity: string): entity is NpcId | UnkId {
  return entity.startsWith('npc:') || entity.startsWith('unk:');
}

/** The role holder named by `roleTag` on a library plot, else the slice plot. */
function holderOf(state: WorldState, roleTag: string): string | undefined {
  for (const plot of state.plots ?? []) {
    const holder = plot.roleHolders[roleTag];
    if (holder !== undefined) {
      return holder;
    }
  }
  const slice = state.plot.roles.find(
    (role) => role.slot === roleTag && role.npc !== undefined,
  );
  return slice?.npc;
}

/**
 * Record an identification and, when the resolved entity is not the role
 * holder, apply the wrongful-arrest penalty. The acknowledgement does not
 * depend on the result.
 */
function applyIdentification(
  state: WorldState,
  identify: { readonly entity: EntityId; readonly roleTag: string },
  ctx: ResolverContext | undefined,
): WorldState {
  const resolved = isPersonId(identify.entity)
    ? ctx === undefined
      ? identify.entity
      : (resolveTargetNpc(identify.entity, ctx) ?? identify.entity)
    : identify.entity;
  const holder = holderOf(state, identify.roleTag);
  const correct = holder !== undefined && resolved === holder;
  let player: WorldState['player'] = {
    ...state.player,
    identifications: [
      ...(state.player.identifications ?? []),
      { entity: identify.entity, roleTag: identify.roleTag, correct },
    ],
  };
  let standing = state.station.standing;
  if (!correct) {
    const arrest = state.meta.preset.arrest;
    player = {
      ...player,
      arrestAuthority: player.arrestAuthority + arrest.wrongfulAuthorityPenalty,
    };
    standing -= WRONGFUL_STANDING_PENALTY;
  }
  return {
    ...state,
    player,
    station: { ...state.station, standing },
  };
}

/**
 * Quote a {@link CableAction} (pure, no draws). The player must be at an open
 * Station. A trace needs a target in `player.known.entities`; a funds request
 * that names an amount needs a positive, finite one; a plain report is always
 * allowed. An identification report is allowed only when the projected Case
 * File evidence count for its entity is at least the arrest threshold. An
 * allowed Cable costs {@link CABLE_PHASE_COST} phase and no money.
 */
export function quoteCable(
  state: WorldState,
  a: CableAction,
  ctx?: ResolverContext,
): ActionQuote {
  const gate = stationGate(state);
  if (gate !== undefined) {
    return disallowed(gate);
  }

  const body = a.body;
  switch (body.kind) {
    case 'trace':
      return isKnownTraceTarget(state, body.target)
        ? allowedQuote()
        : disallowed(CABLE_UNKNOWN_TARGET_REASON);
    case 'funds':
      return body.amount === undefined ||
        (Number.isFinite(body.amount) && body.amount > 0)
        ? allowedQuote()
        : disallowed(CABLE_FUNDS_AMOUNT_REASON);
    case 'report': {
      if (body.identify === undefined) {
        return allowedQuote();
      }
      const evidence = isPersonId(body.identify.entity)
        ? ctx === undefined
          ? 0
          : arrestEvidenceOf(ctx, body.identify.entity)
        : 0;
      return evidence >= arrestThresholdOf(state)
        ? allowedQuote()
        : disallowed(CABLE_IDENTIFY_EVIDENCE_REASON);
    }
    default:
      // Unreachable for a well-typed body; a malformed one is refused, not thrown on.
      return disallowed('HQ does not accept that request');
  }
}

// ---------------------------------------------------------------------------
// Resolve (Req 9.3)
// ---------------------------------------------------------------------------

/**
 * Resolve a {@link CableAction} (design `resolve`; draws nothing). The request
 * goes through `submitCable(body, time, { delayPhases })` with the preset's
 * `traceRequestDelayPhases`, and the PendingCable is appended to
 * `station.pendingCables` (Requirement 9.3). Nothing else in the state changes:
 * the Cable costs no money, and the clock advance is the Turn Pipeline's job.
 *
 * The result is one confirmation `message` Observation ({@link CABLE_SENT_LINES})
 * rendered through `render`, the Station scene, no events and no Claims. A
 * disallowed Cable (re-checked with {@link quoteCable}, so a direct call keeps
 * the contract) returns the state unchanged and an empty result.
 */
export function resolveCable(
  state: WorldState,
  a: CableAction,
  render: (state: WorldState, observations: readonly Observation[]) => string[],
  ctx?: ResolverContext,
): { next: WorldState; result: ActionResult } {
  if (!quoteCable(state, a, ctx).allowed) {
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

  const pending = submitCable(a.body, state.time, {
    delayPhases: cableReplyDelayPhases(state),
  });
  const identify = a.body.kind === 'report' ? a.body.identify : undefined;
  const judged = identify === undefined ? state : applyIdentification(state, identify, ctx);
  const next: WorldState = {
    ...judged,
    station: {
      ...judged.station,
      pendingCables: [...judged.station.pendingCables, pending],
    },
  };

  const observations: Observation[] = [
    {
      kind: 'message',
      line: identify === undefined ? CABLE_SENT_LINES[a.body.kind] : IDENTIFY_REPORT_ACK,
    },
  ];
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
