/**
 * The `public-texts/` corpora: the almanac, poetry-and-prose anthology and the
 * Vienna tram-and-rail timetable the world generator issues as readable public
 * Documents and, crucially, as the key material a BOOK CIPHER counts across
 * (design, "Document Generator" / "Content Packs"; Requirements 9.2, 30.1,
 * 30.3, 30.5).
 *
 * Like `city.yaml` (see {@link import('./city-data.js')}), the public-text files
 * are deliberately *outside* the main pack-kind table — the loader tolerates
 * their presence under `public-texts/` without parsing them, because their
 * shapes serve the engine's Document composers (task 5.6) rather than the shared
 * content vocabulary. This module gives them the two things they need to be used
 * safely across the package boundary: a permissive Zod schema per corpus kind,
 * and a small filesystem-reading loader, so the engine consumes a validated
 * {@link PublicText} value instead of hand-parsing YAML. Keeping the parse here
 * honours the rule that `content` is the only package that reads pack files from
 * disk.
 *
 * The three corpora have different shapes (an almanac is a flat list of lines; an
 * anthology is numbered verse/prose passages; a timetable is nested tram and
 * rail tables), so rather than force one schema, each corpus is validated against
 * its own permissive schema and then reduced to a common {@link PublicText}: an
 * `id`, `kind`, `title`, and an ordered list of {@link readableText} lines — the
 * flattened, human-readable body a book cipher counts letters across and a reader
 * sees. The flattening is deterministic (document order), so the keyable body of
 * a given corpus is stable, which the book cipher relies on.
 *
 * Validation is intentionally permissive about *extra* keys (a corpus may carry a
 * `publisher`, `genre`, `notes` or `afterword` for flavour), so it uses loose
 * objects: the composer reads only the structural fields it needs to flatten the
 * body and ignores the rest.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

import { ContentIdSchema } from './common.js';

// --- corpus schemas --------------------------------------------------------

/** Fields every public-text corpus carries, whatever its body shape. */
const PublicTextHeaderSchema = z.object({
  id: ContentIdSchema,
  kind: z.literal('public-text'),
  title: z.string().min(1),
});

/**
 * The almanac: a flat, ordered list of plain prose `lines`. The keyable body is
 * the lines in order.
 */
export const AlmanacCorpusSchema = PublicTextHeaderSchema.extend({
  lines: z
    .array(z.string().min(1))
    .min(1, 'an almanac must have at least one line'),
}).loose();
export type AlmanacCorpus = z.infer<typeof AlmanacCorpusSchema>;

/**
 * One passage of the anthology: a number, a verse/prose kind, an optional title,
 * and the text as either a string (prose) or an array of lines (verse).
 */
export const AnthologyPassageSchema = z
  .object({
    number: z.number().int().optional(),
    kind: z.enum(['verse', 'prose']),
    title: z.string().optional(),
    text: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  })
  .loose();
export type AnthologyPassage = z.infer<typeof AnthologyPassageSchema>;

/**
 * The anthology: an optional preface, a list of verse/prose passages, and an
 * optional afterword. The keyable body is the preface, then each passage's text
 * in order, then the afterword.
 */
export const AnthologyCorpusSchema = PublicTextHeaderSchema.extend({
  preface: z.string().optional(),
  passages: z
    .array(AnthologyPassageSchema)
    .min(1, 'an anthology must have at least one passage'),
  afterword: z.string().optional(),
}).loose();
export type AnthologyCorpus = z.infer<typeof AnthologyCorpusSchema>;

/**
 * The timetable. Its tram and rail tables are deeply nested and carry both
 * strings (stop names, notes) and numbers (line numbers, times); the composer
 * flattens every string it finds, in document order, into the keyable body.
 * Validated only for its header and that it carries *some* body, so the authored
 * YAML can evolve its table shape without breaking the loader.
 */
export const TimetableCorpusSchema = PublicTextHeaderSchema.loose();
export type TimetableCorpus = z.infer<typeof TimetableCorpusSchema>;

// --- the common PublicText -------------------------------------------------

/**
 * A loaded public text, reduced to the shape every Document composer needs: its
 * identity and the ordered, human-readable `lines` the book cipher counts across
 * and a reader sees. `lines` is the flattened body — one entry per prose line,
 * verse line, or table string — in document order, so the keyable body is stable
 * for a given corpus.
 */
export interface PublicText {
  readonly id: string;
  readonly kind: 'public-text';
  readonly title: string;
  readonly lines: readonly string[];
}

/** The three authored public-text files, relative to the pack directory. */
export const PUBLIC_TEXT_FILES = [
  'public-texts/almanac.yaml',
  'public-texts/anthology.yaml',
  'public-texts/timetable.yaml',
] as const;

/** A located load error, mirroring {@link import('./city-data.js')}'s style. */
export interface PublicTextError {
  readonly file: string;
  readonly path: string;
  readonly message: string;
}

