/**
 * Station Cables: the player's `trace`/`funds`/`report` requests to HQ and the
 * replies the Chief sends back after a delay (design, "Action Resolver" —
 * "Supported requests are trace, funds and report. Replies arrive as Cable
 * Documents after the preset delay"; Requirements 27.4, 27.5).
 *
 * A Cable the player sends does not resolve at once: HQ answers after the delay
 * the Difficulty Preset sets (`traceRequestDelayPhases`). So a sent Cable
 * becomes a {@link PendingCable} — the request, when it was sent, when the reply
 * is due, and what the reply will do — and sits on `WorldState.station.
 * pendingCables` until its due time. Each phase/day the Turn Pipeline calls
 * {@link processDueCables}, which turns every now-due PendingCable into its
 * reply:
 *
 * - **trace** (Req 27.4): HQ returns a Dossier on the traced entity, drawn from
 *   the Station's Knowledge Slice (apparent facts and HQ false beliefs alike).
 *   The reply composes a Cable Document that *carries* the Dossier reference and
 *   delivers a `cable` SimEvent; the Dossier itself is composed by the Document
 *   Generator (`composeDossier`) on the Pipeline side, which holds the slice and
 *   the subject Npc. This module decides *that* a trace is answered and *what*
 *   it grants (a dossier for the subject), not how the HQ file reads.
 * - **funds** (Req 27.5): HQ grants an amount determined by Standing —
 *   `fundsBase × (1 + standing/10)`, clamped to `[0, cap]` — and credits the
 *   Budget ledger (reason `funds-grant`), *at most once per two days* (design).
 *   A request inside the cooldown replies with a zero grant and no credit.
 * - **report** (design): filing a report nudges Standing. The reply adjusts
 *   Standing by a small fixed amount and delivers a `cable` SimEvent.
 *
 * Every reply is delivered as a player-visible `cable` SimEvent naming the reply
 * Cable Document's id. The grant amount, Standing move and dossier target are
 * returned as a {@link CableReply} the Pipeline applies (credit the ledger,
 * compose the reply Cable through {@link composeCable}, compose the trace
 * Dossier). Replies are deterministic — no PRNG draw — so a `Prng` is accepted
 * only to match the pure-function convention and is left untouched.
 *
 * Everything here is pure: {@link submitCable} and {@link processDueCables}
 * return new values and mutate nothing.
 */

import {
  compareTime,
  timeToPhases,
  type DocId,
  type GameTime,
} from '../model/core.js';
import type { CableRequest } from '../action/types.js';
import type { EventId, SimEvent } from '../model/state.js';
import { credit, type Ledger } from './ledger.js';
import type { CableReplySpec, PendingCable } from './cable-types.js';

// ---------------------------------------------------------------------------
// Preset-derived constants (documented defaults; no preset field exists yet)
// ---------------------------------------------------------------------------

/**
 * The default HQ reply delay, in phases, when the preset carries none. The
 * preset's `traceRequestDelayPhases` is the real delay; this is the fallback a
 * caller passes when it has no preset to read (and the documented default the
 * design's "preset delay" collapses to). Four phases is one full day.
 */
export const DEFAULT_CABLE_DELAY_PHASES = 4;

/**
 * The base funds grant, before the Standing multiplier. The design's funds
 * formula is `fundsBase × (1 + Standing/10)`; the preset names a
 * `startingBudget` but no explicit `fundsBase`, so this is the documented base
 * a caller passes when it derives none from the preset.
 */
export const DEFAULT_FUNDS_BASE = 100;

/**
 * The default cap on a single funds grant. The design caps the grant "by the
 * preset"; with no preset cap field, this is the documented ceiling.
 */
export const DEFAULT_FUNDS_CAP = 1000;

/**
 * The funds-grant cooldown, in days: a funds request grants at most once per two
 * days (design). A request whose previous grant was fewer than this many days
 * ago replies with a zero grant.
 */
export const FUNDS_COOLDOWN_DAYS = 2;

/** The Standing a filed `report` moves when the report says something. */
export const REPORT_STANDING_DELTA = 1;

/** How many letters a report must contain before HQ treats it as filed. */
const REPORT_MIN_LETTERS = 8;

/**
 * Standing for a report. A blank or token cable adds nothing. A report with a
 * real sentence is filed and moves Standing by {@link REPORT_STANDING_DELTA}.
 */
export function reportStandingDelta(body: string): number {
  const letters = body.replace(/[^A-Za-z]/g, '');
  return letters.length >= REPORT_MIN_LETTERS ? REPORT_STANDING_DELTA : 0;
}

