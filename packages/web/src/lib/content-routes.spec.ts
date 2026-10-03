import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './test-support/harness.js';

let h: Harness | undefined;
afterEach(async () => { await h?.close(); h = undefined; });

const CUE_MAP = {
  version: 1,
  cues: { exploration: { kind: 'music', file: 'City' }, ghost: { kind: 'music', file: 'Ghost' } },
  rules: [{ name: 'city', when: { screen: 'city' }, music: 'exploration' }],
};

function fixture(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tc-web-'));
  mkdirSync(join(dir, 'soundtrack'));
  writeFileSync(join(dir, 'soundtrack', 'City.mp3'), Buffer.alloc(1000, 1));
  writeFileSync(join(dir, 'soundtrack', 'secret.txt'), 'nope');
  writeFileSync(join(dir, 'box_art.jpeg'), Buffer.from([0xff, 0xd8, 0xff]));
  return dir;
}

describe('content routes', () => {
  it('serves allow-listed audio with ranges, refuses everything else, requires auth', async () => {
    const baseDir = fixture();
    h = await startHarness({}, { baseDir, cueMap: CUE_MAP });
    expect((await h.request({ path: '/audio/City.mp3', auth: false })).status).toBe(401);
    const full = await h.request({ path: '/audio/City.mp3' });
    expect(full.status).toBe(200);
    expect(full.headers['accept-ranges']).toBe('bytes');
    const part = await h.request({ path: '/audio/City.mp3', headers: { Range: 'bytes=0-9' } });
    expect(part.status).toBe(206);
    expect((await h.request({ path: '/audio/secret.txt' })).status).toBe(404);
    expect((await h.request({ path: '/audio/..%2F..%2Fpackage.json' })).status).toBe(404);
  });

  it('reports cues with no audio in the cue map response', async () => {
    h = await startHarness({}, { baseDir: fixture(), cueMap: CUE_MAP });
    const body = (await h.request({ path: '/api/cue-map' })).json() as { manifest: { missing: string[] } };
    expect(body.manifest.missing).toEqual(['ghost']);
  });

  it('serves the page, stylesheet and box art', async () => {
    h = await startHarness({}, { baseDir: fixture() });
    const page = await h.request({ path: '/' });
    expect(page.status).toBe(200);
    expect(page.text).toContain('/static/js/client/main.js');
    expect(page.text).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/);
    expect(page.text).not.toMatch(/\sstyle=|\sonclick=/);
    expect((await h.request({ path: '/static/app.css' })).status).toBe(200);
    expect((await h.request({ path: '/art/box-wide.jpg' })).status).toBe(200);
    expect((await h.request({ path: '/art/other.jpg' })).status).toBe(404);
  });
});
