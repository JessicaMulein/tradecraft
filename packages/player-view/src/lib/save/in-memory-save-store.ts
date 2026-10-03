/**
 * An in-memory {@link SaveStore} and the canonical-JSON serialiser the facade's
 * save path uses (slice-integration task 9.4; design, "Facade: saves").
 *
 * The facade's `saves` surface is defined against the injected {@link SaveStore}
 * seam so player-view stays I/O-free: the fs implementation lives in `app`
 * (task 12.3), and tests — and the save/load round-trip property (Property 52),
 * the load-refusal property (Property 53) and the save-name-safety property
 * (Property 54) — drive this in-memory store instead. It lives in a non-spec
 * module (not a spec helper) because the Composition Root's Fake Seams and
 * other in-memory wiring need it too.
 *
 * ## What it stores
 *
 * The store keeps one canonical-JSON string per save name, exactly the bytes a
 * real file would hold, so a round-trip through it exercises the same
 * `JSON.parse` / schema-validate / `parseAndLoad` path the fs store does. A
 * write with a name already present overwrites it (the facade overwrites an
 * existing save by name), matching the fs store's temp-and-rename semantics
 * without the filesystem.
 *
 * ## list() headers
 *
 * `list()` reads each stored save's header fields — the determinism key
 * (`seed`, `difficulty`, the Content Manifest), the in-game `at` time and the
 * wall-clock `savedAt` — by parsing the JSON and lifting those top-level
 * fields. A string that is not valid JSON, or whose header fields are missing
 * or the wrong type, lists as `'corrupt'` (mirroring the fs store's
 * corrupt-header listing), so the save/load screen can show a bad save without
 * the facade having to fully validate it.
 *
 * ## Purity
 *
 * The store performs no I/O and reads no clock; it is a pure in-memory map. The
 * one wall-clock value a save carries (`savedAt`) is stamped by the facade when
 * it builds the snapshot, never here.
 */

import type { SaveHeader, SaveStore } from '../api/types.js';

/**
 * Serialise a save snapshot to the canonical JSON string a {@link SaveStore}
 * writes (design, "Facade: saves": "serialises with canonical JSON and writes").
 *
 * A v2 {@link import('./save.js').SaveSnapshot} is already canonical by
 * construction: `saveSnapshot` builds its fields in a fixed order and flattens
 * the Truth Store's Maps to **sorted** entry arrays (`toTruthSnapshot`), so two
 * equal sessions serialise to byte-identical strings. A plain `JSON.stringify`
 * therefore suffices — there is no need to re-sort object keys — and keeping the
 * serialiser a single call makes the round-trip property's "same bytes" claim
 * easy to reason about. The snapshot holds only JSON-safe values (the Maps are
 * already arrays), so `JSON.stringify` never drops a field or throws.
 */
export function canonicalJson(snapshot: unknown): string {
  return JSON.stringify(snapshot);
}

/**
 * Read the {@link SaveHeader} fields off a save's parsed JSON value, or return
 * `'corrupt'` when the value is not a well-formed save header. Used by
 * {@link InMemorySaveStore.list} (and available to the fs store) to list a save
 * cheaply without validating its whole body: it checks only the header fields
 * the save/load screen reads — `seed`, `difficulty`, the in-game `world.time`,
 * `savedAt` and the Content Manifest's `packs`.
 *
 * The determinism key lives at the save's top level (`seed`, `difficulty`,
 * `content`), and the in-game time is `world.time`; `at` is lifted from there so
 * the header matches {@link SaveHeader}. Any missing or wrong-typed field makes
 * the whole header `'corrupt'`.
 */
export function readSaveHeader(value: unknown): SaveHeader | 'corrupt' {
  if (typeof value !== 'object' || value === null) {
    return 'corrupt';
  }
  const v = value as Record<string, unknown>;

  const seed = v['seed'];
  const difficulty = readDifficultyId(v['difficulty']);
  const savedAt = v['savedAt'];
  const at = readGameTime(v['world']);
  const content = readManifest(v['content']);

  if (
    typeof seed !== 'string' ||
    difficulty === undefined ||
    typeof savedAt !== 'string' ||
    at === undefined ||
    content === undefined
  ) {
    return 'corrupt';
  }

  return { seed, difficulty, at, savedAt, content };
}

