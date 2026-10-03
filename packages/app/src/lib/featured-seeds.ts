/**
 * Featured seeds: per-preset lists of seeds the playability probe has vetted,
 * so a new game the player starts without naming a seed is always one that can
 * be won, and won mid-way through the operation rather than on day two or on
 * the last day.
 *
 * The list lives in `config/featured-seeds.json` and is written by
 * `pnpm seeds:vet` (`packages/app/scripts/vet-seeds.ts`), which plays each
 * candidate seed with the expert probe and keeps those inside the calibration
 * bands. A seed the player types is never checked: any seed still plays.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The repo-relative path of the featured-seed list. */
export const FEATURED_SEEDS_PATH = join('config', 'featured-seeds.json');

/** One vetted seed and what the probe measured on it. */
export interface FeaturedSeed {
  readonly seed: string;
  /** The day the expert probe won on, and the operation's final stage day. */
  readonly winDay: number;
  readonly finalDeadline: number;
}

/** The featured seeds by preset id. */
export type FeaturedSeeds = Readonly<Record<string, readonly FeaturedSeed[]>>;

/**
 * Read `config/featured-seeds.json` under `repoRoot`. A missing or malformed
 * file yields an empty list, so a checkout without one still starts games on
 * random seeds.
 */
export function loadFeaturedSeeds(repoRoot: string): FeaturedSeeds {
  let text: string;
  try {
    text = readFileSync(join(repoRoot, FEATURED_SEEDS_PATH), 'utf8');
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(text) as { presets?: unknown };
    const presets = parsed.presets;
    if (presets === null || typeof presets !== 'object') {
      return {};
    }
    const out: Record<string, FeaturedSeed[]> = {};
    for (const [preset, list] of Object.entries(presets as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      out[preset] = list.filter(
        (e): e is FeaturedSeed =>
          e !== null &&
          typeof e === 'object' &&
          typeof (e as FeaturedSeed).seed === 'string' &&
          (e as FeaturedSeed).seed.length > 0,
      );
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * A `seedSource` for the facade: a uniformly drawn featured seed for the
 * preset, or `undefined` (a fresh random seed) when the preset has none. The
 * draw is the same kind of non-deterministic read as minting a random seed, and
 * happens once, before any Sim call.
 */
export function featuredSeedSource(
  featured: FeaturedSeeds,
  pick: (n: number) => number = (n) => Math.floor(Math.random() * n),
): (preset: string) => string | undefined {
  return (preset) => {
    const list = featured[preset];
    if (list === undefined || list.length === 0) {
      return undefined;
    }
    return list[pick(list.length)]?.seed;
  };
}
