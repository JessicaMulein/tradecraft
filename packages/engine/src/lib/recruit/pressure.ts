/**
 * The cover-state pressure primitive (design, "Recruitment and Relationships":
 * `pressureCheck`; design, Req 6.3, 6.4).
 *
 * `pressureCheck` is the pure, deterministic coin the **confront** action draws
 * when the player presses an NPC with a Case File Claim that contradicts the
 * NPC's Cover Story or Told List (Req 6.4). It resolves how far the NPC's cover
 * degrades under that pressure along the fixed ladder
 *
 *     intact → strained → cracking → blown
 *
 * ({@link COVER_STATES}, owned by `./asset.ts`). A successful check advances the
 * cover one or more rungs; a failed check leaves it where it was. Crossing into
 * `cracking` (or beyond) is the state change Req 6.4 names — the point at which
 * the NPC's Agenda shifts (partial admission, bargaining or flight), which
 * {@link agendaShiftFor} classifies from the move.
 *
 * ## The probability (design: a deterministic pressure check)
 *
 * The design fixes the signature `pressureCheck(npc, rel, evidence, rng)` and
 * draws **one** coin against the runtime PRNG; it names no scenario weights (so,
 * unlike `resolvePitch`/`firstContact`, the balance lives in self-contained
 * constants here, the way `pitch.ts` owns its suspicion constants). The success
 * probability is the logistic
 *
 *     σ( k·evidenceWeight + t·trust − r·resilience − w·wariness )
 *
 * where
 *
 * - `evidenceWeight` grades how much contradicting evidence the player brought —
 *   it climbs with the Claim count and saturates (one solid Claim already
 *   presses; a stack presses harder but with diminishing returns), see
 *   {@link evidenceWeight};
 * - `trust` is the player↔NPC rapport off the {@link Relationship}: an NPC who
 *   trusts the player is likelier to let the mask slip under pressure (confess
 *   to a confidant) than a wary stranger;
 * - `resilience` is the NPC's composure under interrogation, read from the
 *   hidden `tradecraft`/`securityConsciousness` ground truth (a disciplined
 *   agent holds their cover) — the design's `persona.resilience` analogue;
 * - `wariness` is the view-adjacent guardedness the Cold Approach also reads.
 *
 * The reveal is `rng.next() < p`, drawn **once**, as the single randomness in
 * the function: the same NPC, Relationship, evidence and PRNG state therefore
 * always yield the same next {@link CoverState} (design, Property 11 — pressure
 * determinism; task 18.4 tests it). With *no* contradicting evidence the check
 * cannot succeed (`evidenceWeight = 0` is not enough on its own to move a
 * composed agent, and an empty confront is rejected upstream), so cover never
 * degrades for free.
 *
 * ## How far the cover moves
 *
 * A success advances the cover by **one** rung normally, or by **two** when the
 * draw clears the probability by a wide margin ({@link PRESSURE_HARD_MARGIN} of
 * the success band) *and* the evidence is strong ({@link STRONG_EVIDENCE_CLAIMS}
 * or more Claims) — a decisive confrontation can crack a strained cover straight
 * to blown. The advance is clamped at `blown` (the bottom rung). A failure
 * returns the current state unchanged.
 *
 * This module is a dependency-light **leaf** beside `pitch.ts`/`asset.ts`: it
 * imports only the NPC shape, the core Truth brand (to read the hidden composure
 * ground truth), the {@link CoverState} vocabulary from `./asset.ts`, the
 * {@link Relationship} shape and the PRNG — never the Action Resolver — so it
 * forms no import cycle. Reading a `Truth`-branded field here is deliberate, as
 * in `pitch.ts`: `pressureCheck` is a Sim operation that decides an outcome from
 * ground truth; only its result (the next `CoverState`) crosses toward the
 * Player View, as a cover-state Fact Line the confront resolver renders.
 */

import { revealTruth, type Proposition } from '../model/core.js';
import type { Npc } from '../city/npc.js';
import type { Prng } from '../prng/prng.js';
import { sigmoid } from './first-contact.js';
import { COVER_STATES, type CoverState, type Relationship } from './asset.js';

// ---------------------------------------------------------------------------
// σ coefficients (self-contained; the design names no scenario weights)
// ---------------------------------------------------------------------------

/** How strongly the contradicting-evidence weight presses the cover. */
export const PRESSURE_EVIDENCE_COEFF = 2.5;

