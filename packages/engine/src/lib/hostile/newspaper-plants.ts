/**
 * The Hostile Service's newspaper plants — the false stories it places in the
 * daily paper to mislead the player (task 19.4; design, "Hostile Service AI"
 * `dailyTick` step 7: "Newspaper plants"; Requirement 30.2).
 *
 * Requirement 30.2 lists, among the sources a daily edition's 3–6 articles are
 * drawn from, "stories planted by the Hostile Service". A **plant** is a false
 * {@link Proposition} the service pays to see printed as a newspaper article: a
 * reader who files the edition seeds that false Claim into the Case File
 * (Req 30.1), exactly as a Rumour article does — the difference is only in who
 * placed it. A plant is therefore produced as a {@link NewspaperItem} the Turn
 * Pipeline folds into the day's {@link NewspaperMaterial} pool, from where the
 * newspaper composer (`../docs/newspaper.ts`) prints it like any other article.
 * This leaf never touches the composer or the pool; it is a content-light pure
 * producer that takes a projection of the day's *candidate* plant Propositions
 * and returns the {@link NewspaperItem}s to print.
 *
 * ## The doctrine gate (deceptionAppetite)
 *
 * A deception-happy service plants more. The doctrine's `deceptionAppetite`
 * drives two things, in a fixed draw order so the stream is stable:
 *
 * 1. **How many** candidates are considered: the service plants up to
 *    `floor(deceptionAppetite × MAX_PLANTS_PER_DAY)` stories a day (a blunt
 *    service, `deceptionAppetite → 0`, plants none; a deception-run service,
 *    `→ 1`, plants up to the cap). The candidates are id-sorted and the cap is
 *    taken as a prefix, so the selection is a pure function of the inputs.
 * 2. **Whether each** survives a per-candidate coin against `deceptionAppetite`
 *    — the same taste that gates the public arrest article's `1 −
 *    deceptionAppetite` (see `./consequences.ts`), here the *opposite* way: a
 *    service that runs deception is the one that bothers to place a plant.
 *
 * The two together mean a `deceptionAppetite = 0` service plants nothing (zero
 * candidates considered, and even if it did, p = 0), and a `deceptionAppetite =
 * 1` service plants every candidate up to the cap (p = 1). This matches the
 * design's "a deception-happy service plants more".
 *
 * ## Purity / determinism
 *
 * {@link planNewspaperPlants} draws exactly one coin per considered candidate on
 * the passed {@link Prng}, in id-sorted order, so the stream is independent of
 * the projection's record order (Requirement 1.2). It makes no other draws; a
 * day with no candidates, or a `deceptionAppetite` that admits none, draws
 * nothing and prints nothing.
 */

import type { GameTime, Proposition } from '../model/core.js';
import type { Prng } from '../prng/prng.js';
import type { Doctrine } from './doctrine.js';
import type { NewspaperItem } from '../docs/newspaper.js';

// ---------------------------------------------------------------------------
// The plant cap
// ---------------------------------------------------------------------------

/**
 * The most plants a service can place in a single day, at `deceptionAppetite =
 * 1`. The per-day count is `floor(deceptionAppetite × MAX_PLANTS_PER_DAY)`, so
 * a service samples a doctrine-sized prefix of the day's candidate pool. Kept
 * small so plants stay a seasoning on the edition, not a flood (the composer
 * still only prints 3–6 total).
 */
export const MAX_PLANTS_PER_DAY = 3;

/**
 * How many candidate plants a service of the given doctrine will *consider* in a
 * day: `floor(deceptionAppetite × MAX_PLANTS_PER_DAY)`, clamped to `[0,
 * MAX_PLANTS_PER_DAY]`. A deception-happy service considers more; a blunt one
 * considers none.
 */
export function plantCount(doctrine: Doctrine): number {
  const raw = Math.floor(doctrine.deceptionAppetite * MAX_PLANTS_PER_DAY);
  return Math.max(0, Math.min(MAX_PLANTS_PER_DAY, raw));
}

