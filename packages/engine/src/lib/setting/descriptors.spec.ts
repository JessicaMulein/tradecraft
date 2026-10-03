/**
 * Tests for NPC descriptors (content-expansion task 3.5): `describeNpc`.
 *
 * A unit suite pins the behaviours the design fixes — one fragment per slot in
 * slot order, the gender and climate filter, the optional `carried` slot, the
 * whole-descriptor redraw on a collision and the appended-`feature` fallback
 * (Req 6.4, 6.5). A fast-check property covers descriptor uniqueness and
 * fragment eligibility across many worlds (feeding Property 10): every
 * descriptor in a world is distinct and uses only fragments eligible for the
 * NPC's gender and the city's climate, and the same seed describes the same
 * world.
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { DescriptorFragment } from '@tradecraft/content';

import { createPrng } from '../prng/prng.js';
import {
  MAX_DESCRIPTOR_REJECTIONS,
  describeNpc,
  type DescriptorGender,
} from './descriptors.js';

// --- fixtures --------------------------------------------------------------

const COLD = 'climate:cold';
const WARM = 'climate:warm';

/** A rich, period-plausible pool covering every slot, no filters by default. */
function basePool(): DescriptorFragment[] {
  return [
    { id: 'build-slim', slot: 'build', text: 'slim' },
    { id: 'build-stocky', slot: 'build', text: 'stocky' },
    { id: 'age-young', slot: 'age', text: 'in his twenties' },
    { id: 'age-old', slot: 'age', text: 'greying' },
    { id: 'clothing-coat', slot: 'clothing', text: 'in a worn overcoat' },
    { id: 'clothing-suit', slot: 'clothing', text: 'in a grey suit' },
    { id: 'headwear-hat', slot: 'headwear', text: 'wearing a felt hat' },
    { id: 'headwear-cap', slot: 'headwear', text: 'wearing a flat cap' },
    { id: 'feature-scar', slot: 'feature', text: 'with a scar on one cheek' },
    { id: 'feature-limp', slot: 'feature', text: 'with a slight limp' },
    { id: 'carried-case', slot: 'carried', text: 'carrying a leather case' },
    { id: 'carried-paper', slot: 'carried', text: 'carrying a folded newspaper' },
  ];
}

// --- assembly --------------------------------------------------------------

describe('describeNpc assembly', () => {
  it('draws one fragment per slot and joins them in slot order', () => {
    const pool = basePool();
    const descriptor = describeNpc(pool, 'm', COLD, new Set(), createPrng('d-1'));

    // The descriptor is composed of fragment texts; check each slot contributes
    // exactly one, and that they appear in the base slot order.
    const bySlot = new Map<string, string[]>();
    for (const f of pool) {
      const list = bySlot.get(f.slot) ?? [];
      list.push(f.text);
      bySlot.set(f.slot, list);
    }
    const slotOrder = ['build', 'age', 'clothing', 'headwear', 'feature', 'carried'];
    let cursor = 0;
    for (const slot of slotOrder) {
      const used = (bySlot.get(slot) ?? []).filter((t) => descriptor.includes(t));
      expect(used).toHaveLength(1);
      const at = descriptor.indexOf(used[0]);
      expect(at).toBeGreaterThanOrEqual(cursor);
      cursor = at;
    }
  });

  it('omits the carried slot when no carried fragment is eligible', () => {
    const pool = basePool().filter((f) => f.slot !== 'carried');
    const descriptor = describeNpc(pool, 'm', COLD, new Set(), createPrng('d-2'));
    expect(descriptor).not.toContain('carrying');
  });
});

// --- filtering -------------------------------------------------------------