/** The Difficulty Preset's id from the save's `difficulty` field, if present. */
function readDifficultyId(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const id = (value as { id?: unknown }).id;
  return typeof id === 'string' ? id : undefined;
}

/** The in-game `{ day, phase }` from the save's `world.time`, if present. */
function readGameTime(world: unknown): SaveHeader['at'] | undefined {
  if (typeof world !== 'object' || world === null) {
    return undefined;
  }
  const time = (world as { time?: unknown }).time;
  if (typeof time !== 'object' || time === null) {
    return undefined;
  }
  const { day, phase } = time as { day?: unknown; phase?: unknown };
  if (typeof day !== 'number' || typeof phase !== 'number') {
    return undefined;
  }
  // `phase` is a branded `Phase` on `GameTime`; the raw save holds a plain
  // number, so coerce the pair to the header's `GameTime` shape.
  return { day, phase } as unknown as SaveHeader['at'];
}

/** The Content Manifest's `packs` from the save's `content` field, if present. */
function readManifest(value: unknown): SaveHeader['content'] | undefined {
  if (typeof value !== 'object' || value === null) {
    return undefined;
  }
  const packs = (value as { packs?: unknown }).packs;
  if (!Array.isArray(packs)) {
    return undefined;
  }
  const out: { id: string; version: string; hash: string }[] = [];
  for (const pack of packs) {
    if (typeof pack !== 'object' || pack === null) {
      return undefined;
    }
    const { id, version, hash } = pack as {
      id?: unknown;
      version?: unknown;
      hash?: unknown;
    };
    if (
      typeof id !== 'string' ||
      typeof version !== 'string' ||
      typeof hash !== 'string'
    ) {
      return undefined;
    }
    out.push({ id, version, hash });
  }
  return { packs: out };
}

/**
 * An in-memory {@link SaveStore} backed by a `Map<name, canonicalJson>` (design,
 * "Facade: saves"). It mirrors the fs store's observable behaviour — list,
 * read, atomic overwrite-by-name — without any filesystem, so the facade's save
 * path can be driven in a test and the save/load properties can round-trip a
 * save without touching disk.
 *
 * - `write(name, json)` stores the string under `name`, overwriting any earlier
 *   save of that name (an in-memory `Map.set` is already atomic, so there is no
 *   temp-and-rename to model). The facade validates the name before calling, so
 *   the store never sees an unsafe name.
 * - `read(name)` returns the save's parsed JSON value, or `{ error: 'missing' }`
 *   when no save of that name exists, or `{ error: 'unreadable' }` when the
 *   stored string is somehow not valid JSON (which an in-memory store never
 *   produces for its own writes, but the marker keeps the contract total).
 * - `list()` returns one entry per stored save, each with its header or
 *   `'corrupt'`, in insertion order.
 */
export class InMemorySaveStore implements SaveStore {
  private readonly saves = new Map<string, string>();

  /** Pre-seed the store with raw save strings (handy for the refusal tests). */
  constructor(initial?: Readonly<Record<string, string>>) {
    if (initial !== undefined) {
      for (const [name, json] of Object.entries(initial)) {
        this.saves.set(name, json);
      }
    }
  }

  list(): readonly { readonly name: string; readonly header: SaveHeader | 'corrupt' }[] {
    const out: { name: string; header: SaveHeader | 'corrupt' }[] = [];
    for (const [name, json] of this.saves) {
      out.push({ name, header: headerOf(json) });
    }
    return out;
  }

  read(name: string): unknown | { readonly error: 'missing' | 'unreadable' } {
    const json = this.saves.get(name);
    if (json === undefined) {
      return { error: 'missing' };
    }
    try {
      return JSON.parse(json);
    } catch {
      return { error: 'unreadable' };
    }
  }

  write(name: string, json: string): void {
    this.saves.set(name, json);
  }
}

/** Parse a stored string and read its header, folding a parse failure to `'corrupt'`. */
function headerOf(json: string): SaveHeader | 'corrupt' {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return 'corrupt';
  }
  return readSaveHeader(value);
}
