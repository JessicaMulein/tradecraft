/**
 * Turn routing by scene stakes — the pure decision that picks which Model Role
 * voices a dialogue turn's NPC reply (Requirement 4.4).
 *
 * The design's Dialogue Loop streams the NPC's reply from `V` — the
 * "voice/fast role (role by stakes)" branch in the sequence diagram. This
 * module *is* that branch, pulled out as a pure function so the Turn Pipeline
 * can decide the role deterministically, with no model call, before it opens
 * the reply stream. Requirement 4.4 fixes the rule: a turn goes to the `voice`
 * role when the scene is high-stakes — an interrogation, a recruitment pitch,
 * or confronting a suspected Double Agent — and to the `fast` role otherwise.
 *
 * The decision reads only its arguments and returns the same role for the same
 * inputs, so a turn can be re-run on `retry` and a session replayed exactly
 * (design "Turn Pipeline"): the role is never a fresh model-side choice, it is
 * a function of the scene the Sim already knows.
 *
 * ## What makes a scene high-stakes
 *
 * Two independent sources can raise a turn to high-stakes, matching the
 * requirement's parenthetical list:
 *
 * - **The scene's own kind.** A scene the Sim has already opened as an
 *   {@link SceneKind | interrogation, recruitment pitch, or Double-Agent
 *   confrontation} is high-stakes for its whole duration. These are the three
 *   kinds the requirement names verbatim.
 * - **The player's move this turn.** Even inside a scene the Sim opened as
 *   routine, a single line can escalate the moment: a recruitment pitch
 *   (any `pitch-*` Intent) or a confrontation (`confront`) is exactly the
 *   kind of high-stakes beat the requirement calls out, so a turn carrying one
 *   of those Intents is voiced by `voice` regardless of the opening kind.
 *
 * Everything else — routine questioning, rapport, chatter, tasking, leaving —
 * stays on `fast`. The `voice` dense model is the scarce, slower resource
 * (design "LLM Gateway": at most two models resident, a dense `voice` and an
 * MoE `fast`; Req 14.5, 15.3), so the rule spends it only on the beats that
 * carry dramatic weight and routes the rest to the cheap, fast model.
 */

import { SCENE_KINDS, type Intent, type SceneKind } from '@tradecraft/engine';
import type { Role } from '@tradecraft/llm';

/**
 * The kind of dialogue scene in progress, as the Sim opened it
 * (`interrogation`, `recruitment-pitch`, `confront-double-agent` or
 * `routine`). The Talk Scene is engine state, so {@link SCENE_KINDS} and
 * {@link SceneKind} live in the engine beside the Intent vocabulary
 * (`recruit/intent.ts`). They are re-exported here unchanged, so the dialogue
 * barrel's surface stays the same.
 */
export { SCENE_KINDS, type SceneKind };

/**
 * The three scene kinds the requirement names as high-stakes. A scene opened as
 * one of these is high-stakes for its whole duration, independent of the
 * current turn's Intent. Kept as a `Set` so the stakes test is a single
 * membership check and stays in lockstep with {@link SCENE_KINDS}.
 */
const HIGH_STAKES_SCENE_KINDS: ReadonlySet<SceneKind> = new Set<SceneKind>([
  'interrogation',
  'recruitment-pitch',
  'confront-double-agent',
]);

/**
 * The player Intents that make a single turn high-stakes even inside a scene
 * the Sim opened as `routine`: the four recruitment pitches and a confrontation.
 * These mirror the "recruitment pitch" and "confronting …" beats in
 * Requirement 4.4 — a line that opens a pitch or levels an accusation is a
 * high-stakes moment the moment it is spoken, before the Sim has re-labelled
 * the scene.
 */
const HIGH_STAKES_INTENTS: ReadonlySet<Intent> = new Set<Intent>([
  'pitch-money',
  'pitch-ideology',
  'pitch-coercion',
  'pitch-ego',
  'confront',
]);

/**
 * The inputs the routing decision reads. All optional so the Turn Pipeline can
 * call it with whatever it has: the scene's kind (if a scene is open) and the
 * Intent the `fast` role classified this turn's line into (if classification
 * has run). With neither, the turn is treated as routine and routed to `fast`.
 */
export interface SceneStakesInput {
  /** The kind of scene in progress, as the Sim opened it. */
  readonly sceneKind?: SceneKind;
  /** The Intent the player's line this turn was classified into. */
  readonly intent?: Intent;
}

/**
 * Is this turn high-stakes (Requirement 4.4)? True when the open scene is one
 * of the three high-stakes {@link SCENE_KINDS}, or when this turn's player
 * {@link Intent} is a recruitment pitch or a confrontation. Pure and
 * deterministic.
 *
 * @param input the scene kind and/or classified Intent for the turn.
 * @returns `true` if the turn should be voiced by the `voice` role.
 */
export function isHighStakes(input: SceneStakesInput): boolean {
  if (input.sceneKind !== undefined && HIGH_STAKES_SCENE_KINDS.has(input.sceneKind)) {
    return true;
  }
  if (input.intent !== undefined && HIGH_STAKES_INTENTS.has(input.intent)) {
    return true;
  }
  return false;
}

/**
 * Route a dialogue turn to the Model Role that will voice the NPC reply
 * (Requirement 4.4): `voice` when the turn is {@link isHighStakes | high-stakes},
 * `fast` otherwise. Pure and deterministic — the same inputs always yield the
 * same role — so the Turn Pipeline can pick the role before opening the reply
 * stream and reproduce it on retry or replay.
 *
 * @param input the scene kind and/or classified Intent for the turn.
 * @returns `'voice'` for a high-stakes turn, `'fast'` otherwise.
 */
export function routeTurnRole(input: SceneStakesInput): Extract<Role, 'voice' | 'fast'> {
  return isHighStakes(input) ? 'voice' : 'fast';
}