describe('describeNpc filtering', () => {
  it('uses only fragments matching the NPC gender', () => {
    const pool: DescriptorFragment[] = [
      { id: 'build-f', slot: 'build', text: 'FEMONLY', gender: 'f' },
      { id: 'build-m', slot: 'build', text: 'MASONLY', gender: 'm' },
      { id: 'age-any', slot: 'age', text: 'middle-aged' },
    ];
    for (let i = 0; i < 20; i += 1) {
      const fem = describeNpc(pool, 'f', COLD, new Set(), createPrng(`g-f-${i}`));
      const masc = describeNpc(pool, 'm', COLD, new Set(), createPrng(`g-m-${i}`));
      expect(fem).toContain('FEMONLY');
      expect(fem).not.toContain('MASONLY');
      expect(masc).toContain('MASONLY');
      expect(masc).not.toContain('FEMONLY');
    }
  });

  it('uses only fragments matching the city climate', () => {
    const pool: DescriptorFragment[] = [
      { id: 'hat-fur', slot: 'headwear', text: 'FURHAT', climate: [COLD] },
      { id: 'hat-straw', slot: 'headwear', text: 'STRAWHAT', climate: [WARM] },
      { id: 'build-any', slot: 'build', text: 'tall' },
    ];
    for (let i = 0; i < 20; i += 1) {
      const cold = describeNpc(pool, 'm', COLD, new Set(), createPrng(`c-cold-${i}`));
      const warm = describeNpc(pool, 'm', WARM, new Set(), createPrng(`c-warm-${i}`));
      expect(cold).toContain('FURHAT');
      expect(cold).not.toContain('STRAWHAT');
      expect(warm).toContain('STRAWHAT');
      expect(warm).not.toContain('FURHAT');
    }
  });

  it('treats an unset or empty climate as fitting every city', () => {
    const pool: DescriptorFragment[] = [
      { id: 'build-any', slot: 'build', text: 'wiry' },
      { id: 'build-empty', slot: 'build', text: 'wiry2', climate: [] },
    ];
    const descriptor = describeNpc(pool, 'f', WARM, new Set(), createPrng('empty-clim'));
    expect(descriptor.length).toBeGreaterThan(0);
  });
});

// --- uniqueness ------------------------------------------------------------

describe('describeNpc uniqueness', () => {
  it('redraws a descriptor already in the used set', () => {
    const pool = basePool();
    const used = new Set<string>();
    const rng = createPrng('uniq-redraw');
    for (let i = 0; i < 20; i += 1) {
      const descriptor = describeNpc(pool, 'm', COLD, used, rng);
      expect(used.has(descriptor)).toBe(false);
      used.add(descriptor);
    }
    expect(used.size).toBe(20);
  });

  it('appends a feature fragment when the base descriptor keeps colliding', () => {
    // A pool with a single choice in every base slot but several `feature`
    // fragments. Every base draw is identical, so once used the redraw phase
    // exhausts and a distinguishing feature must be appended to stay unique.
    const pool: DescriptorFragment[] = [
      { id: 'build-only', slot: 'build', text: 'medium build' },
      { id: 'age-only', slot: 'age', text: 'middle-aged' },
      { id: 'feature-a', slot: 'feature', text: 'with a mole' },
      { id: 'feature-b', slot: 'feature', text: 'with a crooked nose' },
      { id: 'feature-c', slot: 'feature', text: 'with cropped hair' },
    ];
    const used = new Set<string>();
    const rng = createPrng('append-feature');
    const descriptors: string[] = [];
    // Draw more NPCs than the single base can distinguish without extra
    // features, forcing the append path for all but the first.
    for (let i = 0; i < 4; i += 1) {
      const descriptor = describeNpc(pool, 'm', COLD, used, rng);
      expect(used.has(descriptor)).toBe(false);
      used.add(descriptor);
      descriptors.push(descriptor);
    }
    // All distinct.
    expect(new Set(descriptors).size).toBe(descriptors.length);
    // Every descriptor shares the single base line and at least one carries two
    // feature phrases (an appended feature) to break the collision.
    const twoFeatureCount = descriptors.filter(
      (d) => (d.match(/with /g) ?? []).length >= 2,
    ).length;
    expect(twoFeatureCount).toBeGreaterThan(0);
  });

  it('stays total when the pool cannot distinguish enough NPCs', () => {
    // A degenerate single-combination pool with no feature slot: the second NPC
    // must still get a (duplicate) descriptor rather than loop or throw.
    const pool: DescriptorFragment[] = [
      { id: 'build-only', slot: 'build', text: 'slight' },
    ];
    const first = 'slight';
    const used = new Set<string>([first]);
    const result = describeNpc(pool, 'm', COLD, used, createPrng('degenerate'));
    expect(result).toBe(first);
    expect(MAX_DESCRIPTOR_REJECTIONS).toBeGreaterThan(0);
  });
});

