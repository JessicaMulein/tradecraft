/**
 * The {@link Action} union and its per-kind variants (design, "Action Resolver
 * (`engine/actions`)").
 *
 * This module is deliberately *dependency-light*: it imports only the core
 * model ids and the Cipher Engine's {@link KeySubmission}, and nothing from
 * `../model/state.ts`. That is what lets `../model/state.ts` re-export
 * {@link Action} from here (so `ActionLogEntry` keeps carrying it) without
 * forming an import cycle — the same reason `DeadDropId`/`InterceptId` live in
 * `../model/core.ts`. The result shapes an action *produces*
 * ({@link import('./result.js').ActionResult} and friends) do depend on the
 * state module's {@link import('../model/state.js').SimEvent}, so they live in
 * `./result.ts`, which state.ts does *not* re-export.
 */

import type {
  ChannelId,
  DeadDropId,
  DocId,
  EntityId,
  GameTime,
  InterceptId,
  ItemId,
  LocId,
  NpcId,
  Proposition,
  UnkId,
} from '../model/core.js';
import type { KeySubmission } from '../cipher/spec.js';
import type { IRouteId, ServiceId } from '../fidelity/types.js';

// ---------------------------------------------------------------------------
// Small shared shapes (kept local to avoid a state.ts import cycle)
// ---------------------------------------------------------------------------

/**
 * A reference to an item changing hands on a drop (the design's `ItemRef`).
 * Structurally identical to `WorldState`'s `ItemRef`; defined here so the
 * Action union does not import `../model/state.ts` (which re-exports this union
 * and would otherwise form a cycle). Task 5.6 / 11.6 flesh out the item side.
 */
export interface ItemRef {
  readonly item: ItemId;
}

/**
 * A Case File Claim id. Mirrors `../model/state.ts`'s `ClaimId` (a plain
 * string, owned by `player-view`); re-declared here for the same cycle-avoidance
 * reason as {@link ItemRef}.
 */
export type ClaimId = string;

/**
 * Where a Proposition Observation came from (slice-integration design,
 * "Observation sources"). Every resolver that perceives a Proposition tags it
 * with its source, so the Turn Pipeline can record each one as a Case File Claim
 * under the right `source` in one step, without inferring it from the action.
 *
 * The union mirrors player-view's `ClaimSource` one to one, with the same kinds
 * and the same field names, so the claim recorder copies a source straight
 * across:
 *
 * - `surveillance`: the player saw it at Location `loc` (`surveil`, `follow`,
 *   `wait`).
 * - `document`: Document `id` asserts it (`read`, and a hostile drop's `copy`).
 * - `intercept`: it was recovered from the broken Intercept `id` (`decrypt`).
 * - `npc`: the NPC `npc` reported it (an Asset's `collect` task).
 * - `liaison`: Service `service` reported it. A liaison claim is what that
 *   service told the player, not ground truth.
 *
 * Declared here, beside the Action union, because it needs only id types; the
 * Observation shape in `./result.ts` imports it.
 */
export type ObservationSource =
  | { readonly kind: 'surveillance'; readonly loc: LocId }
  | { readonly kind: 'document'; readonly id: DocId }
  | { readonly kind: 'intercept'; readonly id: InterceptId }
  | { readonly kind: 'npc'; readonly npc: NpcId }
  | { readonly kind: 'liaison'; readonly service: ServiceId };

// ---------------------------------------------------------------------------
// Per-action payload placeholders (owned by later tasks)
// ---------------------------------------------------------------------------
//
// The design's `Action` union references a handful of payload shapes that other
// tasks own. So the union reads exactly as the design writes it without this
// module importing unwritten modules, each is declared here as a documented
// placeholder; the owning task replaces it with the real shape in place.

// `MiceLever` (the `turn-agent`/`pitch` lever) and `AssetTask` (the `task`
// payload) are owned by the recruitment leaf (task 18.1). They are imported for
// use in the Action variants below and re-exported, type-only, so the Action
// union reads exactly as the design writes it; the recruit modules import only
// the core model and the PRNG, so this does not form a runtime cycle with
// `../model/state.ts` (which re-exports this union).
import type { MiceLever } from '../recruit/asset.js';
import type { AssetTask } from '../recruit/tasking.js';

export type { MiceLever, AssetTask };

/**
 * A Cable request body (`cable`; design, "Action Resolver": "Supported requests
 * are trace, funds and report"). Task 10.2 (Station Cables) fleshes the
 * placeholder out into the discriminated union HQ actually replies to:
 *
 * - `trace`  — ask HQ to trace a known entity or Unidentified Subject; the
 *   reply is a Dossier drawn from the Station's Knowledge Slice (Req 27.4).
 * - `funds`  — request Budget; the reply credits the ledger by an amount
 *   determined by Standing, capped and cooled down by the preset (Req 27.5).
 * - `report` — file a report with HQ; the reply adjusts Standing.
 *
 * The `trace` target is an {@link EntityId} (an `npc:`/`unk:`/… id). `funds` may
 * name a requested `amount` (HQ grants up to the Standing-scaled cap). `report`
 * carries free-text `body` and an optional Standing hint; the Sim decides the
 * actual Standing move. The field names stay a plain, truth-free request shape
 * so the `cable` action resolver can hand `action.body` straight to the station
 * module's cable-submit function.
 */
