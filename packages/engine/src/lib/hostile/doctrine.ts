/**
 * Hostile Service doctrine: the three doctrine dimensions and the pure,
 * deterministic {@link drawDoctrine} that samples them from a Difficulty
 * Preset's ranges (design, "Hostile Service AI": "Doctrine values are drawn
 * from the preset's ranges"; Requirement 12.1).
 *
 * The design sketches the Hostile Service's doctrine as a three-field record:
 *
 * ```ts
 * doctrine: { riskTolerance: number; securityConsciousness: number; deceptionAppetite: number };
 * ```
 *
 * Each dimension lives in `[0, 1]`:
 *
 * - **`riskTolerance`** — how much Abort Pressure and leader suspicion the Cell
 *   endures before pulling the plug (read by the abort maths in
 *   `../clock/plot-abort.ts`, whose {@link import('../clock/plot-abort.js').Doctrine}
 *   is the single-field structural supertype this one satisfies). A higher
 *   value also makes the counter-intelligence response lean toward *keeping*
 *   a detected Asset in play (double / feed) rather than arresting it.
 * - **`securityConsciousness`** — how aggressively the service hunts the
 *   player's network: it scales the daily detection check and raises the bar a
 *   fed Proposition must clear to be adopted
 *   (`0.4 + 0.4 × securityConsciousness`, design).
 * - **`deceptionAppetite`** — the taste for running deception rather than
 *   making arrests: it biases a detection response toward `double`/`feed` and
 *   gates the public arrest article (printed with `1 − deceptionAppetite`,
 *   design, Req 39.4).
 *
 * ## The draw (Requirement 12.1)
 *
 * {@link drawDoctrine} samples one value per dimension from the preset's
 * `doctrine.{risk,security,deception}` `{ min, max }` range. It is pure and
 * deterministic: given the same seed and preset ranges it always returns the
 * same doctrine (Requirement 1.2). The draw order is fixed — risk, then
 * security, then deception — so adding a later draw to the same stream never
 * shifts these three. Each value is a uniform sample in `[min, max]` on the
 * passed {@link Prng}; a degenerate `min === max` range yields exactly that
 * value with no loss of a draw (the stream still advances, so determinism does
 * not depend on whether a range is a point).
 *
 * The result's `riskTolerance` is exactly the field
 * {@link import('../clock/plot-abort.js').Doctrine} needs, so the live doctrine
 * can be passed straight into `abortTolerance` / `leaderAbortThreshold` /
 * `abortCheck` with no conversion — the full doctrine is a structural
 * supertype of the abort module's one-field view.
 */

import type { Prng } from '../prng/prng.js';

/**
 * A `{ min, max }` range as a Difficulty Preset carries it (content
 * `RangeSchema`: `min <= max`, both in `[0, 1]`). Kept structural so this leaf
 * does not import the content package for a type.
 */
export interface DoctrineRange {
  readonly min: number;
  readonly max: number;
}

/**
 * The preset slice {@link drawDoctrine} reads: the three doctrine ranges, as
 * `DifficultyPreset.doctrine` carries them. Structural, so a caller can pass
 * `preset.doctrine` directly.
 */
export interface DoctrineRanges {
  readonly risk: DoctrineRange;
  readonly security: DoctrineRange;
  readonly deception: DoctrineRange;
}

/**
 * The Hostile Service's doctrine (design, "Hostile Service AI"). Three
 * dimensions in `[0, 1]`, each drawn from the preset's range. `riskTolerance`
 * is the field the abort maths' {@link import('../clock/plot-abort.js').Doctrine}
 * reads, so this type is a structural supertype of it.
 */
export interface Doctrine {
  /** Tolerance for Abort Pressure / leader suspicion, in `[0, 1]`. */
  readonly riskTolerance: number;
  /** How hard the service hunts the player's network, in `[0, 1]`. */
  readonly securityConsciousness: number;
  /** Taste for running deception over making arrests, in `[0, 1]`. */
  readonly deceptionAppetite: number;
}

/**
 * Draw a uniform value in `[range.min, range.max]` on `rng`. Always draws
 * exactly one float from the stream (even for a point range), so the draw order
 * is stable regardless of a preset's range widths.
 */
function drawInRange(rng: Prng, range: DoctrineRange): number {
  const t = rng.next(); // one draw, always, so the stream is range-width-independent
  return range.min + t * (range.max - range.min);
}

/**
 * Draw the Hostile Service's doctrine from a preset's ranges (Requirement
 * 12.1). Pure and deterministic: same seed + ranges ⇒ same doctrine. Draw order
 * is fixed (risk, security, deception), one uniform sample per dimension.
 *
 * The result satisfies both this module's three-field {@link Doctrine} and the
 * abort module's one-field `Doctrine`, so it can be threaded into the abort
 * maths and the detection response selection without conversion.
 */
export function drawDoctrine(rng: Prng, ranges: DoctrineRanges): Doctrine {
  const riskTolerance = drawInRange(rng, ranges.risk);
  const securityConsciousness = drawInRange(rng, ranges.security);
  const deceptionAppetite = drawInRange(rng, ranges.deception);
  return { riskTolerance, securityConsciousness, deceptionAppetite };
}
