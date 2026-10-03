/**
 * The Library Pack load test for `lib-descriptors` (content-expansion task 8.4).
 *
 * Loads the shipped `lib-descriptors` Library Pack together with the core pack
 * from disk through `loadContent`, exactly as a scenario drawing NPC
 * descriptors from these fragments would, and asserts the load succeeds with no
 * ContentErrors. It then confirms the merged Content Set carries the authored
 * Descriptor Fragments and that they meet the task's targets:
 *
 *   * at least 150 fragments in total (Req 11.6);
 *   * every one of the six descriptor slots is represented (Req 6.3);
 *   * fragment ids are unique (CE-DUPID);
 *   * gendered and year-ranged fragments are present (period clothing and
 *     gendered grooming, Req 6.3), and every Year Range lies within the era
 *     Period Window 1945–1965.
 *
 * Climate Tags are intentionally not asserted: the core Tag Vocabulary ships no
 * `climate:*` Tag yet, so fragments are authored climate-neutral and the
 * descriptor generator falls back to the city's climate (see the pack manifest
 * and the era `climateDefault` note).
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DESCRIPTOR_SLOTS,
  loadContent,
  type ContentSet,
  type DescriptorFragment,
  type LoadResult,
} from '../index.js';

const PACKS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'packs',
);
const CORE_DIR = join(PACKS_DIR, 'core');
const DESCRIPTORS_DIR = join(PACKS_DIR, 'lib-descriptors');

/** Load core + the descriptor Library Pack, surfacing every ContentError. */
function loadDescriptorPack(): ContentSet {
  const result: LoadResult<ContentSet> = loadContent(
    [CORE_DIR, DESCRIPTORS_DIR],
    ['core', 'lib-descriptors'],
  );
  if (!result.ok) {
    throw new Error(
      `lib-descriptors failed to load with ${result.errors.length} error(s):\n${result.errors
        .map((e) => `  ${e.pack}/${e.file} ${e.path}: ${e.message}`)
        .join('\n')}`,
    );
  }
  return result.value;
}

/** The authored fragments, filtered to those this pack owns. */
function descriptorFragments(set: ContentSet): readonly DescriptorFragment[] {
  return set.descriptorFragments;
}

describe('lib-descriptors Library Pack', () => {
  it('loads cleanly with the core pack (no ContentErrors)', () => {
    const result = loadContent(
      [CORE_DIR, DESCRIPTORS_DIR],
      ['core', 'lib-descriptors'],
    );
    expect(result.ok).toBe(true);
  });

  it('ships at least 150 Descriptor Fragments (Req 11.6)', () => {
    const fragments = descriptorFragments(loadDescriptorPack());
    expect(fragments.length).toBeGreaterThanOrEqual(150);
  });

  it('represents every descriptor slot (Req 6.3)', () => {
    const fragments = descriptorFragments(loadDescriptorPack());
    const slots = new Set(fragments.map((f) => f.slot));
    for (const slot of DESCRIPTOR_SLOTS) {
      expect(slots.has(slot), `missing slot ${slot}`).toBe(true);
    }
  });

  it('has unique fragment ids (CE-DUPID)', () => {
    const fragments = descriptorFragments(loadDescriptorPack());
    const ids = fragments.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('carries gendered fragments for grooming and gendered dress', () => {
    const fragments = descriptorFragments(loadDescriptorPack());
    expect(fragments.some((f) => f.gender === 'm')).toBe(true);
    expect(fragments.some((f) => f.gender === 'f')).toBe(true);
  });

  it('carries period year-ranged clothing within the window 1945–1965', () => {
    const fragments = descriptorFragments(loadDescriptorPack());
    const dated = fragments.filter((f) => f.years !== undefined);
    expect(dated.length).toBeGreaterThan(0);
    for (const f of dated) {
      expect(f.years!.from, `${f.id} from`).toBeGreaterThanOrEqual(1945);
      expect(f.years!.to, `${f.id} to`).toBeLessThanOrEqual(1965);
    }
    // Year-ranged fragments are period dress and period headwear.
    expect(dated.every((f) => f.slot === 'clothing' || f.slot === 'headwear')).toBe(
      true,
    );
    expect(dated.some((f) => f.slot === 'clothing')).toBe(true);
  });
});
