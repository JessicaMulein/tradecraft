/**
 * NPC naming (content-expansion task 3.4): {@link nameNpc}, the pure function
 * the setting step calls to draw one NPC's culturally consistent, fictional
 * full name (content-expansion Req 3.3, 3.7, 7.1–7.4; design, "Naming and
 * descriptors").
 *
 * The slice names NPCs from a persona library's culture pools; this spec draws
 * from the richer authored {@link CultureGroup}s weighted by the city's Culture
 * Weights, and renders through the group's {@link NamingRule}. The design fixes
 * the order and the rejection rule:
 *
 * - **Order.** Draw the gender uniformly, then the Culture Group from the
 *   (year-filtered) `cultureWeights` — using the *same* weights for every NPC
 *   role, so the role is not an argument (Req 3.7). Then draw the given name
 *   from the group's gendered given pool, the family name (its gendered form
 *   when the language inflects the surname), and any `parts` the Naming Rule
 *   turns on — a Russian-style patronymic (gendered ending) and an Iberian
 *   second surname. Render the everyday `display` form and the `formal` form
 *   from the Naming Rule's patterns (Req 7.1).
 * - **Rejection.** A drawn name is redrawn when its normalised full name is
 *   already used in the world or matches the Real-Person Blocklist (Req 7.3,
 *   7.2 — distinct full names). Normalisation is case-folding, diacritic folding
 *   and whitespace collapse; a `familyOnly` blocklist entry also rejects the
 *   family name alone. After {@link MAX_NAME_REJECTIONS} rejections the
 *   generator falls back to walking the pool combinations in a fixed order from
 *   a drawn offset, which always terminates because the combination space is far
 *   larger than any world's NPC count — so naming is total and deterministic
 *   (Req 7.4).
 *
 * Every random choice is drawn from the passed {@link Prng} (the core stream for
 * Principals, the noise stream for Background NPCs) in a fixed order, so the
 * result is a pure function of the groups, weights, gender, the used-name set,
 * the blocklist and the PRNG state (Req 7.4, underpinning Property 9 — naming
 * soundness, and Property 14 — setting determinism). `nameNpc` does not mutate
 * `used`; the caller adds the returned name after accepting it, so the next
 * NPC's draw sees it.
 */

import type { Prng } from '../prng/prng.js';
import type {
  CultureGroup,
  FamilyName,
  NamingRule,
} from '@tradecraft/content';

import type { CultureGroupId } from './content-set-v2.js';

/**
 * The gender an NPC is named for: `'f'` or `'m'`, matching the Culture Group's
 * gendered given pool (`given.f` / `given.m`) and gendered family and patronymic
 * forms (design, `CultureGroup`, `NamingRule`). This is the content spelling,
 * which differs from the slice persona's `'female'`/`'male'`; the generator
 * wiring (task 3.8) maps between the two.
 */
export type NameGender = 'f' | 'm';

/**
 * One Culture Group's weight in the naming draw (the City Definition's
 * `cultureWeights` entry, design `CityDefinition.cultureWeights`): the Culture
 * Group id and a non-negative weight. The Year Range on the authored entry is
 * already applied by `yearFilter` before `nameNpc` runs, so a weight that
 * reaches here is in period; `nameNpc` reads only the id and the weight.
 */
export interface CultureWeight {
  readonly group: CultureGroupId;
  readonly weight: number;
}

/**
 * The city's Culture Weights as `nameNpc` consumes them: the list of
 * {@link CultureWeight} entries over Culture Groups (design, `CultureWeights`).
 */
export type CultureWeights = readonly CultureWeight[];

/**
 * The result of naming one NPC (design, `nameNpc` return): the Culture Group the
 * name was drawn from, the everyday `display` name and the `formal` rendering.
 * The caller writes these onto the NPC's `culture`, display name and
 * `formalName`, adds the normalised full name to the used-name set, and reads
 * the group's `languages` for the NPC's `languages` field (task 3.8).
 */
export interface NamedNpc {
  readonly culture: CultureGroupId;
  readonly name: string;
  readonly formal: string;
}

// ---------------------------------------------------------------------------
// Blocklist normalisation
// ---------------------------------------------------------------------------

/**
 * One Real-Person Blocklist entry as `nameNpc` reads it (the Era Pack's
 * `BlocklistEntry`, design): the real individual's `name` and the `familyOnly`
 * flag that, when set, rejects the family name alone as well as the full name.
 * The engine declares the shape structurally so it carries no value dependency
 * on the content package's blocklist kind.
 */
export interface BlocklistEntryLike {
  readonly name: string;
  readonly familyOnly?: boolean;
}

