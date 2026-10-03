/**
 * The `descriptors.yaml` content kind — the **Descriptor library** (design,
 * "Content Packs"; Requirements 22.3, 31.1). The world generator dresses an NPC
 * by drawing from the descriptor pools its archetype names (`descriptorPools:
 * [...]`); generation draws short period-correct phrases from each named pool to
 * build a physical descriptor the Narrator may elaborate and a Fact Line can
 * slot in.
 *
 * The library has two parts (design's content-kinds table): a `shared` block of
 * allegiance-neutral build / hair / grooming / face notes, and named clothing
 * `pools` of `garments` and `accessories`. **Every entry carries a `fits` tag**
 * (`any`, `female` or `male`) so the generator draws only entries that suit a
 * persona's gender (Requirement 1.7). An entry may be written as a bare string
 * (which reads as `fits: any`) or as `{ text, fits }`; {@link normalizeEntries}
 * folds both into a canonical `{ text, fits }` list, and {@link fittingPhrases}
 * returns just the texts that suit a requested gender.
 *
 * This file is loaded on its own (via {@link loadDescriptorData}) rather than
 * through the merged `ContentSet`, mirroring `city.yaml` — its shape serves the
 * engine's world generator rather than the shared content vocabulary. The pack
 * loader (see {@link import('./loader.js')}) now parses it with
 * {@link DescriptorDataSchema} and checks that every pool an archetype names
 * resolves (Requirement 31.2), so an archetype can no longer reference a pool
 * the library does not define. Keeping the parse here honours the rule that
 * `content` is the only package that reads pack files from disk.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

// --- fits -------------------------------------------------------------------

/** The genders a descriptor entry may suit. `any` fits every persona. */
export const DESCRIPTOR_FITS = ['any', 'female', 'male'] as const;
/** A `fits` tag: which persona gender a descriptor entry suits. */
export type DescriptorFits = (typeof DESCRIPTOR_FITS)[number];
export const DescriptorFitsSchema = z.enum(DESCRIPTOR_FITS);

/** The persona genders the generator draws descriptors for. */
export const PERSONA_GENDERS = ['female', 'male'] as const;
/** A persona gender. */
export type PersonaGender = (typeof PERSONA_GENDERS)[number];

// --- entries ----------------------------------------------------------------

/**
 * One descriptor entry, as authored: either a bare phrase string — which reads
 * as `fits: any` — or an object carrying the phrase `text` and its `fits` tag.
 * Non-strict on the object form so an authored entry may carry extra fields for
 * later tasks or the Narrator.
 */
export const DescriptorEntrySchema = z.union([
  z.string().min(1),
  z
    .object({
      text: z.string().min(1),
      fits: DescriptorFitsSchema.default('any'),
    })
    .loose(),
]);
export type DescriptorEntry = z.infer<typeof DescriptorEntrySchema>;

/** A list of descriptor entries, defaulting to empty. */
const EntryListSchema = z.array(DescriptorEntrySchema).default([]);

/** A normalised descriptor entry: a phrase plus the gender it fits. */
export interface NormalizedEntry {
  readonly text: string;
  readonly fits: DescriptorFits;
}

/**
 * Fold a list of authored descriptor entries into canonical `{ text, fits }`
 * records: a bare string becomes `{ text, fits: 'any' }`, an object keeps its
 * fields. Order is preserved so draws stay deterministic.
 */
export function normalizeEntries(
  entries: readonly DescriptorEntry[],
): readonly NormalizedEntry[] {
  return entries.map((entry) =>
    typeof entry === 'string'
      ? { text: entry, fits: 'any' as const }
      : { text: entry.text, fits: entry.fits },
  );
}

/**
 * The phrases from `entries` that suit `gender`: an entry fits when its tag is
 * `any` or exactly the requested gender. Order is preserved. This is the one
 * helper the generator uses to honour Requirement 1.7's "draw only entries that
 * fit the persona's gender".
 */
export function fittingPhrases(
  entries: readonly DescriptorEntry[],
  gender: PersonaGender,
): readonly string[] {
  return normalizeEntries(entries)
    .filter((entry) => entry.fits === 'any' || entry.fits === gender)
    .map((entry) => entry.text);
}

// --- pools -----------------------------------------------------------------

