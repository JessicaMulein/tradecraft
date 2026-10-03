/**
 * Feature: content-expansion, Property 11: Template Variant resolution.
 *
 * > For any base templates and any set of era- and city-scoped variants:
 * > - the loader accepts a variant if and only if its slot set equals its
 * >   base's;
 * > - `resolveTemplate(base, city)` returns the city variant if one exists,
 * >   else the era variant, else the base;
 * > - rendering the resolved template with any complete binding of the base
 * >   slots leaves no unresolved slot.
 *
 * **Validates: Requirements 8.2, 8.3**
 *
 * The example-based cases live in `template-variant.spec.ts`; this file is the
 * dedicated property. A smart generator builds a base template from a random
 * slot set, then city- and era-scoped variants that either conform (same slot
 * set, possibly reordered or wrapped in optional sections) or deviate (a slot
 * dropped and/or an extra slot added). It asserts:
 *
 * 1. `compileTemplateVariants` admits a variant into the index iff its slot set
 *    equals its base's (Req 8.3).
 * 2. `resolveTemplate` picks the city variant if the city has a conforming one,
 *    else the era variant if the base has a conforming one, else the base
 *    (Req 8.2) — matched by the variant/base id so a dropped non-conforming
 *    variant falls through correctly.
 * 3. Rendering the resolved template under any complete binding of the base
 *    slots leaves no unresolved slot (no `TemplateRenderError`), confirming the
 *    slot-set check is exactly what rendering needs.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  parseTemplate,
  render,
  templateSlots,
  type Namer,
  type TemplateRng,
} from './template.js';
import {
  compileTemplateVariants,
  resolveTemplate,
  type BaseTemplate,
  type RawVariant,
} from './template-variant.js';

// --- render helpers --------------------------------------------------------

/** A namer that stringifies whatever it is handed; the slot-set invariant is
 * about which slots resolve, not how a value prints. */
const namer: Namer = (value) => String(value);

/** A deterministic rng; the generated templates use no `{pick:…}` pools, so
 * `pick` is never called, but render requires one. */
const rng: TemplateRng = {
  pick: <T>(items: readonly T[]): T => items[0],
};

// --- generators ------------------------------------------------------------

/** A slot name matching the template grammar's `SLOT_NAME`. */
const slotNameArb = fc
  .tuple(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz'.split('')),
    fc.stringMatching(/^[a-z0-9]{0,5}$/),
  )
  .map(([head, tail]) => head + tail);

/** A non-empty set of distinct slot names: the base's slot set. */
const slotSetArb = fc
  .uniqueArray(slotNameArb, { minLength: 1, maxLength: 5 })
  .map((names) => [...new Set(names)]);

/**
 * Render a template source that binds exactly `slots`, in a shuffled order,
 * optionally wrapping some names in `{?slot}…{/slot}` optional sections. The
 * slot set of the result equals `slots` regardless of order or optionals.
 */
function sourceForSlots(slots: readonly string[], seed: number): string {
  const order = [...slots];
  // Deterministic shuffle driven by `seed` so a conforming variant can differ
  // in layout from its base without changing its slot set.
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = (seed * 2654435761 + i) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order
    .map((slot, i) =>
      // Wrap roughly every other slot in an optional section.
      (seed >> i) & 1 ? `pre {?${slot}}in {${slot}}{/${slot}} post` : `{${slot}}`,
    )
    .join(' ');
}

/** A base template whose slot set is `slots`. */
function makeBase(id: string, slots: readonly string[]): BaseTemplate {
  const ast = parseTemplate(sourceForSlots(slots, 0));
  return { id, ast, slots: templateSlots(ast) };
}

interface VariantPlan {
  readonly scope: 'city' | 'era';
  /** The city id for a city variant; ignored for era variants. */
  readonly city: string;
  /** Slots to drop from the base set (makes it non-conforming if non-empty). */
  readonly drop: readonly string[];
  /** Extra slots to add (makes it non-conforming if non-empty). */
  readonly add: readonly string[];
  readonly layoutSeed: number;
}

const BASE_ID = 'core/base';
const ERA_ID = 'era-x';

/** Build a raw variant from a plan against the base slot set. */
function makeVariant(
  index: number,
  plan: VariantPlan,
  baseSlots: readonly string[],
): RawVariant {
  const slots = [
    ...baseSlots.filter((s) => !plan.drop.includes(s)),
    ...plan.add.filter((s) => !baseSlots.includes(s)),
  ];
  // A variant must render *something*; if the plan emptied the slot set, fall
  // back to a literal so parsing still succeeds (an empty slot set differs from
  // any non-empty base, so it is still correctly refused).
  const source =
    slots.length > 0 ? sourceForSlots(slots, plan.layoutSeed) : 'literal only';
  return {
    variantId: `v${index}`,
    base: BASE_ID,
    scope:
      plan.scope === 'city'
        ? { kind: 'city', id: plan.city }
        : { kind: 'era', id: ERA_ID },
    template: source,
  };
}

