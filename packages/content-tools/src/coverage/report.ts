/**
 * The pure coverage-accounting core (content-expansion task 5.11; design,
 * "Coverage Report"; Req 15.1, 15.2, 15.3, 15.5; Property 17).
 *
 * This module turns the raw material the orchestrator ({@link ./coverage})
 * collects — the per-`(city, preset)` usage tallies, the eligible-item sets,
 * the static Required-Query Binder counts and the per-seed Instantiated-City
 * Location sets — into the {@link CoverageReport} the writers render. It makes
 * no draws, reads no filesystem and generates no worlds, so it is a
 * deterministic function of its inputs and the single place Property 17's
 * accounting is checked:
 *
 * - **Counts** (Req 15.1) are the raw `(kind, id) → count` tallies, straight
 *   from the write-only `UsageSink` the generator fed, so each count equals a
 *   naive recount of the sink's `use` events.
 * - **Expected use** (Req 15.3) of an item is `total draws of its kind ÷
 *   eligible items of that kind`, the uniform expectation if every eligible
 *   item were drawn equally often. The eligible set is the content the city and
 *   preset could draw that kind from (year-filtered), so an item outside the
 *   eligible set is not expected and not flagged.
 * - **Flags** (Req 15.3): an item is `unused` iff its count is 0, and
 *   `underused` iff its count is positive and below `underuse × expected`.
 *   Every other item is `ok`.
 * - **Required Query margins** (Req 15.2): the static Binder count and the
 *   margin over `minStatic` for every Required Query in every city.
 * - **Variety Metric** (Req 15.4): the mean Jaccard similarity of the
 *   Instantiated-City Location sets over every seed pair for a city and preset.
 *   The target is ≤ 0.6, reported as `pass`/`fail` but never linted.
 *
 * Rows are produced for every *eligible* item of every recorded kind, not only
 * the drawn ones, so an item that never appears is reported as `unused` rather
 * than silently dropped (Req 15.3: "flag every item never used"). The result is
 * sorted deterministically so the writers' output is byte-stable across runs
 * (Req 15.5).
 */

/** A namespaced content id, like every content id (`<pack>/<id>` or a slice id). */
export type ContentId = string;

/** A `(kind, id) → count` usage event, as the write-only `UsageSink` records it. */
export interface UsageCount {
  readonly kind: string;
  readonly id: ContentId;
  readonly count: number;
}

/**
 * The eligible content a `(city, preset)` can draw from, grouped by kind: the
 * ids of every item of a kind that the year-filtered content set makes
 * drawable. Expected use divides a kind's total draws by the size of this set,
 * and every id in it gets a row (so unused items are reported).
 */
export type EligibleByKind = ReadonlyMap<string, readonly ContentId[]>;

/** The static Binder count and minimum for one Required Query in one city. */
export interface RequiredQueryMargin {
  readonly city: string;
  readonly query: string;
  readonly binders: number;
  readonly min: number;
}

/** One per-`(city, preset)` cell of raw coverage material. */
export interface CoverageCell {
  readonly city: string;
  readonly preset: string;
  /** The usage tallies the generator's sink collected over this cell's seeds. */
  readonly counts: readonly UsageCount[];
  /** The eligible items per kind the city and preset could draw. */
  readonly eligible: EligibleByKind;
  /**
   * The Instantiated-City Location set for each seed, in seed order. The
   * Variety Metric is the mean pairwise Jaccard similarity of these sets.
   */
  readonly locationSets: readonly (readonly ContentId[])[];
}

/** The flag a coverage row carries (design, `CoverageRow.flag`). */
export type CoverageFlag = 'ok' | 'underused' | 'unused';

/** One coverage row (design, `CoverageRow`). */
export interface CoverageRow {
  readonly city: string;
  readonly preset: string;
  readonly kind: string;
  readonly id: ContentId;
  readonly count: number;
  readonly expected: number;
  readonly flag: CoverageFlag;
}

/** The Variety Metric for one `(city, preset)` (design, `CoverageReport.variety`). */
export interface VarietyRow {
  readonly city: string;
  readonly preset: string;
  readonly meanJaccard: number;
  readonly pass: boolean;
}

/** The full coverage report (design, `CoverageReport`). */
export interface CoverageReport {
  readonly rows: readonly CoverageRow[];
  readonly requiredQueryMargins: readonly RequiredQueryMargin[];
  readonly variety: readonly VarietyRow[];
}

/** The inputs to {@link buildCoverageReport}. */
export interface CoverageInputs {
  readonly cells: readonly CoverageCell[];
  readonly requiredQueryMargins: readonly RequiredQueryMargin[];
  /** The underuse fraction (default 0.25): below this × expected is `underused`. */
  readonly underuse: number;
  /** The Variety-Metric target (default 0.6): a mean above it fails. */
  readonly varietyTarget: number;
}

/** The default underuse fraction (Req 15.3). */
export const DEFAULT_UNDERUSE = 0.25;
/** The default Variety-Metric target (design: "The target is ≤ 0.6"). */
export const DEFAULT_VARIETY_TARGET = 0.6;

/**
 * Build the {@link CoverageReport} from the collected cells and margins
 * (Property 17). Pure and deterministic: the rows are produced for every
 * eligible item of every recorded kind, flagged by the `unused`/`underused`
 * rules, the margins are passed through id-sorted, and the Variety Metric is
 * the mean pairwise Jaccard over each cell's Location sets.
 */