/** Phases in a day — the delay is counted in phases, the cooldown in days. */
const PHASES_PER_DAY = 4;

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

/** Options for {@link submitCable}. */
export interface SubmitCableOptions {
  /** The reply delay in phases (the preset's `traceRequestDelayPhases`). */
  readonly delayPhases?: number;
}

/** Add `phases` to a {@link GameTime}, carrying into the day counter. */
function addPhases(at: GameTime, phases: number): GameTime {
  const total = timeToPhases(at) + Math.max(0, Math.trunc(phases));
  return {
    day: Math.floor(total / PHASES_PER_DAY),
    phase: (total % PHASES_PER_DAY) as GameTime['phase'],
  };
}

/** A stable, deterministic id for a PendingCable from its request and time. */
function pendingCableId(request: CableRequest, sentAt: GameTime): string {
  const tag =
    request.kind === 'trace'
      ? `trace:${request.target}`
      : request.kind === 'funds'
        ? `funds:${request.amount ?? ''}`
        : request.identify === undefined
          ? 'report'
          : `report:${request.identify.entity}:${request.identify.roleTag}`;
  return `cable:${tag}:${sentAt.day}:${sentAt.phase}`;
}

/** Build the {@link CableReplySpec} for a request. */
function replySpecFor(request: CableRequest): CableReplySpec {
  switch (request.kind) {
    case 'trace':
      return { kind: 'trace', target: request.target };
    case 'funds':
      return { kind: 'funds', requested: request.amount };
    case 'report':
      return { kind: 'report', standingDelta: reportStandingDelta(request.body) };
  }
}

/**
 * Submit a Cable request, producing the {@link PendingCable} to append to
 * `station.pendingCables` (Requirements 27.4, 27.5). Pure: builds the pending
 * record whose reply is due `delayPhases` phases after `sentAt` (the preset's
 * `traceRequestDelayPhases`, falling back to {@link DEFAULT_CABLE_DELAY_PHASES}).
 * The `cable` action resolver (a separate task) calls this with `action.body`.
 */
export function submitCable(
  request: CableRequest,
  sentAt: GameTime,
  options: SubmitCableOptions = {},
): PendingCable {
  const delay = options.delayPhases ?? DEFAULT_CABLE_DELAY_PHASES;
  return {
    id: pendingCableId(request, sentAt),
    request,
    sentAt,
    replyDue: addPhases(sentAt, delay),
    reply: replySpecFor(request),
  };
}

// ---------------------------------------------------------------------------
// Process due replies
// ---------------------------------------------------------------------------

/**
 * The funds grant an entry would make at `standing`, before the cooldown gate:
 * `fundsBase × (1 + standing/10)`, clamped to `[0, cap]` and rounded down to a
 * whole currency unit (design's funds formula and preset cap). A request that
 * named a smaller `requested` amount is granted the smaller of the two.
 */
export function fundsGrantAmount(
  standing: number,
  requested: number | undefined,
  base: number,
  cap: number,
): number {
  const scaled = base * (1 + standing / 10);
  const bounded = Math.min(cap, Math.max(0, scaled));
  const target = requested === undefined ? bounded : Math.min(bounded, Math.max(0, requested));
  return Math.floor(target);
}

/** True when a funds grant is allowed at `now` given the last grant time. */
export function fundsCooldownElapsed(
  now: GameTime,
  lastGrant: GameTime | undefined,
): boolean {
  if (lastGrant === undefined) {
    return true;
  }
  const daysSince = (timeToPhases(now) - timeToPhases(lastGrant)) / PHASES_PER_DAY;
  return daysSince >= FUNDS_COOLDOWN_DAYS;
}

/** The reply Cable Document id a delivered reply names. */
function replyCableDocId(pending: PendingCable, at: GameTime): DocId {
  return `doc:cable/reply-${pending.request.kind}-${at.day}-${at.phase}` as DocId;
}

/** A stable, deterministic event id for a delivered reply. */
function cableEventId(doc: DocId, at: GameTime): EventId {
  return `cable-evt:${doc}:${at.day}:${at.phase}`;
}

/**
 * One delivered Cable reply: the `cable` SimEvent to publish, the ledger after
 * any funds credit, the Standing after any report/trace move, the funds amount
 * granted (0 when none), whether a funds grant actually landed (so the caller
 * updates `lastFundsGrant`), and — for a trace — the entity whose Dossier the
 * Pipeline composes and the reply Cable's DocId.
 */