/**
 * One descriptor pool: the clothing and small-tell phrases that dress a kind of
 * person. `label` is the human phrase for the pool (`everyday Viennese street
 * dress`); `garments` are the clothing lines proper; `accessories` are the
 * individuating tells. Each entry carries a `fits` tag. Non-strict so an
 * authored pool may carry extra fields for later tasks or the Narrator.
 */
export const DescriptorPoolSchema = z
  .object({
    label: z.string().min(1).optional(),
    garments: EntryListSchema,
    accessories: EntryListSchema,
  })
  .loose();
export type DescriptorPool = z.infer<typeof DescriptorPoolSchema>;

/**
 * The shared, allegiance-neutral building blocks a pool mixes in: build, hair,
 * grooming and face notes, each a {@link DescriptorEntry} with a `fits` tag.
 * Every list defaults to empty so a file that omits a block still validates.
 * Non-strict for the same forward-compatible reason as
 * {@link DescriptorPoolSchema}.
 */
export const DescriptorSharedSchema = z
  .object({
    build: EntryListSchema,
    hair: EntryListSchema,
    grooming: EntryListSchema,
    face: EntryListSchema,
  })
  .loose();
export type DescriptorShared = z.infer<typeof DescriptorSharedSchema>;

// --- descriptor data -------------------------------------------------------

/**
 * The validated `descriptors.yaml`: a map of named descriptor pools plus the
 * shared building-block lists. This is the shape the engine's world generator
 * consumes to dress NPCs (Requirements 22.3, 1.7). Non-strict and defaulting
 * throughout, so the generator reads the pools it needs and tolerates extra
 * structure.
 */
export const DescriptorDataSchema = z
  .object({
    version: z.number().int().optional(),
    shared: DescriptorSharedSchema.default({
      build: [],
      hair: [],
      grooming: [],
      face: [],
    }),
    pools: z.record(z.string(), DescriptorPoolSchema).default({}),
  })
  .loose();
export type DescriptorData = z.infer<typeof DescriptorDataSchema>;

/** The default name of the descriptor file inside a pack directory. */
export const DESCRIPTOR_FILE = 'descriptors.yaml';

/** The ids of every pool a {@link DescriptorData} defines. */
export function descriptorPoolIds(data: DescriptorData): readonly string[] {
  return Object.keys(data.pools);
}

/**
 * The outcome of loading `descriptors.yaml`: either the validated
 * {@link DescriptorData} or a located error (file plus field path plus
 * message), mirroring {@link import('./city-data.js').CityDataResult} so the
 * engine can report it uniformly.
 */
export type DescriptorDataResult =
  | { readonly ok: true; readonly value: DescriptorData }
  | {
      readonly ok: false;
      readonly errors: ReadonlyArray<{
        readonly file: string;
        readonly path: string;
        readonly message: string;
      }>;
    };

/** Format a Zod issue path as the dotted/bracketed string used in errors. */
function formatPath(path: ReadonlyArray<PropertyKey>): string {
  let out = '';
  for (const key of path) {
    if (typeof key === 'number') {
      out += `[${key}]`;
    } else {
      out += out === '' ? String(key) : `.${String(key)}`;
    }
  }
  return out;
}

/**
 * Read and validate `descriptors.yaml` from a pack directory.
 *
 * `packDir` is the directory that holds `descriptors.yaml` (for the slice,
 * `packages/content/packs/core`). A missing file, malformed YAML or a schema
 * violation is returned as a located error rather than thrown, so the engine's
 * generator can surface it the same way it surfaces a content load failure.
 */
export function loadDescriptorData(packDir: string): DescriptorDataResult {
  const file = DESCRIPTOR_FILE;
  const fullPath = join(packDir, file);

  let text: string;
  try {
    text = readFileSync(fullPath, 'utf8');
  } catch (err) {
    return {
      ok: false,
      errors: [
        { file, path: '', message: err instanceof Error ? err.message : String(err) },
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = parseYaml(text);
  } catch (err) {
    return {
      ok: false,
      errors: [
        { file, path: '', message: err instanceof Error ? err.message : String(err) },
      ],
    };
  }

  const result = DescriptorDataSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.map((issue) => ({
        file,
        path: formatPath(issue.path),
        message: issue.message,
      })),
    };
  }

  return { ok: true, value: result.data };
}

/** Parse already-read `descriptors.yaml` content (for tests and in-memory use). */
export function parseDescriptorData(value: unknown): DescriptorData {
  return DescriptorDataSchema.parse(value);
}
