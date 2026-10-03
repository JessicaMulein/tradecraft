/**
 * Feature: content-expansion, Property 9: Naming soundness (task 3.11).
 *
 * **Validates: Requirements 3.3, 3.7, 7.1, 7.2, 7.3**
 *
 * The design states (content-expansion design, "Property 9: Naming soundness"):
 * for any Culture Groups, Culture Weights, Real-Person Blocklist (including
 * entries salted from pool combinations) and seed, every generated world
 * satisfies the following:
 *
 * - every NPC's full name is distinct after normalisation;
 * - no NPC's name matches a blocklist entry (full name, or family name for
 *   `familyOnly` entries);
 * - each name's parts come from its Culture Group's pools (in the NPC's gendered
 *   form) and render by the group's Naming Rule;
 * - the Culture Weights used for every NPC, whatever its role, equal the
 *   year-filtered city weights.
 *
 * ## How the property observes naming
 *
 * The generator wiring (task 3.8) is what names a whole world: it draws each
 * NPC's gender on the naming stream, then calls {@link nameNpc} with the
 * **year-filtered** Culture Weights — the *same* weights for every NPC
 * regardless of its role (Req 3.7) — accumulating the accepted names into a
 * shared `used` set. This property simulates that loop directly against the
 * pure `nameNpc` so it exercises Property 9 without depending on the (later)
 * generator plumbing: it draws a world's worth of NPCs with *varied roles* on a
 * single seeded stream and checks all four clauses.
 *
 * - **Distinctness and blocklist** (clauses 1 and 2) read off the accumulated
 *   `used` set and the normalised blocklist.
 * - **Pool provenance and rendering** (clause 3) are checked by re-deriving each
 *   name's parts from the drawn Culture Group's gendered pools and the group's
 *   Naming Rule, and confirming the rendered `display`/`formal` strings match a
 *   name the group could produce.
 * - **Role independence of the weights** (clause 4) is checked two ways: a
 *   *role* value is threaded through the draw order and shown never to reach
 *   `nameNpc` (it is not a parameter), and the full named world is reproduced
 *   bit-for-bit when the only thing that changes between runs is the NPCs'
 *   roles — so the role cannot have perturbed which weights were used or which
 *   Culture Group was drawn.
 *
 * The pools are sized so each group's combination space dwarfs the simulated
 * world (≤ 40 NPCs), as the Req 11 quantity targets guarantee for shipped
 * content (≥ 100 given, ≥ 100 family). At that size the design's distinctness
 * claim holds through the random phase without reaching the enumeration
 * fallback's exhaustion edge.
 *
 * The fast-check shape (seeded `fc.record`-style arbitraries, a bounded
 * `numRuns`) mirrors the engine's other `*.property.spec.ts` files; the Culture
 * Group fixtures mirror `names.spec.ts`.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { CultureGroup, NamingRule } from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import {
  nameNpc,
  normaliseBlocklist,
  normaliseName,
  type BlocklistEntryLike,
  type CultureWeights,
  type NameGender,
} from './names.js';

// ---------------------------------------------------------------------------
// Culture Group arbitraries
// ---------------------------------------------------------------------------

/**
 * The four Naming Rule shapes the design supports (plain, gendered family,
 * patronymic, Iberian second surname). Each builds a group with pools large
 * enough that the combination space dwarfs a 40-NPC world, so the random phase
 * never exhausts into the enumeration fallback.
 */
type Shape = 'plain' | 'gendered-family' | 'patronymic' | 'second-surname';

const SHAPES: readonly Shape[] = [
  'plain',
  'gendered-family',
  'patronymic',
  'second-surname',
];

/** A pool of `n` distinct tokens with a per-group prefix, so no two groups collide. */
function pool(prefix: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => `${prefix}${i}`);
}

/** The Naming Rule for a shape. */
function namingFor(shape: Shape): NamingRule {
  switch (shape) {
    case 'plain':
    case 'gendered-family':
      return { display: '{given} {family}', formal: '{honorific} {family}' };
    case 'patronymic':
      return {
        display: '{given} {patronymic} {family}',
        formal: '{given} {patronymic}',
        parts: { patronymic: { m: 'ovich', f: 'ovna' } },
      };
    case 'second-surname':
      return {
        display: '{given} {family} {family2}',
        formal: '{honorific} {family}',
        parts: { family2: true },
      };
  }
}