export function buildCoverageReport(inputs: CoverageInputs): CoverageReport {
  const rows: CoverageRow[] = [];
  const variety: VarietyRow[] = [];

  for (const cell of inputs.cells) {
    rows.push(...cellRows(cell, inputs.underuse));
    variety.push({
      city: cell.city,
      preset: cell.preset,
      meanJaccard: meanPairwiseJaccard(cell.locationSets),
      pass: meanPairwiseJaccard(cell.locationSets) <= inputs.varietyTarget,
    });
  }

  return {
    rows: sortRows(rows),
    requiredQueryMargins: sortMargins(inputs.requiredQueryMargins),
    variety: sortVariety(variety),
  };
}

/**
 * The rows for one `(city, preset)` cell. For every recorded kind, every
 * eligible item of that kind gets a row: its count (0 when never drawn), the
 * kind's uniform expected use and its flag. A count recorded for an id that is
 * not in the eligible set still gets a row (so a draw is never hidden), with
 * expected use computed from the kind's eligible-set size.
 */
function cellRows(cell: CoverageCell, underuse: number): CoverageRow[] {
  // Tally the counts by kind, and the per-kind total draws.
  const countOf = new Map<string, number>();
  const totalByKind = new Map<string, number>();
  for (const c of cell.counts) {
    countOf.set(key(c.kind, c.id), (countOf.get(key(c.kind, c.id)) ?? 0) + c.count);
    totalByKind.set(c.kind, (totalByKind.get(c.kind) ?? 0) + c.count);
  }

  // Every kind that has an eligible set or any recorded draw contributes rows.
  const kinds = new Set<string>([...cell.eligible.keys(), ...totalByKind.keys()]);

  const rows: CoverageRow[] = [];
  for (const kind of kinds) {
    const eligibleIds = cell.eligible.get(kind) ?? [];
    // The id set a row is produced for: the eligible items, plus any id drawn
    // but somehow not eligible (defensive — a draw is always reported).
    const ids = new Set<ContentId>(eligibleIds);
    for (const c of cell.counts) {
      if (c.kind === kind) {
        ids.add(c.id);
      }
    }
    const eligibleCount = eligibleIds.length;
    const totalDraws = totalByKind.get(kind) ?? 0;
    const expected = eligibleCount > 0 ? totalDraws / eligibleCount : 0;

    for (const id of ids) {
      const count = countOf.get(key(kind, id)) ?? 0;
      rows.push({
        city: cell.city,
        preset: cell.preset,
        kind,
        id,
        count,
        expected,
        flag: flagFor(count, expected, underuse),
      });
    }
  }
  return rows;
}

/**
 * The flag for a count against its expected use (Req 15.3): `unused` iff the
 * count is 0, `underused` iff positive and below `underuse × expected`,
 * `ok` otherwise. A zero expected use (an empty eligible set) only ever yields
 * `unused`/`ok`, never `underused`, since nothing is below zero.
 */
export function flagFor(count: number, expected: number, underuse: number): CoverageFlag {
  if (count === 0) {
    return 'unused';
  }
  return count < underuse * expected ? 'underused' : 'ok';
}

/**
 * The Variety Metric: the mean Jaccard similarity over every unordered pair of
 * the given Location sets (design: "the mean Jaccard similarity of Instantiated
 * City Location sets over all seed pairs"). With fewer than two sets there are
 * no pairs, so the metric is 0 (maximally varied — the pass case).
 */
export function meanPairwiseJaccard(sets: readonly (readonly ContentId[])[]): number {
  if (sets.length < 2) {
    return 0;
  }
  const asSets = sets.map((s) => new Set(s));
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < asSets.length; i += 1) {
    for (let j = i + 1; j < asSets.length; j += 1) {
      sum += jaccard(asSets[i], asSets[j]);
      pairs += 1;
    }
  }
  return pairs === 0 ? 0 : sum / pairs;
}

/**
 * The Jaccard similarity of two sets: `|A ∩ B| ÷ |A ∪ B|`. Two empty sets are
 * identical, so their similarity is 1 (the degenerate maximum).
 */
export function jaccard(a: ReadonlySet<ContentId>, b: ReadonlySet<ContentId>): number {
  if (a.size === 0 && b.size === 0) {
    return 1;
  }
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) {
      inter += 1;
    }
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** The `(kind, id)` map key, NUL-separated so neither field's content collides. */
function key(kind: string, id: ContentId): string {
  return `${kind}\u0000${id}`;
}

/** A deterministic string compare (ASCII/UTF-16 code-unit order). */
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Sort the rows worst-offender first (design: "worst offenders first"), then
 * deterministically: `unused` before `underused` before `ok`, then by
 * `(city, preset, kind, id)`. The flag order puts the items that need an
 * author's attention at the top of the Markdown tables.
 */
export function sortRows(rows: readonly CoverageRow[]): CoverageRow[] {
  const flagRank: Record<CoverageFlag, number> = { unused: 0, underused: 1, ok: 2 };
  return [...rows].sort(
    (a, b) =>
      flagRank[a.flag] - flagRank[b.flag] ||
      cmp(a.city, b.city) ||
      cmp(a.preset, b.preset) ||
      cmp(a.kind, b.kind) ||
      cmp(a.id, b.id),
  );
}

/** Sort the Required-Query margins by `(city, query)`, worst margin first. */
export function sortMargins(margins: readonly RequiredQueryMargin[]): RequiredQueryMargin[] {
  return [...margins].sort(
    (a, b) =>
      a.binders - a.min - (b.binders - b.min) ||
      cmp(a.city, b.city) ||
      cmp(a.query, b.query),
  );
}

/** Sort the Variety rows failures-first, then by `(city, preset)`. */
export function sortVariety(variety: readonly VarietyRow[]): VarietyRow[] {
  return [...variety].sort(
    (a, b) =>
      Number(a.pass) - Number(b.pass) ||
      b.meanJaccard - a.meanJaccard ||
      cmp(a.city, b.city) ||
      cmp(a.preset, b.preset),
  );
}
