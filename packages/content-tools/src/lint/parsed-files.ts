/**
 * Reading and walking a pack's parsed files for the Pack Linter (content-
 * expansion task 5.2).
 *
 * The Content Loader does not hand back the raw parsed files, and the linter
 * must run its rules over those files *even when loading failed* (Req 13.1). So
 * the linter reads each pack directory itself, in the same deterministic,
 * sorted-by-path order the loader uses, and parses every `.yaml`/`.yml` file
 * with the `yaml` dependency. A file that fails to parse contributes no items
 * but is still recorded (its load error is mapped to CE-SCHEMA elsewhere).
 *
 * It also provides the {@link JsonPath} walker the generic Field-Declaration
 * rules use (Req 13.8). A Field Declaration path such as `items[].tags[]` names
 * every element of every item's `tags` list; {@link fieldValues} resolves one
 * such path over a parsed file and yields each leaf together with the concrete,
 * indexed error path (`items[2].tags[0]`) the loader and the design use for a
 * finding's `path`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { parse as parseYaml } from 'yaml';
import type { JsonPath } from '@tradecraft/content';

/** One parsed file within a pack: its pack-relative path and parsed content. */
export interface ParsedFile {
  /** Always `/`-separated, matching the loader's error `file` field. */
  readonly relPath: string;
  /** The parsed YAML, or `undefined` when the file failed to parse. */
  readonly content: unknown;
  /** True when the YAML parsed; false records a parse failure for the file. */
  readonly parsed: boolean;
}

/** A discovered pack for the linter: its directory, id and parsed files. */
export interface ParsedPack {
  readonly dir: string;
  /**
   * The pack id from `pack.yaml` when it parsed, else the directory basename.
   * Findings use this so a finding points at the pack an author recognises even
   * when the manifest itself is broken.
   */
  readonly id: string;
  readonly files: readonly ParsedFile[];
}

/** List every `.yaml`/`.yml` file under `dir`, recursively, sorted by path. */
function listYamlFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(current).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      const full = join(current, name);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        walk(full);
      } else if (name.endsWith('.yaml') || name.endsWith('.yml')) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out.sort();
}

/** Normalise an OS path to the `/`-separated form used in rules and errors. */
function toRelPath(packDir: string, fullPath: string): string {
  return relative(packDir, fullPath).split(sep).join('/');
}

/** Parse one file's text; a YAML error leaves `content` undefined. */
function parseFile(full: string): { content: unknown; parsed: boolean } {
  let text: string;
  try {
    text = readFileSync(full, 'utf8');
  } catch {
    return { content: undefined, parsed: false };
  }
  try {
    return { content: parseYaml(text), parsed: true };
  } catch {
    return { content: undefined, parsed: false };
  }
}

/**
 * Read and parse every pack directory into {@link ParsedPack}s, deterministic
 * in `dir` order then path order. The pack id is read from `pack.yaml` when it
 * parses to an object with a string `id`, else the directory basename, so a
 * finding is still attributable when the manifest is unparseable.
 */
export function readParsedPacks(dirs: readonly string[]): ParsedPack[] {
  const packs: ParsedPack[] = [];
  for (const dir of dirs) {
    const files: ParsedFile[] = [];
    for (const full of listYamlFiles(dir)) {
      const relPath = toRelPath(dir, full);
      const { content, parsed } = parseFile(full);
      files.push({ relPath, content, parsed });
    }
    packs.push({ dir, id: packIdOf(dir, files), files });
  }
  return packs;
}

/** The pack id from a parsed `pack.yaml`, else the directory basename. */
function packIdOf(dir: string, files: readonly ParsedFile[]): string {
  const manifest = files.find((f) => f.relPath === 'pack.yaml');
  if (
    manifest !== undefined &&
    typeof manifest.content === 'object' &&
    manifest.content !== null &&
    !Array.isArray(manifest.content)
  ) {
    const id = (manifest.content as Record<string, unknown>).id;
    if (typeof id === 'string' && id.length > 0) {
      return id;
    }
  }
  return dir.split(sep).filter((s) => s.length > 0).at(-1) ?? dir;
}