export type CableRequest =
  | { readonly kind: 'trace'; readonly target: EntityId }
  | { readonly kind: 'funds'; readonly amount?: number }
  | {
      readonly kind: 'report';
      readonly body: string;
      /**
       * An identification report (plot-library Req 10.4). `quote` allows it
       * only from the Case File evidence count. The acknowledgement is the
       * same whether the named entity holds `roleTag`.
       */
      readonly identify?: { readonly entity: EntityId; readonly roleTag: string };
    };

/**
 * A composed Proposition the player authors for a feed (`feed`; design, "Feed
 * composition": `ComposedProposition`). It mirrors a {@link Proposition} but
 * carries no minted `id` — `validateFeed` mints one when it accepts the item —
 * so the player composes `(predicate, subject, object, place?, window?)` from
 * the Predicate Vocabulary and their known entities and the Sim assigns the id.
 */
export interface ComposedProposition {
  readonly predicate: Proposition['predicate'];
  readonly subject: Proposition['subject'];
  readonly object: Proposition['object'];
  readonly place?: Proposition['place'];
  readonly window?: Proposition['window'];
}

/**
 * One item fed to a turned agent (`feed`; design, "Feed composition":
 * `FeedItem`). Either a Case File Claim named by its {@link ClaimId} (the player
 * feeds a Claim they already hold) or a {@link ComposedProposition} the player
 * authored. `validateFeed` resolves and validates each into a concrete
 * {@link Proposition} (owned by task 18.6 / Feed).
 */
export type FeedItem =
  | { readonly from: 'claim'; readonly claim: ClaimId }
  | { readonly from: 'composed'; readonly prop: ComposedProposition };

// ---------------------------------------------------------------------------
// The Action union
// ---------------------------------------------------------------------------

/**
 * The player action union (design, "Action Resolver"). This is the real
 * discriminated union the skeleton `Action` in `../model/state.ts` is replaced
 * by; `WorldState` and `ActionLogEntry` re-export it under the same name.
 *
 * Grade, link, note and help are Case File / view operations with no time cost
 * (they are {@link import('../model/state.js').ViewOp}s on the view side), so
 * they are not actions here.
 */
export type Action =
  | TalkAction
  | ApproachAction
  | TravelAction
  | ArrangeMeetingAction
  | SurveilAction
  | FollowAction
  | ServiceDropAction
  | InterceptAction
  | DecryptAction
  | ReadAction
  | CableAction
  | TaskAction
  | PayAction
  | ConfrontAction
  | ArrestAction
  | TurnAgentAction
  | FeedAction
  | AttendDutyAction
  | WaitAction
  | DepartAction
  | RequestPapersAction
  | ApplyVisaAction
  | LiaisonRequestAction
  | LiaisonShareAction
  | ExfiltrateAction;

/** A kind tag of an {@link Action}. */
export type ActionKind = Action['kind'];

// ---------------------------------------------------------------------------
// The Meeting data model (design, "Data Models" `Meeting`; owned by task 11.5)
// ---------------------------------------------------------------------------

/**
 * The status of a {@link Meeting} through its life:
 *
 * - `proposed` — arranged but the reply has not been drawn (reserved for a
 *   pipeline that stages the proposal before the reply draw).
 * - `accepted` / `declined` — the NPC's reply (Req 24.3).
 * - `kept` — both parties were present at the slot and a talk scene opened
 *   (Req 24.2).
 * - `no-show` — the NPC did not appear at the slot (Req 24.4).
 * - `missed` — the player did not appear at the slot; trust drops (Req 24.4).
 * - `void` — the NPC was arrested before the slot (an arrest consequence of
 *   the Hostile tick), so the meeting cannot take place. A player who attends
 *   it gets a `meeting-no-show` (slice-integration Req 3.10).
 */
export type MeetingStatus =
  | 'proposed'
  | 'accepted'
  | 'declined'
  | 'kept'
  | 'no-show'
  | 'missed'
  | 'void';

/**
 * An arranged meeting (the design's `Meeting`; owned by task 11.5's
 * `../action/arrange-meeting.ts` behaviour). The record *shape* lives in this
 * dependency-light module — alongside the {@link Action} union — for the same
 * cycle-avoidance reason {@link ItemRef} does: `../model/state.ts` re-exports it
 * (so `WorldState.meetings` keeps its type) while the arrange-meeting resolvers,
 * which must import `WorldState`, keep this module free of a state import. The
 * `MeetingId` discriminant stays in `../model/core`-adjacent `../model/state.ts`
 * (a `meeting:${string}`), re-declared here as the same literal shape to avoid a
 * state import.
 */
export interface Meeting {
  readonly id: `meeting:${string}`;
  /** The NPC the player arranged the meeting with. */
  readonly npc: NpcId;
  /** Where the meeting is to take place. */
  readonly at: LocId;
  /** When the meeting is to take place (the slot). */
  readonly slot: GameTime;
  /** The meeting's current status (Req 24.3, 24.2, 24.4). */
  readonly status: MeetingStatus;
  /** The acceptance σ probability the reply was drawn against (Req 24.2). */
  readonly acceptance: number;
}