/**
 * The probability a considered plant is actually placed, for a service of the
 * given doctrine: `deceptionAppetite`. The opposite sense to the arrest
 * article's `1 − deceptionAppetite` gate — a service that runs deception is the
 * one that bothers to plant. At `deceptionAppetite = 0` no plant is placed; at
 * `1` every considered candidate is.
 */
export function plantProbability(doctrine: Doctrine): number {
  return doctrine.deceptionAppetite;
}

// ---------------------------------------------------------------------------
// Plant candidates
// ---------------------------------------------------------------------------

/**
 * One candidate false story the service could plant, projected in by the Turn
 * Pipeline (this leaf stays content-/world-light). It carries the FALSE
 * {@link Proposition} the article asserts (the misleading Claim the player may
 * seed) and a short, public phrasing for the headline/body the composer renders
 * through its namer.
 */
export interface PlantCandidate {
  /** The false Proposition the planted article asserts (the misleading Claim). */
  readonly proposition: Proposition;
  /** A short, public headline phrase ("Trade delegation arrives"). */
  readonly headline: string;
  /** A one- or two-sentence detail the article body renders from. */
  readonly summary: string;
}

/**
 * The day's candidate plants, keyed by a stable candidate id (used to id-sort
 * the pool so the draw order is deterministic regardless of record order). An
 * empty map means the service has nothing to plant today, so the producer is a
 * no-op.
 */
export type PlantProjection = Readonly<Record<string, PlantCandidate>>;

/**
 * Build the {@link NewspaperItem} for a single plant, independent of the gate.
 * Pure, no draws. The id is scoped to the candidate id and day so it is stable
 * and distinct within an edition. The source is tagged `rumour` — a plant is
 * indistinguishable from an ordinary false Rumour in the printed paper, which
 * is the point: the player cannot tell a planted story from a circulating one,
 * so it reads as just another unverified line (Req 30.2). The asserted
 * Proposition is the candidate's false Claim.
 */
export function buildPlantItem(
  candidateId: string,
  day: number,
  candidate: PlantCandidate,
): NewspaperItem {
  return {
    id: `plant/${candidateId}/${day}`,
    source: 'rumour',
    headline: candidate.headline,
    summary: candidate.summary,
    asserts: [candidate.proposition],
  };
}

// ---------------------------------------------------------------------------
// planNewspaperPlants
// ---------------------------------------------------------------------------

/**
 * Decide the Hostile Service's newspaper plants for the day (design `dailyTick`
 * step 7; Req 30.2). Pure; draws one coin per considered candidate on `rng`.
 *
 * The candidate ids are id-sorted and the first {@link plantCount} of them are
 * considered (a doctrine-sized prefix); for each, one coin is drawn against
 * {@link plantProbability}, and on a hit the plant's {@link NewspaperItem} is
 * emitted. Drawing in id-sorted order keeps the stream independent of the
 * projection's record order; always drawing exactly one coin per considered
 * candidate keeps the stream width independent of how many plants land.
 *
 * The returned items are the material the Turn Pipeline folds into the day's
 * {@link NewspaperMaterial} (as extra `rumour`-source items), where the composer
 * prints them among the day's 3–6 articles. A blunt service (`deceptionAppetite
 * = 0`) considers nothing and returns `[]`; a deception-run service
 * (`= 1`) plants every candidate up to {@link MAX_PLANTS_PER_DAY}.
 *
 * @param at the day the plants are dated (its `day` scopes the item ids).
 */
export function planNewspaperPlants(
  doctrine: Doctrine,
  candidates: PlantProjection,
  at: GameTime,
  rng: Prng,
): NewspaperItem[] {
  const consider = plantCount(doctrine);
  if (consider === 0) {
    return [];
  }

  const ids = Object.keys(candidates).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const prefix = ids.slice(0, consider);
  const probability = plantProbability(doctrine);

  const items: NewspaperItem[] = [];
  for (const id of prefix) {
    const placed = rng.bool(probability);
    if (!placed) {
      continue;
    }
    items.push(buildPlantItem(id, at.day, candidates[id]));
  }
  return items;
}