/** Build a Culture Group of a shape with a unique id/prefix. */
function groupOfShape(shape: Shape, seqId: number): CultureGroup {
  const id = `lib/${shape}-${seqId}`;
  const p = `${shape[0]}${seqId}`;
  const givenF = pool(`${p}Gf`, 30);
  const givenM = pool(`${p}Gm`, 30);
  const familyBare = pool(`${p}Fam`, 30);
  const family =
    shape === 'gendered-family' || shape === 'patronymic'
      ? familyBare.map((s) => ({ m: s, f: `${s}a` }))
      : familyBare;
  return {
    id,
    name: `${shape} ${seqId}`,
    languages: [`l${seqId}`],
    naming: namingFor(shape),
    given: { f: givenF, m: givenM },
    family,
    voiceTraits: [],
    mannerisms: [],
    backgrounds: [],
  };
}

/**
 * An arbitrary set of 1–4 Culture Groups, one of each requested shape, each with
 * a distinct id. Picking distinct shapes keeps the set varied (plain, gendered,
 * patronymic, second-surname) while the per-group prefix keeps pools disjoint.
 */
const groupsArb: fc.Arbitrary<CultureGroup[]> = fc
  .uniqueArray(fc.constantFrom(...SHAPES), { minLength: 1, maxLength: 4 })
  .map((shapes) => shapes.map((shape, i) => groupOfShape(shape, i)));

/**
 * Culture Weights over the groups: a non-negative weight per group, with at
 * least one strictly positive so a draw always resolves. Some weights may be
 * zero (an in-period-but-unweighted group must never be drawn).
 */
function weightsArb(groups: readonly CultureGroup[]): fc.Arbitrary<CultureWeights> {
  return fc
    .array(fc.nat({ max: 5 }), {
      minLength: groups.length,
      maxLength: groups.length,
    })
    .map((raw): CultureWeights => {
      const weights: number[] = [...raw];
      // Guarantee at least one positive weight.
      const hasPositive = weights.some((w) => w > 0);
      if (!hasPositive) {
        weights[0] = 1;
      }
      return groups.map((g, i) => ({ group: g.id, weight: weights[i] }));
    });
}

/**
 * A Real-Person Blocklist salted from the groups' pool combinations: a handful
 * of full names a group could produce, plus a few `familyOnly` surnames. These
 * force the rejection path — a drawn name that lands on one must be redrawn.
 */
function blocklistArb(
  groups: readonly CultureGroup[],
): fc.Arbitrary<BlocklistEntryLike[]> {
  const fullNames = groups.flatMap((g) => {
    const given = g.given.m[0];
    const fam = typeof g.family[0] === 'string' ? g.family[0] : g.family[0].m;
    return [`${given} ${fam}`];
  });
  const surnames = groups.map((g) =>
    typeof g.family[1] === 'string' ? g.family[1] : g.family[1].m,
  );
  return fc.record({
    fulls: fc.subarray(fullNames),
    families: fc.subarray(surnames),
  }).map(({ fulls, families }) => [
    ...fulls.map((name) => ({ name })),
    ...families.map((name) => ({ name: `${name}`, familyOnly: true })),
  ]);
}

// ---------------------------------------------------------------------------
// Pool-provenance checker (clause 3)
// ---------------------------------------------------------------------------

/**
 * Every everyday `display` name a group could produce at a gender, mapped to
 * the **primary** family name (`parts.family`) that rendered it. Building the
 * full combination map (not just the set of displays) lets clause 2 check the
 * blocklist against the component the design's `familyOnly` rule actually
 * governs — the primary family — rather than a positional token.
 *
 * The design's `familyOnly` rejection keys on `blocklist.familyNames.has(
 * normaliseName(parts.family))`; it does *not* consider the Iberian second
 * surname `family2` (which also happens to be the last display token for a
 * `{given} {family} {family2}` rule). So the test must recover the drawn
 * primary family to assert the rule, and taking the last whitespace token would
 * instead pick up `family2` and wrongly flag a legitimately-accepted name.
 *
 * The pools are uniquely prefixed per group, so a produced display name maps to
 * exactly one primary family; where two combinations ever collided on a display
 * string the map would simply keep one, but with these fixtures no collision
 * occurs. The combination space is small enough per fixture group
 * (≤ 30 × 30 × 30) that building the map per group per gender is affordable at
 * the test's `numRuns`.
 */
