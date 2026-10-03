/**
 * The dedicated property-based test for **Property 10 — Descriptor uniqueness**
 * (content-expansion design "Properties"; Requirements 6.4, 6.5).
 *
 * > For any Descriptor Fragment set, city climate, Game Year and seed, all NPC
 * > descriptors in the generated world are distinct, and each uses only
 * > fragments eligible for the NPC's gender, the city's climate and the Game
 * > Year.
 *
 * **Validates: Requirements 6.4, 6.5**
 *
 * The sibling unit suite (`descriptors.spec.ts`) pins `describeNpc`'s individual
 * behaviours against a fixed pool. This file states Property 10 as the design
 * does — over a *whole generated world* — against randomly generated Descriptor
 * Fragment sets, climates, Game Years, world sizes and seeds. It composes the
 * two filters the way the generator (task 3.8) does:
 *
 * - the **Year Range** filter is applied upstream by the setting step's
 *   `yearFilter`, so the test prunes the fragment set by Effective Year Range
 *   (own `years` ∩ the era window) before handing it to `describeNpc`, exactly
 *   as the generator does;
 * - `describeNpc` applies the **gender** and **climate** filters itself.
 *
 * A world is described by drawing NPCs on one shared stream with one growing
 * `used` set (the Principal/Background wiring both do this), so the test covers
 * the uniqueness guarantee end to end: the redraw and appended-`feature`
 * fallback must keep every descriptor distinct.
 *
 * The fast-check shape (a seeded generator, a bounded `numRuns`) mirrors the
 * engine's other `*.property.spec.ts` files.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { DescriptorFragment } from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import { describeNpc, type DescriptorGender } from './descriptors.js';

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

/** The climate Tags a city may carry (one per world). */
const CLIMATES = ['climate:cold', 'climate:temperate', 'climate:warm'] as const;

/** The slots a fragment may fill, matching `DESCRIPTOR_SLOTS`. */
const SLOTS = [
  'build',
  'age',
  'clothing',
  'headwear',
  'feature',
  'carried',
] as const;

/** The era Period Window the setting step bounds Descriptor Fragments by. */
const ERA_WINDOW = { from: 1945, to: 1965 } as const;

/**
 * The Effective Year Range test the generator's `yearFilter` applies to
 * Descriptor Fragments: a fragment with no `years` is always in period;
 * otherwise the Game Year must fall inside its own range *and* the era window.
 * This mirrors `setting.ts`'s `yearInEffectiveRange(year, frag.years, [era])`.
 */
function inPeriod(frag: DescriptorFragment, year: number): boolean {
  if (year < ERA_WINDOW.from || year > ERA_WINDOW.to) {
    return false;
  }
  if (frag.years === undefined) {
    return true;
  }
  return year >= frag.years.from && year <= frag.years.to;
}

/** Whether a fragment's gender filter admits the NPC's gender. */
function genderOk(frag: DescriptorFragment, gender: DescriptorGender): boolean {
  return frag.gender === undefined || frag.gender === gender;
}

/** Whether a fragment's climate filter admits the city's climate Tag. */
function climateOk(frag: DescriptorFragment, climate: string): boolean {
  return (
    frag.climate === undefined ||
    frag.climate.length === 0 ||
    frag.climate.includes(climate)
  );
}

/**
 * The texts of the fragments the subject is *not* eligible for, given the pool,
 * the NPC's gender, the city's climate and the Game Year. A descriptor must
 * contain none of these — it is the direct negative test for Req 6.4. Texts are
 * authored distinct per slot/filter in the generator below, so a substring
 * check is sound.
 */
