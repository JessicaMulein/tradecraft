/**
 * Unit tests for {@link FsSaveStore} (slice-integration task 12.4; design,
 * "Facade: saves" / "fs Save Store"; Requirements 13.2, 13.6, 13.7).
 *
 * These exercise the four behaviours the fs store owns that an in-memory store
 * cannot: the atomic write (a failure injected between the temp write and the
 * rename leaves the previous save intact — Req 13.7), path containment (a name
 * that resolves outside the Saves Directory throws and writes nothing —
 * Req 13.6), corrupt-header listing (a malformed save file lists as `'corrupt'`
 * — Req 13.2), and stale temp cleanup (a leftover `.tmp-*` file is ignored by
 * `list` and swept on the next successful write — Req 13.7).
 *
 * Each test runs against a fresh `os.tmpdir()`-rooted directory created with
 * `mkdtempSync` and removed afterwards, so nothing touches the repo's `saves/`.
 *
 * The atomic-write test needs to fail the `rename` while the earlier steps (the
 * temp write and `fsync`) still really run, so it mocks `node:fs`: every binding
 * is the real one except `renameSync`, which throws while the module-level
 * `failRename` flag is set. All other tests use the real filesystem.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// Mock `node:fs` so `renameSync` can be made to throw on demand, while every
// other call (open/write/fsync/readdir/rename cleanup) runs for real.
let failRename = false;
vi.mock('node:fs', async (importActual) => {
  const actual = await importActual<typeof import('node:fs')>();
  return {
    ...actual,
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (failRename) {
        throw new Error('injected rename failure');
      }
      return actual.renameSync(...args);
    },
  };
});

// Imported after the mock is registered so the store and the test share the
// same (mocked) `node:fs` module instance.
const { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } =
  await import('node:fs');
const { tmpdir } = await import('node:os');
const { join } = await import('node:path');
const { FsSaveStore } = await import('./fs-save-store.js');

const SAVE_SUFFIX = '.save.json';

/** Fresh temp dirs created per test, torn down in `afterEach`. */
const tempRoots: string[] = [];

afterEach(() => {
  failRename = false;
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root !== undefined) {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

/** Make a fresh Saves Directory under the OS temp dir and return its path. */
function freshDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'tc-fs-save-'));
  tempRoots.push(root);
  return root;
}

/** The absolute path of the save file named `name` in `dir`. */
function savePath(dir: string, name: string): string {
  return join(dir, `${name}${SAVE_SUFFIX}`);
}

/** A save value whose header `readSaveHeader` accepts (for the listing test). */
function wellFormedSave(seed: string): string {
  return JSON.stringify({
    seed,
    difficulty: { id: 'standard' },
    savedAt: '2024-01-02T03:04:05.000Z',
    world: { time: { day: 2, phase: 1 } },
    content: { packs: [{ id: 'core', version: '1.0.0', hash: 'abc' }] },
  });
}

describe('FsSaveStore — atomic write (Req 13.7)', () => {
  it('leaves the previous save intact when the rename fails after the temp write', () => {
    const dir = freshDir();
    const store = new FsSaveStore(dir);

    // A first, successful write establishes the live save.
    store.write('slot', '{"version":2,"old":true}');
    expect(JSON.parse(readFileSync(savePath(dir, 'slot'), 'utf8'))).toEqual({
      version: 2,
      old: true,
    });

    // Inject a failure strictly between the temp write and the rename: the temp
    // file is written and fsync'd, then `renameSync` throws.
    failRename = true;
    expect(() => store.write('slot', '{"version":2,"old":false}')).toThrow(
      /injected rename failure/,
    );
    failRename = false;

    // The old save survives unchanged — a reader never sees a half-written save.
    expect(JSON.parse(readFileSync(savePath(dir, 'slot'), 'utf8'))).toEqual({
      version: 2,
      old: true,
    });

    // The temp file the failed write produced was cleaned up, so nothing stale
    // is left behind and `list` still reports exactly the one live save.
    expect(readdirSync(dir)).toEqual([`slot${SAVE_SUFFIX}`]);
    expect(store.list().map((e) => e.name)).toEqual(['slot']);
  });
});

describe('FsSaveStore — path containment (Req 13.6)', () => {
  it('throws for a name that escapes the saves directory and writes nothing', () => {
    const dir = freshDir();
    const store = new FsSaveStore(dir);

    // A name that climbs out of the directory must be rejected before any file
    // is created, even though the facade would normally reject it first.
    expect(() => store.write('../escape', '{"x":1}')).toThrow(
      /escapes the saves directory/,
    );

    // Nothing was written: not the escaping target, not a temp file, not even
    // the directory contents changed.
    expect(existsSync(join(dir, '..', `escape${SAVE_SUFFIX}`))).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('throws for a name that resolves into a subdirectory', () => {
    const dir = freshDir();
    const store = new FsSaveStore(dir);

    expect(() => store.write('nested/slot', '{"x":1}')).toThrow(
      /escapes the saves directory/,
    );
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('FsSaveStore — corrupt-header listing (Req 13.2)', () => {
  it('lists a malformed save file as corrupt', () => {
    const dir = freshDir();
    const store = new FsSaveStore(dir);

    // A well-formed save alongside a malformed one.
    store.write('good', wellFormedSave('alpha'));
    // Not valid JSON at all: must fold to the 'corrupt' marker, not throw.
    writeFileSync(savePath(dir, 'broken'), 'this is not json', 'utf8');

    const byName = new Map(store.list().map((e) => [e.name, e.header]));

    expect(byName.get('broken')).toBe('corrupt');
    // The good save still reads a real header beside the corrupt one.
    const good = byName.get('good');
    expect(good).not.toBe('corrupt');
    expect(good).toMatchObject({ seed: 'alpha', difficulty: 'standard' });
  });
});

describe('FsSaveStore — stale temp cleanup (Req 13.7)', () => {
  it('ignores a leftover temp file in list and removes it on the next write', () => {
    const dir = freshDir();
    const store = new FsSaveStore(dir);

    store.write('slot', '{"version":2,"n":1}');

    // Simulate an interrupted earlier write: a half-written temp file left on
    // disk with the store's `<name>.save.json.tmp-*` shape.
    const staleTemp = join(dir, `slot${SAVE_SUFFIX}.tmp-999-0`);
    writeFileSync(staleTemp, 'partial bytes', 'utf8');
    expect(existsSync(staleTemp)).toBe(true);

    // `list` must not treat the temp file as a save — only the real save shows.
    expect(store.list().map((e) => e.name)).toEqual(['slot']);

    // The next successful write of that name sweeps the stale temp away.
    store.write('slot', '{"version":2,"n":2}');
    expect(existsSync(staleTemp)).toBe(false);
    expect(readdirSync(dir)).toEqual([`slot${SAVE_SUFFIX}`]);
    expect(JSON.parse(readFileSync(savePath(dir, 'slot'), 'utf8'))).toEqual({
      version: 2,
      n: 2,
    });
  });
});