function displayToPrimaryFamily(
  group: CultureGroup,
  gender: NameGender,
): Map<string, string> {
  const naming = group.naming;
  const givens = group.given[gender];
  const familyForm = (fam: CultureGroup['family'][number]): string =>
    typeof fam === 'string' ? fam : fam[gender];
  const render = (parts: {
    given: string;
    family: string;
    patronymic?: string;
    family2?: string;
  }): string =>
    naming.display
      .replace(/\{given\}/g, parts.given)
      .replace(/\{family\}/g, parts.family)
      .replace(/\{patronymic\}/g, parts.patronymic ?? '')
      .replace(/\{family2\}/g, parts.family2 ?? '')
      .replace(/\s+/g, ' ')
      .trim();

  const out = new Map<string, string>();
  const hasPatronymic = naming.parts?.patronymic !== undefined;
  const hasFamily2 = naming.parts?.family2 === true;
  const patronymicEnding = naming.parts?.patronymic?.[gender] ?? '';
  for (const given of givens) {
    for (const famEntry of group.family) {
      const family = familyForm(famEntry);
      if (hasPatronymic) {
        for (const father of group.given.m) {
          out.set(render({ given, family, patronymic: `${father}${patronymicEnding}` }), family);
        }
      } else if (hasFamily2) {
        for (const fam2Entry of group.family) {
          out.set(render({ given, family, family2: familyForm(fam2Entry) }), family);
        }
      } else {
        out.set(render({ given, family }), family);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// World-naming simulation
// ---------------------------------------------------------------------------

/** One simulated NPC-naming request: the gender draw plus an opaque role. */
interface NpcSpec {
  readonly role: string;
  readonly gender: NameGender;
}

/**
 * Name a world's worth of NPCs the way the generator will: draw the gender on
 * the naming stream, then call `nameNpc` with the (role-independent) weights,
 * accumulating accepted names into the shared `used` set. The `role` is carried
 * on each spec but, by design, is **not** passed to `nameNpc` (Req 3.7); it is
 * returned alongside each result so the test can confirm the result is
 * unaffected by it.
 */
function nameWorld(
  groups: readonly CultureGroup[],
  weights: CultureWeights,
  blocklist: readonly BlocklistEntryLike[],
  seed: string,
  specs: readonly NpcSpec[],
): { culture: string; name: string; formal: string; gender: NameGender }[] {
  const normalisedBlocklist = normaliseBlocklist(blocklist);
  const rng = createPrng(seed);
  const used = new Set<string>();
  const out: {
    culture: string;
    name: string;
    formal: string;
    gender: NameGender;
  }[] = [];
  for (const spec of specs) {
    // The caller draws the gender first (design order). The spec carries a
    // pre-drawn gender so a re-run with the same seed draws identically; the
    // role is intentionally not consulted and never reaches `nameNpc`.
    void spec.role;
    const result = nameNpc(groups, weights, spec.gender, used, normalisedBlocklist, rng);
    used.add(normaliseName(result.name));
    out.push({ ...result, gender: spec.gender });
  }
  return out;
}

/** An arbitrary world of 1–40 NPCs: a role label and a gender per NPC. */
const specsArb: fc.Arbitrary<NpcSpec[]> = fc.array(
  fc.record({
    role: fc.constantFrom('principal', 'background', 'cell', 'liaison', 'civilian'),
    gender: fc.constantFrom<NameGender>('f', 'm'),
  }),
  { minLength: 1, maxLength: 40 },
);

// ---------------------------------------------------------------------------
// Property 9
// ---------------------------------------------------------------------------

describe('Property 9: naming soundness', () => {
  it('names every world with distinct, in-pool, non-blocklisted names, independent of role', () => {
    fc.assert(
      fc.property(
        groupsArb.chain((groups) =>
          fc.record({
            groups: fc.constant(groups),
            weights: weightsArb(groups),
            blocklist: blocklistArb(groups),
            seed: fc.string({ minLength: 1, maxLength: 12 }),
            specs: specsArb,
          }),
        ),
        ({ groups, weights, blocklist, seed, specs }) => {
          const normalisedBlocklist = normaliseBlocklist(blocklist);
          const byId = new Map(groups.map((g) => [g.id, g] as const));
          const positive = new Set(
            weights.filter((w) => w.weight > 0).map((w) => w.group),
          );

          const named = nameWorld(groups, weights, blocklist, seed, specs);

          // Clause 1: every full name is distinct after normalisation.
          const normals = named.map((n) => normaliseName(n.name));
          expect(new Set(normals).size).toBe(normals.length);

          for (const npc of named) {
            const normal = normaliseName(npc.name);

            // Clause 4 (part a): the drawn Culture Group has a positive weight —
            // the role never widened the candidate set.
            expect(positive.has(npc.culture)).toBe(true);

            // Clause 3: the rendered display name is one the drawn group could
            // produce from its gendered pools via its Naming Rule. The map keys
            // are the producible displays; the value is the primary family that
            // rendered each, which clause 2 reuses below.
            const group = byId.get(npc.culture);
            expect(group).toBeDefined();
            const producible = displayToPrimaryFamily(group as CultureGroup, npc.gender);
            expect(producible.has(npc.name)).toBe(true);

            // Clause 2: no full name matches a blocklist entry, and the drawn
            // *primary* family name — the component the design's `familyOnly`
            // rule governs — matches no `familyOnly` entry. The primary family
            // is recovered from the Naming Rule (not the last display token,
            // which for a `{given} {family} {family2}` rule is the Iberian
            // second surname `family2`, which the rule does not reject on).
            expect(normalisedBlocklist.fullNames.has(normal)).toBe(false);
            const primaryFamily = producible.get(npc.name) as string;
            expect(normalisedBlocklist.familyNames.has(normaliseName(primaryFamily))).toBe(false);
          }
        },
      ),
      { numRuns: 60 },
    );
  });

  it('uses the same weights for every NPC whatever its role: reshuffling roles leaves the named world unchanged', () => {
    fc.assert(
      fc.property(
        groupsArb.chain((groups) =>
          fc.record({
            groups: fc.constant(groups),
            weights: weightsArb(groups),
            blocklist: blocklistArb(groups),
            seed: fc.string({ minLength: 1, maxLength: 12 }),
            // A world described by only (gender) draws; the role is assigned
            // separately below so two role assignments over the same genders
            // can be compared.
            genders: fc.array(fc.constantFrom<NameGender>('f', 'm'), {
              minLength: 1,
              maxLength: 40,
            }),
            rolesA: fc.array(
              fc.constantFrom('principal', 'background', 'cell', 'liaison'),
              { minLength: 40, maxLength: 40 },
            ),
            rolesB: fc.array(
              fc.constantFrom('principal', 'background', 'cell', 'liaison'),
              { minLength: 40, maxLength: 40 },
            ),
          }),
        ),
        ({ groups, weights, blocklist, seed, genders, rolesA, rolesB }) => {
          // Two worlds that differ only in the NPCs' roles (same genders, same
          // seed, same weights). Clause 4 (Req 3.7): the role is not an input to
          // naming, so the two named worlds must be identical.
          const specsA: NpcSpec[] = genders.map((gender, i) => ({
            role: rolesA[i],
            gender,
          }));
          const specsB: NpcSpec[] = genders.map((gender, i) => ({
            role: rolesB[i],
            gender,
          }));

          const worldA = nameWorld(groups, weights, blocklist, seed, specsA);
          const worldB = nameWorld(groups, weights, blocklist, seed, specsB);

          expect(worldB).toEqual(worldA);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('is deterministic: the same seed names the same world', () => {
    fc.assert(
      fc.property(
        groupsArb.chain((groups) =>
          fc.record({
            groups: fc.constant(groups),
            weights: weightsArb(groups),
            blocklist: blocklistArb(groups),
            seed: fc.string({ minLength: 1, maxLength: 12 }),
            specs: specsArb,
          }),
        ),
        ({ groups, weights, blocklist, seed, specs }) => {
          const first = nameWorld(groups, weights, blocklist, seed, specs);
          const second = nameWorld(groups, weights, blocklist, seed, specs);
          expect(second).toEqual(first);
        },
      ),
      { numRuns: 60 },
    );
  });
});