/** How much the player↔NPC trust eases the cover (a confidant confesses). */
export const PRESSURE_TRUST_COEFF = 1.0;

/** How strongly the NPC's composure (resilience) resists the pressure. */
export const PRESSURE_RESILIENCE_COEFF = 2.0;

/** How strongly the NPC's wariness resists the pressure. */
export const PRESSURE_WARINESS_COEFF = 1.0;

/**
 * The σ bias, subtracted from the logit so that a *single* middling Claim
 * against a composed, wary NPC does not crack them by default — pressure has to
 * be earned with evidence, rapport, or a shaken opponent.
 */
export const PRESSURE_BIAS = 1.0;

// ---------------------------------------------------------------------------
// Evidence weighting
// ---------------------------------------------------------------------------

/**
 * The saturation constant for {@link evidenceWeight}: with this many Claims the
 * evidence weight reaches half its ceiling. Keeps a single solid Claim
 * meaningful while letting a stack press harder with diminishing returns.
 */
export const EVIDENCE_HALF_SATURATION = 1;

/** The Claim count at or above which the evidence counts as *strong*. */
export const STRONG_EVIDENCE_CLAIMS = 2;

/**
 * Grade the contradicting evidence the player brought into a `[0, 1)` weight.
 * `0` for no Claims; otherwise `n / (n + EVIDENCE_HALF_SATURATION)`, so one Claim
 * already carries real weight and each further Claim adds less (a saturating
 * curve). Pure in the Claim *count* — the confront caller has already decided
 * these Claims contradict the NPC's cover (Req 6.4), so the weight grades
 * quantity, not re-litigates relevance.
 */
export function evidenceWeight(claimCount: number): number {
  if (claimCount <= 0) {
    return 0;
  }
  return claimCount / (claimCount + EVIDENCE_HALF_SATURATION);
}

/**
 * The NPC's composure under interrogation (the design's `persona.resilience`
 * analogue), in `[0, 1]`. The persona carries no `resilience`, so it is read
 * from the hidden ground-truth discipline fields — `tradecraft` and
 * `securityConsciousness`, averaged — a trained, security-conscious agent holds
 * their cover under pressure. Branded reads are deliberate (see the module
 * docblock): the result only ever surfaces as the next cover state.
 */
export function npcResilience(npc: Npc): number {
  const tradecraft = clamp01(revealTruth(npc.tradecraft));
  const security = clamp01(revealTruth(npc.securityConsciousness));
  return (tradecraft + security) / 2;
}

// ---------------------------------------------------------------------------
// The pressure σ probability (drawless)
// ---------------------------------------------------------------------------

/**
 * The pressure-check success probability (drawless, so a quote or a test can
 * read it without committing the coin). The logistic
 * `σ(k·evidenceWeight + t·trust − r·resilience − w·wariness − bias)` on the
 * self-contained {@link PRESSURE_EVIDENCE_COEFF}/… coefficients. Rises with
 * contradicting evidence and rapport, falls with the NPC's composure and
 * wariness, as the design's balance intends.
 */
export function pressureProbability(
  npc: Npc,
  rel: Relationship,
  claimCount: number,
): number {
  const x =
    PRESSURE_EVIDENCE_COEFF * evidenceWeight(claimCount) +
    PRESSURE_TRUST_COEFF * rel.trust -
    PRESSURE_RESILIENCE_COEFF * npcResilience(npc) -
    PRESSURE_WARINESS_COEFF * npc.wariness -
    PRESSURE_BIAS;
  return sigmoid(x);
}

// ---------------------------------------------------------------------------
// Cover-state ladder helpers
// ---------------------------------------------------------------------------

/** The margin above the success probability a draw must clear for a *hard* hit. */
export const PRESSURE_HARD_MARGIN = 0.5;

/** The index of a cover state on the `intact → … → blown` ladder. */
export function coverIndex(state: CoverState): number {
  return COVER_STATES.indexOf(state);
}

/** The cover state `steps` rungs more degraded than `from`, clamped at `blown`. */
export function advanceCover(from: CoverState, steps: number): CoverState {
  const next = Math.min(COVER_STATES.length - 1, coverIndex(from) + Math.max(0, steps));
  return COVER_STATES[next];
}

// ---------------------------------------------------------------------------
// pressureCheck
// ---------------------------------------------------------------------------