export interface CableReply {
  readonly pending: PendingCable;
  readonly event: SimEvent;
  readonly doc: DocId;
  readonly ledger: Ledger;
  readonly standing: number;
  readonly fundsGranted: number;
  readonly didGrantFunds: boolean;
  /** The trace target whose Dossier the Pipeline composes, if this is a trace. */
  readonly traceTarget?: string;
}

/** The slice of `WorldState.station` {@link processDueCables} reads/rewrites. */
export interface CableStationSlice {
  readonly pendingCables: readonly PendingCable[];
  readonly standing: number;
  readonly ledger: Ledger;
  readonly lastFundsGrant?: GameTime;
}

/** The funds knobs a funds reply reads (documented defaults, or preset-derived). */
export interface FundsPolicy {
  readonly base: number;
  readonly cap: number;
}

/** The result of processing the due PendingCables at a time. */
export interface ProcessDueCablesResult {
  /** The PendingCables still awaiting their reply (the not-yet-due ones). */
  readonly pendingCables: readonly PendingCable[];
  /** The Standing after applying every delivered reply. */
  readonly standing: number;
  /** The Budget ledger after crediting every funds grant. */
  readonly ledger: Ledger;
  /** The last funds-grant time (updated when a funds grant landed). */
  readonly lastFundsGrant?: GameTime;
  /** The `cable` SimEvents to publish, one per delivered reply. */
  readonly events: readonly SimEvent[];
  /** The replies, in delivery order, for the Pipeline to compose Documents from. */
  readonly replies: readonly CableReply[];
}

/**
 * Deliver every PendingCable whose reply is due at or before `now`
 * (Requirements 27.4, 27.5). Pure: the input slice is untouched.
 *
 * A PendingCable is due when `now` is at or after its `replyDue`. Due cables are
 * processed in list order; a cable not yet due is kept for a later phase and
 * produces no reply. Each due cable is turned into its reply:
 *
 * - `funds` — grant `fundsGrantAmount(standing, requested, base, cap)` and
 *   credit the ledger, *unless* the two-day cooldown has not elapsed, in which
 *   case the grant is 0 and the ledger is untouched. A grant that lands advances
 *   `lastFundsGrant` to `now`, so a second funds reply in the same window is
 *   gated.
 * - `report` — move Standing by the reply's `standingDelta`.
 * - `trace` — leave Standing and the ledger as they are and carry the trace
 *   `target` out on the reply, so the Pipeline composes the Dossier.
 *
 * Every reply appends a player-visible `cable` SimEvent naming its reply Cable
 * Document id. `prng` is accepted for the pure-function convention; replies are
 * deterministic, so it is never drawn.
 */
export function processDueCables(
  station: CableStationSlice,
  now: GameTime,
  funds: FundsPolicy,
): ProcessDueCablesResult {
  const stillPending: PendingCable[] = [];
  const events: SimEvent[] = [];
  const replies: CableReply[] = [];

  let standing = station.standing;
  let ledger = station.ledger;
  let lastFundsGrant = station.lastFundsGrant;

  for (const pending of station.pendingCables) {
    if (compareTime(now, pending.replyDue) < 0) {
      stillPending.push(pending);
      continue;
    }

    const doc = replyCableDocId(pending, now);
    const event: SimEvent = {
      id: cableEventId(doc, now),
      at: now,
      visibility: 'player',
      kind: 'cable',
      doc,
    };

    let fundsGranted = 0;
    let didGrantFunds = false;
    let traceTarget: string | undefined;

    switch (pending.reply.kind) {
      case 'funds': {
        if (fundsCooldownElapsed(now, lastFundsGrant)) {
          fundsGranted = fundsGrantAmount(
            standing,
            pending.reply.requested,
            funds.base,
            funds.cap,
          );
          if (fundsGranted > 0) {
            ledger = credit(ledger, fundsGranted, 'funds-grant', now, pending.id);
            didGrantFunds = true;
            lastFundsGrant = now;
          }
        }
        break;
      }
      case 'report': {
        standing += pending.reply.standingDelta;
        break;
      }
      case 'trace': {
        traceTarget = pending.reply.target;
        break;
      }
    }

    const reply: CableReply = {
      pending,
      event,
      doc,
      ledger,
      standing,
      fundsGranted,
      didGrantFunds,
      ...(traceTarget !== undefined ? { traceTarget } : {}),
    };
    replies.push(reply);
    events.push(event);
  }

  return {
    pendingCables: stillPending,
    standing,
    ledger,
    lastFundsGrant,
    events,
    replies,
  };
}
