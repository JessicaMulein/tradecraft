/**
 * Golden previews for the shipped City Packs (content-expansion task 10.3;
 * design, "Preview CLI"; Req 14.1, 14.2, 14.3).
 *
 * Task 10.3 records a `city`, `npcs`, `newspaper` and `fact-lines` preview for
 * each shipped city at a fixed seed and the `standard` preset, and asserts them
 * in CI. Preview output is deterministic UTF-8 with `\n` endings and is
 * byte-stable for a given `(packs, city, seed, preset, kind, reveal, count)`
 * (Property 16, task 5.10), so an exact string match is the whole assertion:
 * if a content, generator or projection change moves any shipped city's preview
 * off its recorded bytes, this spec fails and the author re-records
 * deliberately.
 *
 * **Recording.** The golden files live under
 * `packages/content-tools/test/golden/<city>-<kind>.txt`. On the first run (and
 * whenever a golden is missing — e.g. a newly added city) the spec writes the
 * current `previewText` output to the golden file, then reads it straight back
 * and asserts the match, so the recording run and every later run take the
 * identical assertion path. The recorded files are committed; thereafter the
 * spec regenerates each preview and asserts it byte-matches the committed
 * golden. To intentionally re-record (after an approved content/engine change),
 * delete the stale `*.txt` under `test/golden/` and run the suite once.
 *
 * **Loading.** Each city is previewed from exactly the packs it needs: the city
 * pack plus the core, era and library packs it `requires`, pulled in
 * transitively by `loadPreviewContent` from the shipped packs directory. The
 * `setting.city` the generator keys on is the loaded City Bundle id, which the
 * loader namespaces as `<packId>/<cityId>` (e.g. `city-vienna/vienna`) — the
 * same id the Coverage Report feeds `generate` from `Object.keys(set.cities)`.
 * The two day-boundary kinds (`newspaper`, `fact-lines`) read material the clock
 * produces, so the world is advanced for them; `buildPreviewWorld` handles that
 * from `needsAdvance`, and `previewText` wires it.
 *
 * **Fixed seeds.** One seed per city, documented in {@link CITIES}: Vienna
 * `vienna-golden`, Berlin `berlin-golden`, Istanbul `istanbul-golden`, Lisbon
 * `lisbon-golden`, Trieste `trieste-golden`. The preset is always `standard`
 * and `--reveal` is off (goldens are the player-safe projection output), with a
 * fixed `count` per list kind.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  loadPreviewContent,
  previewText,
  type PreviewContent,
  type PreviewKind,
  type PreviewTextOptions,
} from './index.js';

/** The repo root, four directories up from this file (`src/preview/`). */
const REPO_ROOT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
);
/** The parent of the shipped packs; `loadPreviewContent` expands it to one
 * directory per pack and resolves each city's `requires` transitively. */
const PACKS_DIR = join(REPO_ROOT, 'packages', 'content', 'packs');
/** Where the committed golden preview files live (task 10.3). */
const GOLDEN_DIR = join(REPO_ROOT, 'packages', 'content-tools', 'test', 'golden');

/** The preview kinds task 10.3 records for every shipped city. */
const KINDS = ['city', 'npcs', 'newspaper', 'fact-lines'] as const satisfies readonly PreviewKind[];

/** The item count a list kind prints in the goldens (fixed, like the seed). */
const COUNT = 10;

/**
 * The shipped cities. `pack` is the City Pack loaded (its `requires` pull in
 * core, the era and the libraries transitively). `city` is the bundle city id;
 * the generator keys `setting.city` on the loaded, namespaced bundle id
 * `<pack>/<city>` (built below). `seed` is the one fixed seed the city's goldens
 * are recorded at — part of the golden contract, so changing one re-records that
 * city. `slug` names the golden files.
 */
const CITIES = [
  { pack: 'city-vienna', city: 'vienna', slug: 'vienna', seed: 'vienna-golden' },
  { pack: 'city-berlin', city: 'berlin', slug: 'berlin', seed: 'berlin-golden' },
  { pack: 'city-istanbul', city: 'istanbul', slug: 'istanbul', seed: 'istanbul-golden' },
  { pack: 'city-lisbon', city: 'lisbon', slug: 'lisbon', seed: 'lisbon-golden' },
  { pack: 'city-trieste', city: 'trieste', slug: 'trieste', seed: 'trieste-golden' },
] as const;

/** The namespaced bundle id the generator keys `setting.city` on. */
function settingCityId(entry: (typeof CITIES)[number]): string {
  return `${entry.pack}/${entry.city}`;
}

/** The golden file for a city/kind pair, e.g. `vienna-newspaper.txt`. */
function goldenPath(slug: string, kind: PreviewKind): string {
  return join(GOLDEN_DIR, `${slug}-${kind}.txt`);
}

describe('golden previews for the shipped cities (task 10.3; Req 14.1, 14.2, 14.3)', () => {
  for (const entry of CITIES) {
    describe(`${entry.city} (seed ${entry.seed})`, () => {
      // Load the city's pack set once and reuse it for all four kinds. The
      // city pack id drives the load; the loader resolves its core/era/library
      // requires transitively from the shipped packs directory.
      let loaded: PreviewContent;

      beforeAll(() => {
        loaded = loadPreviewContent([PACKS_DIR], [entry.pack]);
      });

      for (const kind of KINDS) {
        it(`matches the recorded ${kind} golden`, () => {
          const options: PreviewTextOptions = {
            city: settingCityId(entry),
            preset: 'standard',
            seed: entry.seed,
            kind,
            count: COUNT,
            reveal: false,
          };
          const text = previewText(loaded, options);

          // Byte-stable text uses only `\n` line endings (Req 14.3): the golden
          // files are plain UTF-8 with no CR, so a raw read compares exactly.
          expect(text).not.toContain('\r');

          const path = goldenPath(entry.slug, kind);
          if (!existsSync(path)) {
            // First run (or a missing golden): record it, then fall through to
            // the same assertion every later run takes.
            mkdirSync(GOLDEN_DIR, { recursive: true });
            writeFileSync(path, text, 'utf8');
          }

          const golden = readFileSync(path, 'utf8');
          expect(text).toBe(golden);
        });
      }
    });
  }
});