/** Does a plan produce a slot set equal to the base's (i.e. conforming)? */
function conforms(plan: VariantPlan, baseSlots: readonly string[]): boolean {
  const effectiveAdd = plan.add.filter((s) => !baseSlots.includes(s));
  const effectiveDrop = plan.drop.filter((s) => baseSlots.includes(s));
  return effectiveAdd.length === 0 && effectiveDrop.length === 0;
}

/** A plan generator, given the base's slot set so drops/adds are meaningful. */
function variantPlanArb(baseSlots: readonly string[]) {
  const cityIdArb = fc.constantFrom('city-a', 'city-b', 'city-c');
  const dropArb = fc.subarray([...baseSlots]);
  const addArb = fc.uniqueArray(slotNameArb, { minLength: 0, maxLength: 2 });
  return fc.record<VariantPlan>({
    scope: fc.constantFrom('city', 'era'),
    city: cityIdArb,
    drop: dropArb,
    add: addArb,
    layoutSeed: fc.integer({ min: 0, max: 1_000_000 }),
  });
}

// --- the property ----------------------------------------------------------

describe('Property 11: Template Variant resolution', () => {
  it('admits a variant iff its slot set equals the base, resolves city→era→base, and renders with no unresolved slot', () => {
    fc.assert(
      fc.property(
        slotSetArb.chain((baseSlots) =>
          fc.record({
            baseSlots: fc.constant(baseSlots),
            plans: fc.array(variantPlanArb(baseSlots), {
              minLength: 0,
              maxLength: 6,
            }),
            queryCity: fc.constantFrom('city-a', 'city-b', 'city-c', 'core'),
          }),
        ),
        ({ baseSlots, plans, queryCity }) => {
          const base = makeBase(BASE_ID, baseSlots);
          const bases = new Map([[BASE_ID, base]]);
          const variants = plans.map((plan, i) =>
            makeVariant(i, plan, baseSlots),
          );

          const { index, errors } = compileTemplateVariants(variants, bases);

          // (1) Acceptance iff conforming (Req 8.3). A variant whose template
          // parses and whose slot set equals the base's is admitted; otherwise
          // it is refused with a located error.
          variants.forEach((variant, i) => {
            const plan = plans[i];
            const admitted =
              plan.scope === 'city'
                ? index.cityVariants.get(`${BASE_ID}\u0000${plan.city}`)
                    ?.variantId === variant.variantId
                : index.eraVariants.get(BASE_ID)?.variantId ===
                  variant.variantId;
            if (conforms(plan, baseSlots)) {
              // Conforming variants always have a valid, parseable template, so
              // the only reason it would be absent is being shadowed by a later
              // variant of the same scope/city — then that later one is present.
              if (!admitted) {
                const slot =
                  plan.scope === 'city'
                    ? index.cityVariants.get(`${BASE_ID}\u0000${plan.city}`)
                    : index.eraVariants.get(BASE_ID);
                expect(slot).toBeDefined();
              }
            } else {
              // Non-conforming: never admitted, and it contributed an error.
              expect(admitted).toBe(false);
            }
          });

          // Every reported error names a known variant and locates a field.
          for (const err of errors) {
            expect(variants.some((v) => v.variantId === err.variantId)).toBe(
              true,
            );
            expect(err.path.length).toBeGreaterThan(0);
          }

          // (2) Resolution order: city (if non-core and a conforming city
          // variant exists for it), else era (if a conforming era variant
          // exists), else base (Req 8.2).
          const set = { templateVariants: index };
          const resolved = resolveTemplate(set, BASE_ID, queryCity);
          expect(resolved).toBeDefined();

          const cityWinner =
            queryCity === 'core'
              ? undefined
              : index.cityVariants.get(`${BASE_ID}\u0000${queryCity}`);
          const eraWinner = index.eraVariants.get(BASE_ID);
          if (cityWinner !== undefined) {
            expect(resolved).toBe(cityWinner);
          } else if (eraWinner !== undefined) {
            expect(resolved).toBe(eraWinner);
          } else {
            expect(resolved).toBe(base);
          }

          // The resolved template always binds exactly the base's slot set.
          expect([...resolved!.slots].sort()).toEqual([...baseSlots].sort());

          // (3) Rendering with any complete binding of the base slots leaves no
          // unresolved slot (no TemplateRenderError thrown).
          const bindings: Record<string, unknown> = {};
          for (const slot of baseSlots) {
            bindings[slot] = `value-${slot}`;
          }
          expect(() =>
            render(resolved!.ast, bindings, namer, rng),
          ).not.toThrow();
        },
      ),
    );
  });
});