/**
 * The pure cover-state pressure coin (design: `pressureCheck(npc, rel, evidence,
 * rng): CoverState`; Req 6.3, 6.4). Returns the NPC's next {@link CoverState}
 * after the player confronts them with `evidence` — the contradicting Case File
 * Claims, reduced here to their {@link Proposition}s (the engine-side form of
 * the design's `Claim`, since `Claim` is a Player-View type a leaf cannot read).
 *
 * It computes the σ success probability ({@link pressureProbability}) and draws
 * it against the passed {@link Prng} **once**. On success the cover degrades one
 * rung along `intact → strained → cracking → blown`, or two rungs on a *hard*
 * hit (the draw cleared the probability by {@link PRESSURE_HARD_MARGIN} of the
 * success band and the evidence is {@link STRONG_EVIDENCE_CLAIMS} Claims or
 * more). On failure the cover is unchanged. A cover already `blown` cannot
 * degrade further.
 *
 * Deterministic: the single `rng.next()` draw is the only randomness, in a fixed
 * order, so the same NPC, Relationship, evidence and PRNG state always return an
 * identical next cover state (Property 11; task 18.4).
 */
export function pressureCheck(
  npc: Npc,
  rel: Relationship,
  evidence: readonly Proposition[],
  rng: Prng,
): CoverState {
  const claimCount = evidence.length;
  const probability = pressureProbability(npc, rel, claimCount);
  const draw = rng.next();
  if (draw >= probability) {
    return rel.coverState; // the check failed; cover holds
  }
  // A hard hit: the draw landed well under the probability (cleared the success
  // band by the hard margin) and the evidence is strong — advance two rungs.
  const hardCutoff = probability * (1 - PRESSURE_HARD_MARGIN);
  const hard = draw < hardCutoff && claimCount >= STRONG_EVIDENCE_CLAIMS;
  return advanceCover(rel.coverState, hard ? 2 : 1);
}

// ---------------------------------------------------------------------------
// Agenda shift (Req 6.4)
// ---------------------------------------------------------------------------

/**
 * The Agenda shift a cover-state move produces (Req 6.4 — a successful check
 * "move[s] the NPC into a cracking state that changes its Agenda (partial
 * admission, bargaining or flight)"):
 *
 * - `none` — the cover did not cross into `cracking`/`blown` (an unchanged cover,
 *   or a move still within `intact`/`strained`), so the Agenda is untouched;
 * - `partial-admission` — the cover first reached `cracking`: the NPC drops part
 *   of the pretence;
 * - `bargaining` — the cover deepened from `cracking` to `blown`: the NPC tries
 *   to deal before bolting;
 * - `flight` — the cover jumped straight into `blown` (a hard two-rung hit that
 *   skipped `cracking`): the NPC breaks and bolts.
 *
 * The mapping is purely by the before/after rungs, so it is deterministic from
 * the pair:
 *
 * - into `cracking` → `partial-admission`;
 * - into `blown` from `cracking` → `bargaining` (one more rung — they try to
 *   deal before bolting);
 * - into `blown` skipping `cracking` (a hard two-rung hit) → `flight`;
 * - otherwise → `none`.
 */
export type AgendaShift = 'none' | 'partial-admission' | 'bargaining' | 'flight';

/**
 * Classify the {@link AgendaShift} a cover move produced (Req 6.4). Pure in the
 * before/after cover states: a move that first breaks the cover into `cracking`
 * is a partial admission; a `cracking → blown` deepening is bargaining; a hard
 * jump straight into `blown` (skipping `cracking`) is flight; any move that does
 * not break the cover leaves the Agenda alone (`none`).
 */
export function agendaShiftFor(before: CoverState, after: CoverState): AgendaShift {
  const from = coverIndex(before);
  const to = coverIndex(after);
  if (to <= from) {
    return 'none'; // no degradation, no Agenda change
  }
  const crackingAt = coverIndex('cracking');
  const blownAt = coverIndex('blown');
  if (to === crackingAt) {
    return 'partial-admission';
  }
  if (to === blownAt) {
    // Reached blown: bargaining when it stepped through cracking, flight on a
    // hard jump that skipped it.
    return from >= crackingAt ? 'bargaining' : 'flight';
  }
  // A move that stayed within intact/strained does not break the cover.
  return 'none';
}

/** Whether a cover move broke the NPC's cover (crossed into cracking or blown). */
export function coverBroke(before: CoverState, after: CoverState): boolean {
  return agendaShiftFor(before, after) !== 'none';
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

/** Clamp a value into `[0, 1]`. */
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
