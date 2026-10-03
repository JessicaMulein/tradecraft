/**
 * The result shapes an action produces (design `ActionQuote` / `ActionResult`):
 * {@link ActionQuote}, {@link Observation}, {@link SceneDescriptor},
 * {@link TalkSceneRequest}, {@link ActionResult} and the {@link ResolverContext}
 * the pure `quote`/`resolve` thread through.
 *
 * These are kept separate from the {@link Action} union (`./types.ts`) because
 * they depend on the state module's {@link SimEvent} and {@link ClaimId}, and
 * `../model/state.ts` re-exports the Action union — so the union must stay free
 * of a state import to avoid a cycle, while these result shapes are *not*
 * re-exported by state and may import it freely.
 */

import type { GameTime, LocId, NpcId, Proposition } from '../model/core.js';
import type { ClaimId, SimEvent } from '../model/state.js';
import type { ContentSet } from '@tradecraft/content';
import type { UnkId } from '../model/core.js';
import type { TruthAccess } from '../truth/truth.js';
import type { CipherKeyLookup } from '../cipher/spec.js';
import type { ObservationSource } from './types.js';

/**
 * The cost and eligibility of an {@link import('./types.js').Action}, as shown
 * in the UI before the player commits (design `ActionQuote`; Requirement 13.2).
 * `allowed` is `false` when the action is disallowed at its Location, the
 * Location is closed, the Budget cannot cover `money`, or the action's own
 * precondition fails; `reason` carries the player-facing explanation. `phases`
 * and `money` are the exact costs `resolve` will apply.
 */
export interface ActionQuote {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly phases: number;
  readonly money: number;
}

/**
 * A single result of an action, before it is rendered to a Fact Line. An
 * Observation is either a {@link Proposition} the player perceived (which also
 * becomes a Case File Claim, filed under its {@link ObservationSource}) or a
 * plain templated event with no Proposition (a brush-off, a "you may have been
 * made" line). Rendering turns a Proposition Observation into a Fact Line
 * through the predicate third-person template; a `message` Observation already
 * carries its own line.
 */
export type Observation =
  | {
      readonly kind: 'proposition';
      readonly prop: Proposition;
      /** When the player perceived it (stamped on the resulting Claim). */
      readonly at: GameTime;
      /**
       * Where the player perceived it: the source the resulting Case File Claim
       * is filed under (mirrors player-view's `ClaimSource`).
       */
      readonly source: ObservationSource;
    }
  | {
      readonly kind: 'message';
      /** A ready-made Fact Line (not a Proposition, so not a Claim). */
      readonly line: string;
    };

/**
 * The scene the Narrator is handed after an action (design, Narrator input;
 * Requirement 20.2): the Location's description and atmosphere tags, its risk,
 * and the persons visible there by id (the player-view layer renders them by
 * name or descriptor). `crowd` is omitted here because the crowd band needs the
 * loaded weather, which the Turn Pipeline supplies; the framework fills in what
 * it can purely from {@link import('../model/state.js').WorldState}.
 */
export interface SceneDescriptor {
  readonly loc: LocId;
  readonly description: string;
  readonly atmosphere: readonly string[];
  readonly risk: number;
  /** NPCs scheduled at the scene's Location at the current time. */
  readonly visible: readonly NpcId[];
}

/**
 * A request to open a talk scene (design `openScene?: TalkSceneRequest`). The
 * Dialogue Loop (task 11.4) owns the scene machinery; the framework carries
 * only the handle so an action that opens a scene (talk, approach, a kept
 * meeting) can signal it. Kept minimal until task 11.4 fills it in.
 */
export interface TalkSceneRequest {
  readonly npc: NpcId | UnkId;
}

/**
 * Everything an action produces (design `ActionResult`). `observations` are the
 * raw results; `factLines` are those observations rendered through the
 * predicate third-person templates with the player namer (Requirement 20.1).
 * `scene` is the Narrator's scene descriptor. `openScene` is set when the action
 * opens a talk scene. `events` are the {@link SimEvent}s the action minted.
 * `claimsAdded` names the Case File Claims the player-view layer should add for
 * each Proposition Observation (the framework reports the ids; the view side
 * records them).
 */
export interface ActionResult {
  readonly observations: readonly Observation[];
  readonly factLines: readonly string[];
  readonly scene: SceneDescriptor;
  readonly openScene?: TalkSceneRequest;
  readonly events: readonly SimEvent[];
  readonly claimsAdded: readonly ClaimId[];
}

/**
 * The context `quote` and `resolve` need beyond the
 * {@link import('../model/state.js').WorldState}: the loaded {@link ContentSet}.
 * The engine's `Location` carries only its Location Type *id* and its folded
 * per-phase opening hours; the set of actions a Location Type *allows* lives in
 * content, so the resolver reads it from here (Requirement 21.5). The predicate
 * registry on the content set drives Fact Line rendering (Requirement 20.1).
 */