// --- items + the JsonPath walker -------------------------------------------

/**
 * The items of a parsed content file, with the error-path prefix each item
 * reports under. A bare list reports `[i]`, the `{ provenance?, items }`
 * envelope reports `items[i]`, and a single mapping reports no prefix — mirroring
 * the loader so a finding points at the same place a load error would.
 */
export interface ItemList {
  readonly items: readonly unknown[];
  readonly pathAt: (index: number) => string;
}

/** Resolve a parsed file's content to its {@link ItemList}. */
export function itemsOf(content: unknown): ItemList {
  if (Array.isArray(content)) {
    return { items: content, pathAt: (i) => `[${i}]` };
  }
  if (
    typeof content === 'object' &&
    content !== null &&
    Array.isArray((content as Record<string, unknown>).items)
  ) {
    const items = (content as Record<string, unknown>).items as unknown[];
    return { items, pathAt: (i) => `items[${i}]` };
  }
  if (typeof content === 'object' && content !== null) {
    return { items: [content], pathAt: () => '' };
  }
  return { items: [], pathAt: () => '' };
}

/** One resolved leaf of a Field Declaration path: its value and error path. */
export interface FieldLeaf {
  readonly value: unknown;
  /** The concrete, indexed path, e.g. `items[2].tags[0]`. */
  readonly path: string;
}

/** A token of a parsed path: a named field or a list expansion. */
type PathToken = { readonly kind: 'field'; readonly name: string } | { readonly kind: 'list' };

/** Tokenise a Field Declaration path into field/list tokens. */
function tokenise(path: JsonPath): PathToken[] {
  const tokens: PathToken[] = [];
  for (const seg of path.split('.')) {
    if (seg === '') {
      continue;
    }
    let name = seg;
    let lists = 0;
    while (name.endsWith('[]')) {
      name = name.slice(0, -2);
      lists += 1;
    }
    if (name !== '') {
      tokens.push({ kind: 'field', name });
    }
    for (let i = 0; i < lists; i += 1) {
      tokens.push({ kind: 'list' });
    }
  }
  return tokens;
}

/**
 * Resolve a Field Declaration path (such as `items[].tags[]`) over a parsed
 * file's content, yielding every leaf value together with the concrete indexed
 * error path. A `.name` token descends into a field; a `[]` token iterates a
 * list, appending `[i]` to the path. Missing fields and `[]` on a non-list
 * simply yield nothing, so an optional or absent field contributes no leaves.
 *
 * The declaration's leading `items`/`items[]` is handled uniformly with every
 * other segment, so the error path a leaf carries is exactly the loader's form
 * (`items[0].description`, `[0].tags[1]`), whichever file layout the author
 * used.
 */
export function fieldValues(content: unknown, path: JsonPath): FieldLeaf[] {
  let frontier: FieldLeaf[] = [{ value: content, path: '' }];
  for (const token of tokenise(path)) {
    const next: FieldLeaf[] = [];
    for (const leaf of frontier) {
      if (token.kind === 'list') {
        if (Array.isArray(leaf.value)) {
          leaf.value.forEach((v, i) => next.push({ value: v, path: `${leaf.path}[${i}]` }));
        }
        continue;
      }
      const node = leaf.value;
      if (
        typeof node === 'object' &&
        node !== null &&
        !Array.isArray(node) &&
        token.name in (node as Record<string, unknown>)
      ) {
        const value = (node as Record<string, unknown>)[token.name];
        const path = leaf.path === '' ? token.name : `${leaf.path}.${token.name}`;
        next.push({ value, path });
      }
    }
    frontier = next;
  }
  return frontier.filter((leaf) => leaf.value !== undefined && leaf.value !== null);
}
