/**
 * The dialogue {@link Intent} vocabulary, the Talk Scene's {@link SceneKind}
 * vocabulary, and the pure {@link applyIntent} reducer (slice Requirements 4.2,
 * 4.3, 4.4; Requirement 15.5; design "Engine: dialogue turn").
 *
 * The design's governing rule is that a model never writes a fact: the `fast`
 * role (the dialogue package's Intent Classifier) only *labels* the player's
 * line with one of the fixed {@link INTENTS}, and that label is the single
 * model-derived input the Sim acts on. {@link applyIntent} is the Sim side of
 * that contract. It takes the player↔NPC {@link Relationship} and the classified
 * Intent and returns the next Relationship, with trust and suspicion moved by
 * fixed, Intent-keyed deltas. It makes no model call, draws nothing and reads
 * only its arguments, so the same Intent against the same Relationship always
 * yields the same next Relationship. That is what lets a turn be re-run on
 * `retry` and a session be replayed exactly.
 *
 * ## Why this lives in the engine
 *
 * The Turn Pipeline (player-view) applies the Intent to the scene NPC's
 * Relationship on the Draft before the reply streams (Req 15.5), and
 * player-view may not import dialogue. The reducer is a pure Sim transition, so
 * it moved here from the dialogue package and now takes and returns a full
 * {@link Relationship} instead of a trust/suspicion summary. The scene-kind
 * vocabulary moved with it, because the Talk Scene (`player.scene`) is engine
 * state. The dialogue package re-exports every symbol here unchanged, and its
 * turn routing (`routeTurnRole`) reads {@link SceneKind} from this module.
 *
 * Pitch resolution (`resolvePitch`) and its effects are not part of this
 * reducer. The dialogue turn (`applyDialogueTurn`) runs them after
 * {@link applyIntent} for a `pitch-*` Intent.
 *
 * This module is a dependency-light leaf: it imports only the Relationship
 * shape, so the state model can read {@link SceneKind} from it without a cycle.
 */

import type { Relationship } from './asset.js';

// ---------------------------------------------------------------------------
// Intent vocabulary (slice Req 4.2)
// ---------------------------------------------------------------------------

/**
 * The fixed set of dialogue Intents (slice Requirement 4.2). The `fast` role
 * classifies every player line into exactly one of these. The four `pitch-*`
 * values each name the MICE lever a recruitment pitch leans on; the rest cover
 * questioning, rapport, pressure, tasking, chatter and leaving.
 */
export const INTENTS = [
  'ask',
  'pitch-money',
  'pitch-ideology',
  'pitch-coercion',
  'pitch-ego',
  'reassure',
  'threaten',
  'probe',
  'confront',
  'task',
  'small-talk',
  'end',
] as const;

/** One classified dialogue Intent, from the fixed {@link INTENTS} set. */
export type Intent = (typeof INTENTS)[number];

/** Type guard: is `value` one of the fixed {@link INTENTS}? */
export function isIntent(value: unknown): value is Intent {
  return typeof value === 'string' && (INTENTS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Scene kinds (slice Req 4.4; Req 15.2)
// ---------------------------------------------------------------------------

/**
 * The kind of Talk Scene in progress, as the Sim opened it. The three
 * high-stakes kinds are the ones slice Requirement 4.4 names verbatim;
 * `routine` covers every other talk scene (an ordinary conversation, a chance
 * meeting, servicing a contact).
 *
 * - `interrogation`: the player is being questioned, or is questioning a
 *   subject, under pressure.
 * - `recruitment-pitch`: a scene opened to make (or respond to) a recruitment
 *   offer.
 * - `confront-double-agent`: confronting an NPC the player suspects is a
 *   Double Agent.
 * - `routine`: any ordinary, low-stakes conversation.
 */
export const SCENE_KINDS = [
  'interrogation',
  'recruitment-pitch',
  'confront-double-agent',
  'routine',
] as const;

/** One scene kind, from the fixed {@link SCENE_KINDS} set. */
export type SceneKind = (typeof SCENE_KINDS)[number];

// ---------------------------------------------------------------------------
// applyIntent (slice Req 4.3; Req 15.5)
// ---------------------------------------------------------------------------

/**
 * The fixed trust/suspicion deltas each Intent applies, before clamping. Values
 * are deliberately small and hand-tuned to the design's intent of each move:
 *
 * - `ask` / `probe`: probing questions nudge suspicion up a little; a probe
 *   (a pointed, searching question) more than a plain `ask`. Neither builds
 *   trust.
 * - `pitch-*`: a recruitment pitch raises suspicion (the player is showing a
 *   hand) by an amount keyed to how aggressive the lever is — `coercion`
 *   most, `ego` least — and only `ego` and `ideology` buy any trust, by
 *   flattering or appealing to the target.
 * - `reassure`: builds trust and lowers suspicion.
 * - `threaten` / `confront`: both raise suspicion sharply and cost trust;
 *   a confrontation (presenting an accusation) cuts trust hardest.
 * - `task`: handing an Asset work leans on existing rapport — a small trust
 *   gain, a small suspicion cost.
 * - `small-talk`: light rapport, a small trust gain.
 * - `end`: leaving the conversation moves nothing.
 *
 * These are the single source of truth for the step; keeping them in a table
 * (rather than a `switch`) makes the determinism obvious and the balance easy
 * to read.
 */
export const INTENT_DELTAS: Readonly<
  Record<Intent, { readonly trust: number; readonly suspicion: number }>
> = {
  ask: { trust: 0, suspicion: 0.02 },
  'pitch-money': { trust: 0, suspicion: 0.1 },
  'pitch-ideology': { trust: 0.05, suspicion: 0.08 },
  'pitch-coercion': { trust: -0.1, suspicion: 0.2 },
  'pitch-ego': { trust: 0.08, suspicion: 0.05 },
  reassure: { trust: 0.08, suspicion: -0.05 },
  threaten: { trust: -0.15, suspicion: 0.2 },
  probe: { trust: 0, suspicion: 0.05 },
  confront: { trust: -0.2, suspicion: 0.15 },
  task: { trust: 0.03, suspicion: 0.03 },
  'small-talk': { trust: 0.04, suspicion: 0 },
  end: { trust: 0, suspicion: 0 },
};

/** Clamp `n` into the closed unit interval `[0, 1]`. */
function clampUnit(n: number): number {
  if (n < 0) {
    return 0;
  }
  if (n > 1) {
    return 1;
  }
  return n;
}

/**
 * Apply a classified {@link Intent} to the player's {@link Relationship} with
 * an NPC, returning the next Relationship (slice Requirement 4.3; Req 15.5).
 * Pure and deterministic: it reads only its arguments, makes no model call,
 * draws nothing and never mutates the input. The result is a fresh object.
 * `trust` and `suspicion` are moved by the Intent's fixed {@link INTENT_DELTAS}
 * entry and clamped to `[0, 1]`; every other field is carried over unchanged.
 *
 * The Turn Pipeline runs this on the Draft after classification and before the
 * NPC's reply streams, so the model voices the character against the
 * already-updated Relationship.
 *
 * @param rel the current Relationship with the scene's NPC.
 * @param intent the Intent the `fast` role classified the player's line into.
 * @returns the next Relationship, with trust and suspicion updated and clamped.
 */
export function applyIntent(rel: Relationship, intent: Intent): Relationship {
  const delta = INTENT_DELTAS[intent];
  return {
    ...rel,
    trust: clampUnit(rel.trust + delta.trust),
    suspicion: clampUnit(rel.suspicion + delta.suspicion),
  };
}
