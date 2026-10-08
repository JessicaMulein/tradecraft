/**
 * Campaign save: archive files first, then an fsynced rename of campaign.json.
 * A failure at any step leaves the previous save loadable.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ContentManifest } from '@tradecraft/content';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import { step } from './reducer.js';
import {
  loadCampaign,
  migrate,
  migrations,
  nodeSaveIo,
  saveCampaign,
  type CampaignMigration,
  type CampaignSaveIo,
  type SaveCampaignInput,
} from './save.js';
import type { CampaignChoice, CampaignState } from './state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = join(ROOT, 'packages', 'content', 'packs', 'core');

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const content = campaignContent(loaded.value, campaignSources([CORE], new Set(['core'])).sources);

function created(): CampaignState {
  const choice: Extract<CampaignChoice, { kind: 'create' }> = {
    kind: 'create',
    seed: 'career-seed',
    preset: 'standard',
    officerName: 'Ada',
    background: 'analyst',
    startYear: 1948,
  };
  const result = step(undefined, { kind: 'choice', choice }, content);
  if (!result.ok) {
    throw new Error(result.error.kind);
  }
  return result.value;
}

const state = created();
const manifest = state.manifests[0];
if (manifest === undefined) {
  throw new Error('missing manifest');
}

const dirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'campaign-save-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function postingInput(saved: CampaignState, postingManifest: ContentManifest): SaveCampaignInput {
  return {
    state: saved,
    savedAt: '2026-01-01T00:00:00.000Z',
    postings: [
      {
        index: 0,
        result: { schema: 1, index: 0, outcome: 'success' },
        actions: '{"kind":"wait"}\n',
        recording: '{"seq":1}\n',
      },
    ],
    currentPosting: { version: 3, seed: saved.seed, content: postingManifest },
  };
}

function countSteps(input: SaveCampaignInput): number {
  let n = 0;
  saveCampaign(
    trap(nodeSaveIo(scratch()), () => {
      n += 1;
    }),
    input,
  );
  return n;
}

function failAt(io: CampaignSaveIo, at: number): CampaignSaveIo {
  let n = 0;
  return trap(io, (label) => {
    if (n === at) {
      throw new Error(`injected ${label}`);
    }
    n += 1;
  });
}

function trap(io: CampaignSaveIo, before: (label: string) => void): CampaignSaveIo {
  return {
    write(path, data) {
      before(`write ${path}`);
      io.write(path, data);
    },
    fsync(path) {
      before(`fsync ${path}`);
      io.fsync(path);
    },
    read: (path) => io.read(path),
    exists: (path) => io.exists(path),
    commit(ops) {
      before('commit');
      io.commit(ops);
    },
  };
}

describe('campaign save', () => {
  it('round-trips the state and resumes a posting whose manifest matches', () => {
    const io = nodeSaveIo(scratch());
    const saved = saveCampaign(io, postingInput(state, manifest));
    expect(saved.version).toBe(1);
    expect(saved.files.map((file) => file.path)).toEqual([
      'current-posting.json',
      'postings/0/actions.jsonl',
      'postings/0/recording.jsonl',
      'postings/0/result.json',
    ]);
    const loaded = loadCampaign(io, manifest);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(JSON.stringify(loaded.value.state)).toBe(JSON.stringify(state));
    expect(loaded.value.state.rng).toEqual(state.rng);
    expect(loaded.value.currentPosting).toEqual({ version: 3, seed: state.seed, content: manifest });
    expect(loaded.value.postingRefusal).toBeUndefined();
    expect(io.read('postings/0/actions.jsonl')).toBe('{"kind":"wait"}\n');
  });

  it('refuses a bad hash, an unreadable save, and a newer version', () => {
    const io = nodeSaveIo(scratch());
    saveCampaign(io, postingInput(state, manifest));
    io.write('postings/0/result.json', '{"tampered":true}\n');
    const hashed = loadCampaign(io, manifest);
    expect(hashed.ok).toBe(false);
    if (!hashed.ok) {
      expect(hashed.error).toEqual({ kind: 'hash-mismatch', file: 'postings/0/result.json' });
    }

    const missing = loadCampaign(nodeSaveIo(scratch()));
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error).toEqual({ kind: 'unreadable', file: 'campaign.json' });
    }

    const versioned = nodeSaveIo(scratch());
    saveCampaign(versioned, { state, savedAt: '2026-01-01T00:00:00.000Z' });
    const document = JSON.parse(versioned.read('campaign.json')) as { version: number };
    document.version = 2;
    versioned.write('campaign.json', `${JSON.stringify(document)}\n`);
    const future = loadCampaign(versioned);
    expect(future.ok).toBe(false);
    if (!future.ok) {
      expect(future.error).toEqual({ kind: 'campaign-version', saved: 2, supported: 1 });
    }
  });

  it('restores the campaign and refuses to resume a posting with a different manifest', () => {
    const io = nodeSaveIo(scratch());
    saveCampaign(io, postingInput(state, manifest));
    const loadedPack = manifest.packs[0];
    if (loadedPack === undefined) {
      throw new Error('missing pack');
    }
    const different: ContentManifest = {
      ...manifest,
      packs: [{ ...loadedPack, version: '9.9.9', hash: 'deadbeef' }],
    };
    const loaded = loadCampaign(io, different);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) {
      return;
    }
    expect(JSON.stringify(loaded.value.state)).toBe(JSON.stringify(state));
    expect(loaded.value.currentPosting).toBeUndefined();
    expect(loaded.value.postingRefusal).toEqual({
      kind: 'manifest-mismatch',
      differing: [{ id: loadedPack.id, saved: loadedPack.version, loaded: '9.9.9' }],
    });
  });

  it('leaves the previous save loadable when any write step fails', () => {
    const next = { ...state, calendar: { year: state.calendar.year + 1 } };
    const first = postingInput(state, manifest);
    const again: SaveCampaignInput = {
      ...postingInput(next, manifest),
      postings: [
        ...(first.postings ?? []),
        { index: 1, result: { schema: 1, index: 1 }, actions: '', recording: '' },
      ],
    };
    const steps = countSteps(again);
    expect(steps).toBeGreaterThan(3);
    for (let at = 0; at < steps; at += 1) {
      const io = nodeSaveIo(scratch());
      saveCampaign(io, { state, savedAt: '2026-01-01T00:00:00.000Z' });
      const before = io.read('campaign.json');
      let thrown = false;
      try {
        saveCampaign(failAt(io, at), again);
      } catch (error) {
        thrown = error instanceof Error && error.message.startsWith('injected ');
      }
      expect(thrown).toBe(true);
      expect(io.read('campaign.json')).toBe(before);
      const loaded = loadCampaign(io);
      expect(loaded.ok).toBe(true);
      if (loaded.ok) {
        expect(JSON.stringify(loaded.value.state)).toBe(JSON.stringify(state));
      }
    }
  });

  it('keeps a hashed archive file when a replacement is not committed', () => {
    const io = nodeSaveIo(scratch());
    const first = postingInput(state, manifest);
    saveCampaign(io, first);
    const before = io.read('postings/0/result.json');
    const changed: SaveCampaignInput = {
      ...first,
      savedAt: '2026-02-01T00:00:00.000Z',
      postings: [
        {
          index: 0,
          result: { schema: 1, index: 0, outcome: 'failure' },
          actions: '{"kind":"wait"}\n',
          recording: '{"seq":1}\n',
        },
      ],
    };
    expect(() =>
      saveCampaign(
        trap(io, (op) => {
          if (op === 'commit') {
            throw new Error('injected commit');
          }
        }),
        changed,
      ),
    ).toThrow(/injected commit/);
    expect(io.read('postings/0/result.json')).toBe(before);
    const loaded = loadCampaign(io);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.value.savedAt).toBe('2026-01-01T00:00:00.000Z');
    }
  });
});

describe('migration runner', () => {
  const save = {
    version: 1,
    savedAt: '2026-01-01T00:00:00.000Z',
    state: { seed: 'career-seed' },
    files: [] as { path: string; sha256: string }[],
    n: 5,
  };

  function shape(version: 1 | 2 | 3) {
    return z.looseObject({
      version: z.literal(version),
      savedAt: z.string(),
      state: z.looseObject({}),
      files: z.array(z.looseObject({ path: z.string(), sha256: z.string() })),
      n: z.number(),
    });
  }

  function chain(): Record<number, CampaignMigration> {
    return {
      1: {
        from: shape(1),
        to: shape(2),
        up: (document) => ({ ...(document as typeof save), version: 2, n: (document as typeof save).n + 1 }),
      },
      2: {
        from: shape(2),
        to: shape(3),
        up: (document) => ({ ...(document as typeof save), version: 3, n: (document as typeof save).n + 10 }),
      },
    };
  }

  it('ships an empty table and leaves a current save unchanged', () => {
    expect(migrations).toEqual({});
    const current = migrate(save);
    expect(current.ok).toBe(true);
    if (!current.ok) {
      return;
    }
    expect(current.value).toEqual(save);
    const edited = current.value as { state: { seed: string } };
    edited.state.seed = 'changed';
    expect(save.state.seed).toBe('career-seed');
  });

  it('applies each synthetic step in order', () => {
    const migrated = migrate(save, 3, chain());
    expect(migrated.ok).toBe(true);
    if (migrated.ok) {
      expect(migrated.value).toEqual({ ...save, version: 3, n: 16 });
    }
    expect(save.n).toBe(5);
    const already = { ...save, version: 2, n: 4 };
    const same = migrate(already, 2, chain());
    expect(same.ok).toBe(true);
    if (same.ok) {
      expect(same.value).toEqual(already);
    }
  });

  it('refuses a newer version and a step that fails validation', () => {
    const future = migrate({ ...save, version: 2 });
    expect(future.ok).toBe(false);
    if (!future.ok) {
      expect(future.error).toEqual({ kind: 'campaign-version', saved: 2, supported: 1 });
    }

    let upgraded = false;
    const missingField: Record<number, CampaignMigration> = {
      1: {
        from: shape(1).extend({ marker: z.literal('needed') }),
        to: shape(2),
        up: (document) => {
          upgraded = true;
          return { ...(document as typeof save), version: 2 };
        },
      },
    };
    const rejected = migrate(save, 2, missingField);
    expect(upgraded).toBe(false);
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) {
      expect(rejected.error).toEqual({ kind: 'migration-failed', from: 1, issues: ['marker'] });
    }
    expect(save.version).toBe(1);

    const badResult: Record<number, CampaignMigration> = {
      1: {
        from: shape(1),
        to: shape(2).extend({ tag: z.literal('ready') }),
        up: (document) => ({ ...(document as typeof save), version: 2 }),
      },
    };
    const invalid = migrate(save, 2, badResult);
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.error).toEqual({ kind: 'migration-failed', from: 1, issues: ['tag'] });
    }

    const stuck: Record<number, CampaignMigration> = {
      1: {
        from: shape(1),
        to: z.looseObject({ version: z.number() }),
        up: (document) => document,
      },
    };
    const unmoved = migrate(save, 2, stuck);
    expect(unmoved.ok).toBe(false);
    if (!unmoved.ok) {
      expect(unmoved.error).toEqual({ kind: 'migration-failed', from: 1, issues: ['version'] });
    }
  });

  it('refuses an older save the empty table cannot reach and does not rewrite it', () => {
    const io = nodeSaveIo(scratch());
    saveCampaign(io, { state, savedAt: '2026-01-01T00:00:00.000Z' });
    const document = JSON.parse(io.read('campaign.json')) as { version: number };
    document.version = 0;
    io.write('campaign.json', `${JSON.stringify(document)}\n`);
    const before = io.read('campaign.json');
    const game = state;
    const loaded = loadCampaign(io);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) {
      expect(loaded.error).toEqual({ kind: 'migration-failed', from: 0, issues: ['missing migration'] });
    }
    expect(io.read('campaign.json')).toBe(before);
    expect(game).toBe(state);
  });
});
