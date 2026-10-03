/**
 * The filesystem {@link SaveStore} (slice-integration task 12.3; design,
 * "Facade: saves"; Requirements 13.1, 13.6, 13.7).
 *
 * The facade's `saves` surface in `player-view` is defined against the injected
 * {@link SaveStore} seam so player-view stays I/O-free. This is the live
 * implementation that persists each save to the Saves Directory (`saves/` at the
 * repo root), reading, listing and writing real files. Tests and the
 * Composition Root's in-memory wiring drive `InMemorySaveStore` instead; this
 * module is the one place a save actually touches disk.
 *
 * ## Layout
 *
 * Each save is `<dir>/<name>.save.json`, where `<dir>` defaults to `saves/`
 * relative to the process working directory. The facade validates `name`
 * against `SAVE_NAME` before any call, so the store never sees a path-unsafe
 * name; as belt-and-braces it also checks that the resolved path lies inside the
 * directory (Req 13.6), so even a name that somehow slipped the facade's check
 * can never read or write outside the Saves Directory.
 *
 * ## Atomic write (Req 13.7)
 *
 * `write` never truncates the live save in place. It writes the bytes to a
 * per-process temp file (`<name>.save.json.tmp-<pid>-<n>`), `fsync`s the file so
 * the bytes reach disk, then `rename`s it over the target — an atomic swap on a
 * POSIX filesystem. If the process dies between the temp write and the rename,
 * the old save is still intact and the half-written temp file is left behind.
 * Those stale temp files are ignored by {@link FsSaveStore.list} and removed on
 * the next successful write of that name, so they never accumulate or get listed
 * as saves.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { readSaveHeader, type SaveHeader, type SaveStore } from '@tradecraft/player-view';

/** The suffix every save file carries (design: `saves/<name>.save.json`). */
const SAVE_SUFFIX = '.save.json';

/** The default Saves Directory, relative to the process working directory. */
export const DEFAULT_SAVES_DIR = 'saves';

/**
 * A {@link SaveStore} backed by the filesystem (design, "Facade: saves"). It
 * keeps one `<name>.save.json` file per save in the Saves Directory and performs
 * every read, list and (atomic) write there.
 */
export class FsSaveStore implements SaveStore {
  /** The absolute Saves Directory every path is resolved against. */
  private readonly dir: string;

  /** A per-store counter making each temp file name unique within the process. */
  private tempSeq = 0;

  /**
   * @param dir the Saves Directory (default `saves/`, resolved against the
   *   process working directory). Resolved to an absolute path once so the
   *   containment check below is a straightforward prefix test.
   */
  constructor(dir: string = DEFAULT_SAVES_DIR) {
    this.dir = resolve(dir);
  }

  /**
   * List one entry per `<name>.save.json` file in the Saves Directory, each with
   * its cheaply-read {@link SaveHeader} or the marker `'corrupt'` for a file
   * whose header could not be read (design, "Facade: saves": `list()`). Stale
   * `.tmp-*` temp files from an interrupted write are skipped — only files that
   * end in `.save.json` are candidate saves (Req 13.7). A missing directory
   * lists as empty.
   */
  list(): readonly { readonly name: string; readonly header: SaveHeader | 'corrupt' }[] {
    if (!existsSync(this.dir)) {
      return [];
    }
    const out: { name: string; header: SaveHeader | 'corrupt' }[] = [];
    for (const entry of readdirSync(this.dir)) {
      if (!entry.endsWith(SAVE_SUFFIX)) {
        // Skips stale `<name>.save.json.tmp-<pid>-<n>` files and anything else
        // that is not a save (Req 13.7): a temp file ends in `.tmp-…`, not
        // `.save.json`.
        continue;
      }
      const name = entry.slice(0, -SAVE_SUFFIX.length);
      out.push({ name, header: this.headerOf(entry) });
    }
    return out;
  }

  /**
   * Return the parsed JSON value of the save named `name`, or an error marker:
   * `'missing'` when no such file exists, `'unreadable'` when it exists but
   * cannot be read or parsed as JSON (design, "Facade: saves": `read(name)`).
   * The facade validates the returned value with `parseAndLoad`.
   */
  read(name: string): unknown | { readonly error: 'missing' | 'unreadable' } {
    const path = this.pathFor(name);
    if (!existsSync(path)) {
      return { error: 'missing' };
    }
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      return { error: 'unreadable' };
    }
    try {
      return JSON.parse(text);
    } catch {
      return { error: 'unreadable' };
    }
  }

  /**
   * Write `json` as the save named `name`, atomically (design, "Facade: saves":
   * `write`; Req 13.7). It writes the bytes to a per-process temp file,
   * `fsync`s them to disk, then `rename`s the temp file over the target — so a
   * reader never sees a half-written save, and an interrupted write leaves the
   * previous save intact. Before writing, any stale temp files left by an
   * earlier interrupted write of this name are removed (Req 13.7).
   *
   * The facade only ever passes a name that matched `SAVE_NAME`; `pathFor` adds
   * the containment check so an escaping path throws before any file is touched.
   */
  write(name: string, json: string): void {
    const target = this.pathFor(name);
    mkdirSync(this.dir, { recursive: true });
    this.removeStaleTemps(name);

    const temp = join(this.dir, `${name}${SAVE_SUFFIX}.tmp-${process.pid}-${this.tempSeq++}`);
    const fd = openSync(temp, 'w');
    try {
      writeSync(fd, json);
      // Flush the bytes to disk before the rename so the renamed file is
      // complete even across a crash (Req 13.7).
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    try {
      renameSync(temp, target);
    } catch (err) {
      // The rename failed; drop the temp file so it is not left as a stale
      // artefact, then surface the failure to the caller.
      try {
        unlinkSync(temp);
      } catch {
        // Best effort — the next write of this name sweeps it anyway.
      }
      throw err;
    }
  }

  /** Read a save file's header, folding any read/parse failure to `'corrupt'`. */
  private headerOf(entry: string): SaveHeader | 'corrupt' {
    let value: unknown;
    try {
      value = JSON.parse(readFileSync(join(this.dir, entry), 'utf8'));
    } catch {
      return 'corrupt';
    }
    return readSaveHeader(value);
  }

  /**
   * Remove any stale `<name>.save.json.tmp-*` temp files from an earlier
   * interrupted write of this name (Req 13.7). Called before each write so a
   * crashed temp file never accumulates; best-effort, since a temp file that
   * cannot be removed is harmless (it is already ignored by `list`).
   */
  private removeStaleTemps(name: string): void {
    if (!existsSync(this.dir)) {
      return;
    }
    const prefix = `${name}${SAVE_SUFFIX}.tmp-`;
    for (const entry of readdirSync(this.dir)) {
      if (entry.startsWith(prefix)) {
        try {
          rmSync(join(this.dir, entry));
        } catch {
          // Ignore — a leftover temp file is never listed or read as a save.
        }
      }
    }
  }

  /**
   * The absolute path of the save named `name`, after checking the resolved path
   * lies directly inside the Saves Directory (Req 13.6). A name whose resolved
   * path escapes the directory — or that resolves into a subdirectory — throws,
   * so even a name that bypassed the facade's `SAVE_NAME` check can never read or
   * write outside `saves/`.
   */
  private pathFor(name: string): string {
    const path = resolve(this.dir, `${name}${SAVE_SUFFIX}`);
    if (dirname(path) !== this.dir || basename(path) !== `${name}${SAVE_SUFFIX}`) {
      throw new Error(`save name escapes the saves directory: ${name}`);
    }
    return path;
  }
}