/** The outcome of loading one public-text file. */
export type PublicTextResult =
  | { readonly ok: true; readonly value: PublicText }
  | { readonly ok: false; readonly errors: readonly PublicTextError[] };

/** The outcome of loading every public-text file in a pack. */
export type PublicTextsResult =
  | { readonly ok: true; readonly value: readonly PublicText[] }
  | { readonly ok: false; readonly errors: readonly PublicTextError[] };

// --- flattening ------------------------------------------------------------

/**
 * Collect every string reachable from `value`, in a stable document order
 * (object values in insertion order, array items in order). This is how the
 * timetable's nested tables and the anthology's mixed text are reduced to a flat
 * readable body; the order is deterministic, so the keyable body never shifts
 * between loads of the same file.
 */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      out.push(trimmed);
    }
    return;
  }
  if (typeof value === 'number') {
    out.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, out);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectStrings(item, out);
    }
  }
}

/** Flatten an almanac to its ordered lines. */
function flattenAlmanac(corpus: AlmanacCorpus): PublicText {
  return {
    id: corpus.id,
    kind: 'public-text',
    title: corpus.title,
    lines: corpus.lines.map((line) => line.trim()).filter((line) => line.length > 0),
  };
}

/** Flatten an anthology to preface, each passage's text, then afterword. */
function flattenAnthology(corpus: AnthologyCorpus): PublicText {
  const lines: string[] = [];
  if (corpus.preface !== undefined) {
    collectStrings(corpus.preface, lines);
  }
  for (const passage of corpus.passages) {
    if (passage.title !== undefined) {
      collectStrings(passage.title, lines);
    }
    collectStrings(passage.text, lines);
  }
  if (corpus.afterword !== undefined) {
    collectStrings(corpus.afterword, lines);
  }
  return { id: corpus.id, kind: 'public-text', title: corpus.title, lines };
}

/** Flatten a timetable by collecting every string in its tables, in order. */
function flattenTimetable(corpus: TimetableCorpus): PublicText {
  const lines: string[] = [];
  // Skip the header fields (id/kind/title) so the body is only the tables.
  for (const [key, value] of Object.entries(corpus)) {
    if (key === 'id' || key === 'kind' || key === 'title') {
      continue;
    }
    collectStrings(value, lines);
  }
  return { id: corpus.id, kind: 'public-text', title: corpus.title, lines };
}

// --- loading ---------------------------------------------------------------

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

/** Which corpus flattener a public-text file uses, by its relative path. */
function flattenerFor(
  relPath: string,
): (parsed: unknown) => PublicText {
  if (relPath.endsWith('almanac.yaml')) {
    return (parsed) => flattenAlmanac(AlmanacCorpusSchema.parse(parsed));
  }
  if (relPath.endsWith('anthology.yaml')) {
    return (parsed) => flattenAnthology(AnthologyCorpusSchema.parse(parsed));
  }
  return (parsed) => flattenTimetable(TimetableCorpusSchema.parse(parsed));
}

/**
 * Read and validate one public-text file from a pack directory, reducing it to a
 * common {@link PublicText}. A missing file, malformed YAML or a schema violation
 * is returned as a located error rather than thrown.
 */
export function loadPublicText(packDir: string, relPath: string): PublicTextResult {
  const fullPath = join(packDir, relPath);

  let text: string;
  try {
    text = readFileSync(fullPath, 'utf8');
  } catch (err) {
    return {
      ok: false,
      errors: [
        { file: relPath, path: '', message: err instanceof Error ? err.message : String(err) },
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
        { file: relPath, path: '', message: err instanceof Error ? err.message : String(err) },
      ],
    };
  }

  try {
    return { ok: true, value: flattenerFor(relPath)(parsed) };
  } catch (err) {
    if (err instanceof z.ZodError) {
      return {
        ok: false,
        errors: err.issues.map((issue) => ({
          file: relPath,
          path: formatPath(issue.path),
          message: issue.message,
        })),
      };
    }
    return {
      ok: false,
      errors: [
        { file: relPath, path: '', message: err instanceof Error ? err.message : String(err) },
      ],
    };
  }
}

/**
 * Read and validate every public-text file ({@link PUBLIC_TEXT_FILES}) in a pack
 * directory, in a stable order. Returns all located errors across the files
 * rather than stopping at the first, mirroring the main loader's error
 * collection.
 */
export function loadPublicTexts(packDir: string): PublicTextsResult {
  const values: PublicText[] = [];
  const errors: PublicTextError[] = [];
  for (const relPath of PUBLIC_TEXT_FILES) {
    const result = loadPublicText(packDir, relPath);
    if (result.ok) {
      values.push(result.value);
    } else {
      errors.push(...result.errors);
    }
  }
  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value: values };
}

/** Parse already-read public-text content (for tests and in-memory use). */
export function parsePublicText(relPath: string, value: unknown): PublicText {
  return flattenerFor(relPath)(value);
}
