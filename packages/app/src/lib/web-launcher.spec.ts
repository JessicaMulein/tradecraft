/**
 * Offline tests for `runWebLauncher` and the shipped soundtrack files. The Model
 * Manager is replaced by a fake that resolves at once, the shell server starts
 * on a real loopback port and is stopped through the injected `waitForStop`.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parse } from 'yaml';
import { buildManifest, decide, parseCueMap, parseTakeMeta } from '@tradecraft/web';
import { describe, expect, it } from 'vitest';

import { runWebLauncher, type WebLauncherIo } from './web-launcher.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function io(overrides: Partial<WebLauncherIo> = {}): { io: WebLauncherIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const base: WebLauncherIo = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    readFile: (p) => readFileSync(p, 'utf8'),
    repoRoot: REPO_ROOT,
    connect: () => Promise.reject(new Error('unused')),
    startServer: () => Promise.resolve(),
    startModelManager: () => Promise.resolve({ load: { warnings: [] } } as never),
    waitForStop: () => Promise.resolve(),
    ...overrides,
  };
  return { io: base, out, err };
}

describe('runWebLauncher', () => {
  it('prints the launch URL once, binds loopback only, and exits 0 on stop', async () => {
    const h = io();
    const status = await runWebLauncher([], h.io);
    expect(status).toBe(0);
    const urls = h.out.filter((l) => l.startsWith('http://'));
    expect(urls).toHaveLength(1);
    expect(urls[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/launch\?token=[A-Za-z0-9_-]{40,}$/);
    expect(h.err.join('\n')).not.toContain(urls[0]);
  });

  it('opens the browser only through the injected opener, with the launch URL', async () => {
    const opened: string[] = [];
    const h = io({ openBrowser: (u) => opened.push(u) });
    await runWebLauncher([], h.io);
    expect(opened).toEqual(h.out.filter((l) => l.startsWith('http://')));
  });

  it('refuses a host option in config/web.yaml', async () => {
    const h = io({
      readFile: (p) => (p.endsWith('web.yaml') ? 'host: 0.0.0.0\n' : readFileSync(p, 'utf8')),
    });
    expect(await runWebLauncher([], h.io)).toBe(1);
    expect(h.err.join('\n')).toMatch(/host/);
  });
});

describe('shipped soundtrack files', () => {
  const dir = resolve(REPO_ROOT, 'soundtrack');
  const map = parseCueMap(parse(readFileSync(resolve(dir, 'cue-map.yaml'), 'utf8')));
  const meta = parseTakeMeta(parse(readFileSync(resolve(dir, 'take-meta.yaml'), 'utf8')));

  it('validates, and every named cue has audio on disk', async () => {
    const { manifest } = await buildManifest(dir, map, ['mp3'], meta);
    expect(manifest.missing).toEqual([]);
  });

  it('drives the situational cues from what the player sees', async () => {
    const { manifest } = await buildManifest(dir, map, ['mp3'], meta);
    const base = { screen: 'city' as const, locationTags: ['sector:american'], phase: 'morning', factKinds: [] as string[], alerts: [], dialogueStreaming: false, minutesInState: 0 };
    const start = { cue: undefined, spent: [] as number[] };
    const cue = (inputs: Partial<typeof base> & Record<string, unknown>, prev = start) => decide(map, manifest, prev, { ...base, ...inputs } as never);

    expect(cue({}).next.cue).toBe('exploration');
    expect(cue({ screen: 'workbench' }).next.cue).toBe('workbench');
    expect(cue({ screen: 'intercept' }).next.cue).toBe('numbers');
    expect(cue({ lastActionKind: 'confront' }).next.cue).toBe('interrogation');

    // Crossing into the Soviet sector: checkpoint, held, then the sector track.
    const crossed = { lastActionKind: 'travel', locationTags: ['sector:soviet'], factKinds: ['sector-crossed'] };
    const a = cue(crossed);
    expect(a.next.cue).toBe('checkpoint');
    expect(cue({ ...crossed, minutesInState: 0.2 }, a.next).next.cue).toBe('checkpoint');
    expect(cue({ ...crossed, minutesInState: 0.5 }, a.next).next.cue).toBe('soviet');

    // Tailing someone: pursuit, held, then back to the area track.
    const p = cue({ lastActionKind: 'follow' });
    expect(p.next.cue).toBe('pursuit');
    expect(cue({ lastActionKind: 'follow', minutesInState: 2 }, p.next).next.cue).toBe('exploration');
  });
});