/** Open a Dialogue Loop with a present NPC (owned by task 11.4). */
export interface TalkAction {
  readonly kind: 'talk';
  readonly npc: NpcId | UnkId;
}

/** Cold-approach an NPC for first contact (owned by task 11.x). */
export interface ApproachAction {
  readonly kind: 'approach';
  readonly npc: NpcId | UnkId;
}

/** Travel to another Location, optionally by a countersurveillance route. */
export interface TravelAction {
  readonly kind: 'travel';
  readonly to: LocId;
  readonly countersurveillance: boolean;
}

/** Arrange a meeting with an NPC at a Location and slot (owned by task 11.5). */
export interface ArrangeMeetingAction {
  readonly kind: 'arrange-meeting';
  readonly npc: NpcId;
  readonly at: LocId;
  readonly slot: GameTime;
}

/** Surveil a Location for one or two phases (owned by task 11.3). */
export interface SurveilAction {
  readonly kind: 'surveil';
  readonly at: LocId;
  readonly phases: 1 | 2;
}

/** Follow a target through the current phase (owned by task 11.3). */
export interface FollowAction {
  readonly kind: 'follow';
  readonly target: NpcId | UnkId;
}

/** Service a Dead Drop (owned by task 11.6). */
export interface ServiceDropAction {
  readonly kind: 'service-drop';
  readonly drop: DeadDropId;
  readonly leave: readonly ItemRef[];
  readonly hostileMode?: 'copy' | 'seize';
}

/** Collect enemy traffic (owned by the Cipher Engine's intercept task). */
export interface InterceptAction {
  readonly kind: 'intercept';
  readonly channel?: ChannelId;
}

/** Submit a decryption of an Intercept (owned by the Cipher Engine). */
export interface DecryptAction {
  readonly kind: 'decrypt';
  readonly intercept: InterceptId;
  readonly submission: KeySubmission;
}

/** Read a Document (owned by task 9.2). */
export interface ReadAction {
  readonly kind: 'read';
  readonly doc: DocId;
}

/** Send a Cable to the Station (owned by task 10.2). */
export interface CableAction {
  readonly kind: 'cable';
  readonly body: CableRequest;
}

/** Task an Asset (owned by task 11). */
export interface TaskAction {
  readonly kind: 'task';
  readonly asset: NpcId;
  readonly task: AssetTask;
}

/** Pay an NPC a Budget amount (owned by task 11). */
export interface PayAction {
  readonly kind: 'pay';
  readonly npc: NpcId;
  readonly amount: number;
}

/** Confront an NPC with a Case File Claim (owned by task 11 / Arrest). */
export interface ConfrontAction {
  readonly kind: 'confront';
  readonly npc: NpcId;
  readonly claim: ClaimId;
}

/** Request an arrest (owned by the Arrest Evidence task). */
export interface ArrestAction {
  readonly kind: 'arrest';
  readonly npc: NpcId | UnkId;
}

/** Turn an Asset into a Double Agent (owned by task 11 / Recruitment). */
export interface TurnAgentAction {
  readonly kind: 'turn-agent';
  readonly npc: NpcId;
  readonly lever: MiceLever;
  readonly offer?: number;
}

/** Feed a turned agent (owned by task 19 / Feed). */
export interface FeedAction {
  readonly kind: 'feed';
  readonly asset: NpcId;
  readonly items: readonly FeedItem[];
  readonly label?: 'credibility' | 'deceive';
}

/** Keep a cover-duty slot at its location. */
export interface AttendDutyAction {
  readonly kind: 'attend-duty';
  readonly duty: string;
}

/** Book an intercity departure. */
export interface DepartAction {
  readonly kind: 'depart';
  readonly route: `route:${string}`;
  readonly at: GameTime;
  readonly papers: readonly `paper:${string}`[];
}

/** Ask the station to issue a travel document. */
export interface RequestPapersAction {
  readonly kind: 'request-papers';
  readonly doc: string;
  readonly holder: 'player' | NpcId;
}

/** Apply for a visa at a consulate. */
export interface ApplyVisaAction {
  readonly kind: 'apply-visa';
  readonly country: string;
}

/** Ask a liaison service about a known entity, or for border crossing records. */
export interface LiaisonRequestAction {
  readonly kind: 'liaison-request';
  readonly service: ServiceId;
  readonly about: EntityId;
  readonly records?: boolean;
}

/** Give a liaison service propositions from the case file. */
export interface LiaisonShareAction {
  readonly kind: 'liaison-share';
  readonly service: ServiceId;
  readonly props: readonly Proposition[];
}

export interface ExfiltrateAction {
  readonly kind: 'exfiltrate';
  readonly asset: NpcId;
  readonly route: IRouteId;
  readonly at: GameTime;
  readonly papers: readonly `paper:${string}`[];
}

/** Let time pass for 1–4 phases. */
export interface WaitAction {
  readonly kind: 'wait';
  readonly phases: 1 | 2 | 3 | 4;
}