function ineligibleTexts(
  pool: DescriptorFragment[],
  gender: DescriptorGender,
  climate: string,
  year: number,
): string[] {
  return pool
    .filter(
      (f) =>
        !(inPeriod(f, year) && genderOk(f, gender) && climateOk(f, climate)),
    )
    .map((f) => f.text);
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/**
 * A Descriptor Fragment set rich enough that the base combination space plus the
 * appended `feature` fragments comfortably distinguishes a world the size the
 * generator draws (the shipped quantity target is ≥150 fragments across slots).
 * Every fragment's `text` is unique and encodes its own filters, so the
 * eligibility assertion can test it by substring. A spread of unfiltered,
 * gender-, climate- and year-filtered fragments exercises every branch of the
 * filter.
 */
function fragmentSet(): fc.Arbitrary<DescriptorFragment[]> {
  return fc
    .record({
      // Several unfiltered fragments per slot so a filtered-out subject still
      // has a non-empty pool and the base space stays large.
      base: fc.integer({ min: 4, max: 7 }),
      // A handful of filtered fragments to make the eligibility test bite.
      femOnly: fc.integer({ min: 1, max: 3 }),
      mascOnly: fc.integer({ min: 1, max: 3 }),
      coldOnly: fc.integer({ min: 1, max: 3 }),
      warmOnly: fc.integer({ min: 1, max: 3 }),
      // Fragments ranged to the early or late half of the era window.
      earlyOnly: fc.integer({ min: 1, max: 3 }),
      lateOnly: fc.integer({ min: 1, max: 3 }),
      extraFeatures: fc.integer({ min: 6, max: 12 }),
    })
    .map((n) => {
      const frags: DescriptorFragment[] = [];
      const add = (f: DescriptorFragment): void => {
        frags.push(f);
      };

      for (const slot of SLOTS) {
        for (let i = 0; i < n.base; i += 1) {
          add({ id: `${slot}-base-${i}`, slot, text: `${slot}_base_${i}` });
        }
      }
      // Gendered fragments live in a slot that always contributes (`build`), so
      // every NPC draws from the gender-filtered pool.
      for (let i = 0; i < n.femOnly; i += 1) {
        add({ id: `build-fem-${i}`, slot: 'build', text: `fem_only_${i}`, gender: 'f' });
      }
      for (let i = 0; i < n.mascOnly; i += 1) {
        add({ id: `build-masc-${i}`, slot: 'build', text: `masc_only_${i}`, gender: 'm' });
      }
      // Climate-filtered fragments in the `headwear` slot (fur hat vs straw).
      for (let i = 0; i < n.coldOnly; i += 1) {
        add({
          id: `headwear-cold-${i}`,
          slot: 'headwear',
          text: `cold_only_${i}`,
          climate: ['climate:cold'],
        });
      }
      for (let i = 0; i < n.warmOnly; i += 1) {
        add({
          id: `headwear-warm-${i}`,
          slot: 'headwear',
          text: `warm_only_${i}`,
          climate: ['climate:warm'],
        });
      }
      // Year-ranged fragments in the `clothing` slot (period dress).
      for (let i = 0; i < n.earlyOnly; i += 1) {
        add({
          id: `clothing-early-${i}`,
          slot: 'clothing',
          text: `early_only_${i}`,
          years: { from: 1945, to: 1952 },
        });
      }
      for (let i = 0; i < n.lateOnly; i += 1) {
        add({
          id: `clothing-late-${i}`,
          slot: 'clothing',
          text: `late_only_${i}`,
          years: { from: 1958, to: 1965 },
        });
      }
      // Extra features so the appended-feature fallback has room to break
      // collisions in the uniqueness guarantee.
      for (let i = 0; i < n.extraFeatures; i += 1) {
        add({ id: `feature-extra-${i}`, slot: 'feature', text: `feature_extra_${i}` });
      }
      return frags;
    });
}

// ---------------------------------------------------------------------------
// Property 10 — descriptor uniqueness
// ---------------------------------------------------------------------------

describe('Property 10: Descriptor uniqueness (Req 6.4, 6.5)', () => {
  it('describes a whole world with distinct, in-period, gender- and climate-eligible descriptors', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fragmentSet(),
        fc.integer({ min: 1, max: 40 }),
        fc.constantFrom(...CLIMATES),
        fc.integer({ min: ERA_WINDOW.from, max: ERA_WINDOW.to }),
        (seed, allFrags, count, climate, year) => {
          // The year filter is applied upstream by the setting step, exactly as
          // the generator does before calling `describeNpc`.
          const pool = allFrags.filter((f) => inPeriod(f, year));

          // Describe a whole world: one shared stream, one growing `used` set,
          // gender drawn per NPC (as the Principal/Background wiring does).
          const describeWorld = (): { gender: DescriptorGender; text: string }[] => {
            const rng = createPrng(seed);
            const used = new Set<string>();
            const out: { gender: DescriptorGender; text: string }[] = [];
            for (let i = 0; i < count; i += 1) {
              const gender: DescriptorGender = rng.bool() ? 'f' : 'm';
              const text = describeNpc(pool, gender, climate, used, rng);
              out.push({ gender, text });
              used.add(text);
            }
            return out;
          };

          const world = describeWorld();
          const texts = world.map((w) => w.text);

          // (1) Every descriptor in the world is distinct (Req 6.5). The pool is
          // large enough (base space × appended features) that the fallback can
          // always distinguish up to 40 NPCs.
          expect(new Set(texts).size).toBe(texts.length);

          // (2) Each descriptor uses only fragments eligible for the NPC's
          // gender, the city's climate and the Game Year (Req 6.4). No text of
          // an ineligible fragment appears in the descriptor.
          for (const { gender, text } of world) {
            for (const bad of ineligibleTexts(allFrags, gender, climate, year)) {
              expect(text).not.toContain(bad);
            }
            // The descriptor is non-empty: an unfiltered base pool always
            // contributes at least a build and an age fragment.
            expect(text.length).toBeGreaterThan(0);
          }

          // Determinism: the same Fragment set, climate, year and seed describe
          // the identical world (Property 14 / Req 6.4–6.5 are stable).
          expect(describeWorld()).toEqual(world);
        },
      ),
      { numRuns: 100 },
    );
  });
});