export interface ResolverContext {
  readonly content: ContentSet;
  /**
   * The ground truth, for the actions whose resolve *writes* to it: the Truth
   * Store itself, or the turn's `TruthDraft` over it
   * (`../truth/truth-draft.ts`), which stages the writes until the turn commits
   * and shows them to every later read in the turn. Most actions (travel,
   * read, wait) are pure reads of the
   * {@link WorldState} and ignore this field; `surveil` and `follow` (task 11.3),
   * however, observe NPCs the player has not identified, which allocates stable
   * `unk:N` ids through the Unidentified-Subject machinery (`./identify.ts`) and
   * records the `identityOf(unk) = npc` mapping in the Truth Store. Those two
   * resolvers require a `truth` to be present; a resolver that omits it simply
   * never allocates (so it is backward-compatible with the existing callers that
   * never pass one). Kept optional so travel/read/wait and their specs compile
   * unchanged.
   */
  readonly truth?: TruthAccess;
  /**
   * The Case File Claims the player holds, keyed by {@link ClaimId}, as the
   * bare {@link Proposition} each one asserts. The **confront** action
   * (`{ kind:'confront'; npc; claim }`, task 18.3) names a Claim by id, but the
   * Case File is a Player-View store the engine resolver cannot reach, so the
   * Turn Pipeline (which holds the Case File) projects the Claims' Propositions
   * here for the resolver to read the confronting evidence from (Req 6.4). Most
   * actions ignore this field; a resolver that needs a Claim and finds no entry
   * treats the confront as unsupported (its quote is `allowed: false`). Kept
   * optional so every existing caller — which constructs `{ content }` or
   * `{ content, truth }` — compiles unchanged.
   */
  readonly claims?: Readonly<Record<ClaimId, Proposition>>;
  /**
   * The {@link SimEvent}s that fire over the window an *observing* action
   * watches, in time order (task 26.6). Surveillance observes **events** at a
   * Location — a `meeting`, a `drop-loaded`/`drop-emptied`, an `npc-moved` — not
   * mere co-presence; so `surveil`, `follow` and `wait` enumerate the events at
   * the watched Location in their window and run the design's observation check
   * on each (design, "Surveil"). The Turn Pipeline (task 16.8) runs the clock
   * over the watched span and supplies the events it produced here; when a
   * caller omits them, the resolvers fall back to `WorldState.scheduled` (the
   * future-events queue), so an observation path always has a source and is
   * backward-compatible with callers that never pass one. A `meeting` the player
   * observes becomes a `MEETS_AT` Claim; co-presence with no meeting event
   * surfaces only as `LOCATED_AT` sightings, never as a meeting (Req 23.1).
   */
  readonly events?: readonly SimEvent[];
  /**
   * Player-side turn-agent leverage inputs the Turn Pipeline projects for the
   * **turn-agent** action (`{ kind:'turn-agent'; npc; lever; offer? }`, task
   * 18.5). The engine resolver decides turn eligibility only from Player-View
   * and Case File data (Req 36.2), but the arrest-evidence count
   * (`evidenceCount`, task 4.7) and whether a talk scene with the NPC is open
   * live on the view side; so the pipeline supplies them here, keyed by
   * {@link NpcId}:
   *
   * - `evidenceCount` — the number of corroborated Implicating Claims the Case
   *   File holds against the NPC (the `evidence` leverage gate and the `L`
   *   evidence scale, Req 36.1);
   * - `sceneOpen` — whether a talk scene with that NPC is currently open (the
   *   `evidence` leverage requires it, Req 36.1).
   *
   * Most actions ignore this field; a `turn-agent` quote with no entry for its
   * target simply finds no `evidence` leverage (it may still qualify on custody
   * or an observed crack). Kept optional so every existing caller compiles
   * unchanged. It carries only player-side counts and flags, never ground truth.
   */
  readonly turnEvidence?: Readonly<
    Record<NpcId, { readonly evidenceCount: number; readonly sceneOpen: boolean }>
  >;
  /**
   * The player-side arrest-evidence count the Turn Pipeline projects for the
   * **arrest** action (`{ kind:'arrest'; npc: NpcId | UnkId }`, task 20.1),
   * keyed by the target id (an {@link NpcId} or an {@link UnkId}). The arrest
   * gate grants an arrest only when the Case File holds at least the preset's
   * `arrest.threshold` corroborated Implicating Claims against the target
   * (Req 19.1, 40.4); that count is `evidenceCount(cf, target, …)` (task 4.7),
   * a pure Player-View figure the engine resolver cannot compute because the
   * Case File is a view-side store. So — exactly as `turnEvidence` carries the
   * turn-agent evidence count — the pipeline projects the per-target arrest
   * `evidenceCount` here for `quoteArrest` to compare against the threshold.
   *
   * Most actions ignore this field; an arrest quote with no entry for its
   * target reads a count of `0` (so the gate fails unless the threshold is
   * non-positive). Kept optional so every existing caller — which constructs
   * `{ content }` or `{ content, truth }` — compiles unchanged. It carries only
   * a player-side count, never ground truth.
   */
  readonly arrestEvidence?: Readonly<Record<NpcId | UnkId, number>>;
  /**
   * The cipher key material the **decrypt** action verifies a submission
   * against (slice-integration design, "`decrypt`"; Req 8.3): the public-text
   * content a book cipher keys to and the letter stream of each one-time pad.
   * `verifySubmission` resolves both the Intercept's true spec and a key
   * submission's guessed spec through it. The Turn Pipeline's Resolver Context
   * projection supplies it (slice-integration task 7.3), from the same lookup
   * the clock mints Intercepts with.
   *
   * Most actions ignore this field. When a caller omits it, `decrypt` falls back
   * to the world's own deterministic lookup, `worldCipherKeyLookup(meta.seed,
   * documents)`: the lookup generation enciphered the seeded traffic with. Kept
   * optional so every existing caller compiles unchanged. It is Sim-side key
   * material for verification and never crosses into a Player View projection.
   */
  readonly cipherKeys?: CipherKeyLookup;
}
