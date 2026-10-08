import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CIPHER_KINDS, TRACE_CHANNEL_KINDS, loadContent, type PlotTemplateV2 } from '../index.js';

const PACKS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'packs');

describe('coldwar-plots library pack', () => {
  const result = loadContent(
    [join(PACKS, 'core'), join(PACKS, 'coldwar-plots')],
    ['core', 'coldwar-plots'],
  );

  it('loads with the core pack', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) {
      expect(result.errors).toEqual([]);
    }
  });

  it('meets the catalogue counts', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const plots = [...(result.value.plotTemplatesV2?.values() ?? [])];
    const threads = [...(result.value.sideThreadTemplatesV2?.values() ?? [])];
    const stories = plots.filter((plot) => !plot.subOnly);
    expect(stories.length).toBeGreaterThanOrEqual(16);
    expect(plots.filter((plot) => plot.subOnly).length).toBeGreaterThanOrEqual(4);
    expect(threads.length).toBeGreaterThanOrEqual(24);
    const archetypes = new Set(stories.map((plot) => plot.archetype));
    for (const name of [
      'defector-abduction',
      'sabotage',
      'assassination',
      'materiel-smuggling',
      'people-smuggling',
      'scientist-recruitment',
      'kompromat',
      'document-theft',
      'dangle',
      'mole-hunt',
      'currency-forgery',
      'border-network',
    ]) {
      expect(archetypes.has(name)).toBe(true);
    }
    const runtime = stories.filter((plot) =>
      plot.stages.some((entry) => 'branch' in entry && entry.resolve === 'runtime'),
    );
    expect(runtime.length).toBeGreaterThanOrEqual(4);
    expect(stories.filter((plot) => plot.cells.length > 1).length).toBeGreaterThanOrEqual(3);
    expect(stories.filter((plot) => plot.stages.some((entry) => 'subplot' in entry)).length).toBeGreaterThanOrEqual(3);
    const twists = stories.flatMap((plot) => (plot.twist === undefined ? [] : [plot.twist.kind]));
    expect(new Set(twists).size).toBe(3);
    expect(twists.length).toBeGreaterThanOrEqual(4);
    expect(threads.filter((thread) => thread.mimics !== undefined).length).toBeGreaterThanOrEqual(8);
    expect(threads.filter((thread) => thread.spawn?.includes('midgame')).length).toBeGreaterThanOrEqual(10);
    const lookalikeArchetypes = new Set(
      threads.flatMap((thread) => (thread.mimics === undefined ? [] : [thread.mimics])),
    );
    expect(lookalikeArchetypes.size).toBeGreaterThanOrEqual(6);
    expect(stories.filter((plot) => canBeSecondary(plot, stories)).length).toBeGreaterThanOrEqual(6);
  });

  it('uses only the slice channel and cipher kinds', () => {
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const channels = new Set<string>();
    for (const template of [
      ...(result.value.plotTemplatesV2?.values() ?? []),
      ...(result.value.sideThreadTemplatesV2?.values() ?? []),
    ]) {
      collectChannels(template, channels);
    }
    for (const channel of channels) {
      expect(TRACE_CHANNEL_KINDS).toContain(channel);
    }
    const packDir = join(PACKS, 'coldwar-plots');
    const allowedChannels = new Set<string>([...TRACE_CHANNEL_KINDS, 'dead-drop']);
    const allowedCiphers = new Set<string>(CIPHER_KINDS);
    for (const file of yamlFiles(packDir)) {
      const text = readFileSync(file, 'utf8');
      for (const match of text.matchAll(/^\s*channel:\s*([A-Za-z0-9-]+)/gm)) {
        expect(allowedChannels.has(match[1] ?? '')).toBe(true);
      }
      for (const match of text.matchAll(/^\s*cipher(?:Kind)?:\s*([A-Za-z0-9-]+)/gm)) {
        expect(allowedCiphers.has(match[1] ?? '')).toBe(true);
      }
      expect(text).not.toMatch(/\b(enigma|internet|email|smartphone|satellite|rsa|aes|pager)\b/i);
    }
  });
});

/** A story can sit beside another as a Secondary when each allows the other's tags. */
function canBeSecondary(plot: PlotTemplateV2, stories: readonly PlotTemplateV2[]): boolean {
  if (plot.subOnly || plot.concurrency.tags.length === 0) {
    return false;
  }
  return stories.some(
    (other) =>
      other.id !== plot.id &&
      !other.subOnly &&
      plot.concurrency.tags.every((tag) => other.concurrency.allowWith.includes(tag)) &&
      other.concurrency.tags.every((tag) => plot.concurrency.allowWith.includes(tag)),
  );
}

function collectChannels(value: unknown, found: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectChannels(item, found);
    }
    return;
  }
  if (value === null || typeof value !== 'object') {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === 'channel' && typeof child === 'string') {
      found.add(child);
      continue;
    }
    collectChannels(child, found);
  }
}

function yamlFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...yamlFiles(path));
    } else if (entry.name.endsWith('.yaml')) {
      found.push(path);
    }
  }
  return found;
}