/**
 * The Real-Person Blocklist pre-normalised for the naming draw (design,
 * `NormalisedBlocklist`). `fullNames` holds every entry's normalised full name;
 * `familyNames` holds the normalised family name of each `familyOnly` entry
 * (the last whitespace-separated token of its name), so a `familyOnly` entry
 * rejects both the full name and the surname alone (design, "Rejection").
 * Normalising once, up front, keeps the per-draw rejection check a pair of set
 * lookups.
 */
export interface NormalisedBlocklist {
  readonly fullNames: ReadonlySet<string>;
  readonly familyNames: ReadonlySet<string>;
}

/**
 * Normalise a name for comparison: Unicode case-folding (lower case),
 * diacritic folding (NFKD decomposition with the combining marks stripped) and
 * whitespace collapse to single spaces, trimmed (design, "Rejection":
 * "case-folding, diacritic folding and whitespace collapse"). So "José María"
 * and "jose  maria" normalise alike, and a blocklisted "Nováková" matches a
 * drawn "Novakova".
 */
export function normaliseName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Build a {@link NormalisedBlocklist} from the Era Pack's blocklist entries.
 * Every entry contributes its normalised full name; a `familyOnly` entry also
 * contributes the normalised last token of its name as a family name. The
 * generator builds this once per game and passes it to every `nameNpc` call.
 */
export function normaliseBlocklist(
  entries: readonly BlocklistEntryLike[],
): NormalisedBlocklist {
  const fullNames = new Set<string>();
  const familyNames = new Set<string>();
  for (const entry of entries) {
    const normal = normaliseName(entry.name);
    if (normal.length > 0) {
      fullNames.add(normal);
    }
    if (entry.familyOnly === true) {
      const tokens = normal.split(' ').filter((t) => t.length > 0);
      if (tokens.length > 0) {
        familyNames.add(tokens[tokens.length - 1]);
      }
    }
  }
  return { fullNames, familyNames };
}

/**
 * The empty blocklist, a convenience for callers (and tests) with no Real-Person
 * Blocklist loaded.
 */
export const EMPTY_BLOCKLIST: NormalisedBlocklist = {
  fullNames: new Set<string>(),
  familyNames: new Set<string>(),
};

// ---------------------------------------------------------------------------
// Culture-group draw
// ---------------------------------------------------------------------------

/** The number of random rejections before the deterministic enumeration fallback. */
export const MAX_NAME_REJECTIONS = 32;

/**
 * Draw one Culture Group id from the Culture Weights, weighted by `weight`, on
 * `rng`. Only weights whose group is present in `groups` and whose weight is
 * positive are considered; the candidates are taken in the weights' given order
 * (the authored city order), and the draw is a single `next()` scaled over the
 * total weight walked across the cumulative weights — matching
 * `instantiate-city`'s weighted draw so the sequence is deterministic for a PRNG
 * state. Returns `undefined` only when no weighted group resolves (a defective
 * set the caller rejects).
 */
function drawCultureGroup(
  weights: CultureWeights,
  byId: ReadonlyMap<CultureGroupId, CultureGroup>,
  rng: Prng,
): CultureGroupId | undefined {
  const candidates = weights.filter(
    (w) => w.weight > 0 && byId.has(w.group),
  );
  if (candidates.length === 0) {
    return undefined;
  }
  const total = candidates.reduce((sum, w) => sum + w.weight, 0);
  let roll = rng.next() * total;
  for (const candidate of candidates) {
    roll -= candidate.weight;
    if (roll < 0) {
      return candidate.group;
    }
  }
  return candidates[candidates.length - 1].group;
}

// ---------------------------------------------------------------------------
// Name rendering
// ---------------------------------------------------------------------------

/**
 * The gendered form of a {@link FamilyName}: a plain string stays as-is; a
 * `{ m, f }` pair picks the form matching the drawn gender (design,
 * `FamilyName`, "gendered forms, e.g. Novák / Nováková").
 */
function familyForm(family: FamilyName, gender: NameGender): string {
  return typeof family === 'string' ? family : family[gender];
}

/**
 * The parts one rendered name is built from: the given name, the (gendered)
 * family name, an optional patronymic (its gendered ending) and an optional
 * Iberian second surname. The Naming Rule's `display` and `formal` patterns
 * reference these by `{given}`, `{family}`, `{patronymic}` and `{family2}`.
 */
interface NameParts {
  readonly given: string;
  readonly family: string;
  readonly patronymic?: string;
  readonly family2?: string;
}