// --- determinism -----------------------------------------------------------

describe('describeNpc determinism', () => {
  it('is a pure function of its inputs and the PRNG state', () => {
    const pool = basePool();
    const a = describeNpc(pool, 'f', COLD, new Set(), createPrng('det'));
    const b = describeNpc(pool, 'f', COLD, new Set(), createPrng('det'));
    expect(a).toBe(b);
  });

  it('does not mutate the used-descriptor set', () => {
    const pool = basePool();
    const used = new Set<string>(['slim greying']);
    const before = new Set(used);
    describeNpc(pool, 'f', COLD, used, createPrng('nomut'));
    expect(used).toEqual(before);
  });

  it('ignores authored fragment order (sorted by id)', () => {
    const pool = basePool();
    const shuffled = [...pool].reverse();
    const a = describeNpc(pool, 'm', COLD, new Set(), createPrng('order'));
    const b = describeNpc(shuffled, 'm', COLD, new Set(), createPrng('order'));
    expect(a).toBe(b);
  });
});

// --- property: descriptor uniqueness ---------------------------------------

describe('Property 10 (partial): descriptor uniqueness', () => {
  // A pool with enough fragments per slot (and several features) that the base
  // space plus appended features comfortably distinguishes a world, mirroring
  // the shipped content's quantity targets (≥150 fragments across slots).
  const slots = ['build', 'age', 'clothing', 'headwear', 'feature', 'carried'] as const;
  const pool: DescriptorFragment[] = slots.flatMap((slot) =>
    Array.from({ length: 6 }, (_, i): DescriptorFragment => ({
      id: `${slot}-${i}`,
      slot,
      text: `${slot}${i}`,
    })),
  );
  // A handful of gender- and climate-tagged fragments to exercise the filter.
  pool.push(
    { id: 'feature-fem', slot: 'feature', text: 'featureFem', gender: 'f' },
    { id: 'headwear-fur', slot: 'headwear', text: 'headwearFur', climate: [COLD] },
    { id: 'headwear-straw', slot: 'headwear', text: 'headwearStraw', climate: [WARM] },
  );

  const climateOf = (c: boolean): string => (c ? COLD : WARM);

  it('describes a whole world with distinct, eligible descriptors, deterministically', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        fc.integer({ min: 1, max: 40 }),
        fc.boolean(),
        (seed, count, cold) => {
          const climate = climateOf(cold);
          const other = climateOf(!cold);

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

          // Distinct descriptors (Req 6.5).
          expect(new Set(texts).size).toBe(texts.length);

          // Each uses only eligible fragments (Req 6.4): no opposite-gender and
          // no wrong-climate fragment text appears.
          for (const { gender, text } of world) {
            const wrongGender = gender === 'f' ? '' : 'featureFem';
            if (wrongGender.length > 0) {
              expect(text).not.toContain(wrongGender);
            }
            const wrongClimate = other === COLD ? 'headwearFur' : 'headwearStraw';
            expect(text).not.toContain(wrongClimate);
          }

          // Deterministic from the seed (Property 14).
          expect(describeWorld()).toEqual(world);
        },
      ),
      { numRuns: 60 },
    );
  });
});