/**
 * Render a Naming Rule pattern against the drawn {@link NameParts}. Each `{slot}`
 * is replaced by its part; an unresolved slot (for example `{honorific}` in a
 * `formal` pattern, which the Locale supplies later, task 3.6) is left in place
 * so the generator wiring can fill it. Collapsed whitespace keeps the output
 * clean when an optional part is absent and a pattern leaves a gap.
 */
function renderPattern(pattern: string, parts: NameParts): string {
  const slots: Record<string, string | undefined> = {
    given: parts.given,
    family: parts.family,
    patronymic: parts.patronymic,
    family2: parts.family2,
  };
  const filled = pattern.replace(/\{(given|family|patronymic|family2)\}/g, (whole, slot: string) => {
    const value = slots[slot];
    return value === undefined ? '' : value;
  });
  return filled.replace(/\s+/g, ' ').trim();
}

/** Draw the name parts for a Culture Group at a gender from `rng`, in a fixed order. */
function drawParts(
  group: CultureGroup,
  gender: NameGender,
  rng: Prng,
): NameParts {
  const given = rng.pick(group.given[gender]);
  const family = familyForm(rng.pick(group.family), gender);
  const naming = group.naming;
  // A patronymic takes a father's given name from the masculine pool plus the
  // gendered ending. The father-name draw is taken whenever the rule defines a
  // patronymic, so the draw order does not shift with the drawn gender.
  const patronymic =
    naming.parts?.patronymic === undefined
      ? undefined
      : patronymicOf(rng.pick(group.given.m), naming, gender);
  // An Iberian second surname is a second draw from the same family pool.
  const family2 =
    naming.parts?.family2 === true
      ? familyForm(rng.pick(group.family), gender)
      : undefined;
  return {
    given,
    family,
    ...(patronymic === undefined ? {} : { patronymic }),
    ...(family2 === undefined ? {} : { family2 }),
  };
}

/**
 * Form a patronymic from a father's given name and the Naming Rule's gendered
 * ending (`-ovich`/`-ovna`), matching the Russian convention (design,
 * `NamingRule.parts.patronymic`). The ending is appended to the father's name;
 * so a father "Ivan" yields "Ivanovich" / "Ivanovna".
 */
function patronymicOf(
  father: string,
  naming: NamingRule,
  gender: NameGender,
): string {
  const forms = naming.parts?.patronymic;
  if (forms === undefined) {
    return father;
  }
  return `${father}${forms[gender]}`;
}

/**
 * Enumerate the `index`-th name parts for a Culture Group at a gender, in a
 * fixed order over the pool combinations (the fallback after
 * {@link MAX_NAME_REJECTIONS} random rejections, design "Rejection"). The index
 * is spread across the given pool, the family pool and (when the rule has one)
 * the second-surname pool by mixed-radix division, so successive indices walk a
 * different combination and the whole combination space is reachable. The space
 * — |given| × |family| × (|family| for family2) — is far larger than any
 * world's NPC count, so a free combination is always found within the span the
 * caller walks.
 */
function enumerateParts(
  group: CultureGroup,
  gender: NameGender,
  index: number,
): NameParts {
  const givens = group.given[gender];
  const families = group.family;
  const fathers = group.given.m;
  const naming = group.naming;
  const hasPatronymic = naming.parts?.patronymic !== undefined;
  const hasFamily2 = naming.parts?.family2 === true;

  // Mixed-radix decode of the index across given, family, (father), (family2).
  const g = index % givens.length;
  let rest = Math.floor(index / givens.length);
  const f = rest % families.length;
  rest = Math.floor(rest / families.length);
  const fatherIndex = hasPatronymic ? rest % fathers.length : 0;
  if (hasPatronymic) {
    rest = Math.floor(rest / fathers.length);
  }
  const f2Index = hasFamily2 ? rest % families.length : 0;

  const given = givens[g];
  const family = familyForm(families[f], gender);
  const patronymic = hasPatronymic
    ? patronymicOf(fathers[fatherIndex], naming, gender)
    : undefined;
  const family2 = hasFamily2 ? familyForm(families[f2Index], gender) : undefined;

  return {
    given,
    family,
    ...(patronymic === undefined ? {} : { patronymic }),
    ...(family2 === undefined ? {} : { family2 }),
  };
}

/**
 * The size of a Culture Group's combination space at a gender: the product of
 * the pool sizes the enumeration fallback walks (given × family, times the
 * father-name pool when a patronymic is rendered and the family pool again when
 * a second surname is rendered). Used to bound the enumeration so it never loops
 * past every combination.
 */
function combinationSpace(group: CultureGroup, gender: NameGender): number {
  const g = group.given[gender].length;
  const f = group.family.length;
  const fathers =
    group.naming.parts?.patronymic !== undefined ? group.given.m.length : 1;
  const f2 = group.naming.parts?.family2 === true ? f : 1;
  return g * f * fathers * f2;
}

/**
 * True when a rendered name is acceptable: its normalised full name is not
 * already used and not on the blocklist, and its family name alone is not a
 * `familyOnly` blocklist match (design, "Rejection").
 */
function isAcceptable(
  rendered: string,
  family: string,
  used: ReadonlySet<string>,
  blocklist: NormalisedBlocklist,
): boolean {
  const normalFull = normaliseName(rendered);
  if (used.has(normalFull) || blocklist.fullNames.has(normalFull)) {
    return false;
  }
  if (blocklist.familyNames.has(normaliseName(family))) {
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// nameNpc
// ---------------------------------------------------------------------------

/**
 * Draw one NPC's fictional full name (design, "Naming"; Req 3.3, 3.7, 7.1–7.4).
 *
 * `groups` are the (year-filtered) Culture Groups, `weights` the city's Culture
 * Weights over them, `gender` the gender already drawn for this NPC by the
 * caller (the caller draws it on the same stream immediately before, keeping the
 * design's "draw the gender, then the Culture Group" order across the two
 * calls — the generator wiring, task 3.8, owns the gender draw so the slice's
 * existing persona-gender draw is not duplicated). `used` is the set of
 * normalised full names already taken in the world (never mutated here);
 * `blocklist` is the pre-normalised Real-Person Blocklist; `rng` is the naming
 * stream.
 *
 * The Culture Group is drawn weighted by `weights`; then up to
 * {@link MAX_NAME_REJECTIONS} random name draws are tried, each redrawn when it
 * is used or blocklisted. If all are rejected, the function walks the group's
 * pool combinations in a fixed order from a drawn offset until it finds a free
 * one, which always succeeds because the combination space exceeds any world's
 * NPC count — so the function is total (Req 7.4).
 *
 * Returns the {@link NamedNpc}: the drawn Culture Group id, the everyday
 * `display` name and the `formal` rendering (with a Locale-supplied
 * `{honorific}` slot left in the formal pattern for task 3.6 to fill).
 */
export function nameNpc(
  groups: readonly CultureGroup[],
  weights: CultureWeights,
  gender: NameGender,
  used: ReadonlySet<string>,
  blocklist: NormalisedBlocklist,
  rng: Prng,
): NamedNpc {
  if (groups.length === 0) {
    throw new RangeError('nameNpc(): no Culture Groups to draw from');
  }
  const byId = new Map<CultureGroupId, CultureGroup>();
  for (const group of groups) {
    byId.set(group.id, group);
  }

  const chosenId = drawCultureGroup(weights, byId, rng);
  // A defective set with no weighted, resolvable group falls back to the
  // lowest-id group so naming stays total; a conforming city always resolves.
  const group =
    chosenId !== undefined
      ? (byId.get(chosenId) as CultureGroup)
      : [...groups].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
  const culture = group.id;

  // Random draws, redrawing on a used or blocklisted name.
  for (let attempt = 0; attempt < MAX_NAME_REJECTIONS; attempt += 1) {
    const parts = drawParts(group, gender, rng);
    const display = renderPattern(group.naming.display, parts);
    if (isAcceptable(display, parts.family, used, blocklist)) {
      return {
        culture,
        name: display,
        formal: renderPattern(group.naming.formal, parts),
      };
    }
  }

  // Deterministic enumeration fallback: walk the combination space from a drawn
  // offset until a free combination is found. The span is the whole space, so
  // the walk is bounded and total.
  const space = combinationSpace(group, gender);
  const offset = rng.int(0, space - 1);
  for (let step = 0; step < space; step += 1) {
    const index = (offset + step) % space;
    const parts = enumerateParts(group, gender, index);
    const display = renderPattern(group.naming.display, parts);
    if (isAcceptable(display, parts.family, used, blocklist)) {
      return {
        culture,
        name: display,
        formal: renderPattern(group.naming.formal, parts),
      };
    }
  }

  // Every combination is used or blocklisted — only reachable when the world
  // has more NPCs of this culture than the pool can name, which the pool-size
  // targets (Req 11) rule out. Return the enumerated name at the drawn offset so
  // the function stays total; a duplicate here is a content-shortfall defect the
  // Pack Linter's quantity rule catches, not a generation crash.
  const parts = enumerateParts(group, gender, offset);
  return {
    culture,
    name: renderPattern(group.naming.display, parts),
    formal: renderPattern(group.naming.formal, parts),
  };
}
