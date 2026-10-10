/**
 * Street-ops content kinds (task 2.1).
 *
 * The kinds register on an extension pack, a built graph without a source list
 * is refused, and cross-references name the pack, file and path.
 */

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { stringify as toYaml } from 'yaml';

import { loadContent } from '@tradecraft/content';

import { checkStreetOpsContent } from './check.js';
import {
  STREET_OPS_KINDS,
  StreetGraphSchema,
  TailProfileSchema,
  streetOpsJsonSchema,
} from './content.js';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const TRAFFIC = { morning: 1, afternoon: 2, evening: 2, night: 0 };

function graph(extra: Record<string, unknown> = {}) {
  return {
    id: 'inner',
    city: 'vienna',
    junctions: [
      { id: 'north', x: 0, y: 0 },
      { id: 'south', x: 0, y: 100 },
    ],
    segments: [
      {
        id: 'spine',
        street: 'Ring',
        from: 'north',
        to: 'south',
        lengthM: 100,
        speed: 'normal',
        oneWay: true,
        lanes: 2,
        traffic: TRAFFIC,
        features: ['tram'],
      },
    ],
    frontages: [{ location: 'cafe', segment: 'spine', at: 0.5, side: 'right' }],
    checkpoints: [{ id: 'sector', kind: 'sector-line', segment: 'spine', at: 0.8 }],
    ...extra,
  };
}

describe('street-ops kinds', () => {
  it('registers the extension kinds with field declarations', () => {
    expect(STREET_OPS_KINDS.map((item) => item.kind)).toEqual([
      'street-graph',
      'vehicle',
      'evasion-maneuver',
      'tail-profile',
      'surveillance-method',
      'checkpoint-kind',
      'street-story',
      'composure-table',
      'map-document',
    ]);
    for (const item of STREET_OPS_KINDS) {
      expect(item.owner).toBe('@tradecraft/engine');
      expect(item.roles).toEqual(['extension']);
      expect(item.cityScoped).toBe(false);
      expect(streetOpsJsonSchema(item.kind)).toBeTypeOf('object');
    }
    const tails = STREET_OPS_KINDS.find((item) => item.kind === 'tail-profile');
    expect(tails?.fields.refs).toEqual([
      { path: 'items[].service', kind: 'service' },
      { path: 'items[].methods[]', kind: 'surveillance-method' },
    ]);
    expect(() => streetOpsJsonSchema('city')).toThrow(/no street-ops kind/);
  });

  it('refuses a built graph that has no source list', () => {
    expect(StreetGraphSchema.safeParse(graph()).success).toBe(true);
    const built = StreetGraphSchema.safeParse(graph({ origin: 'built', sources: [] }));
    expect(built.success).toBe(false);
    const sourced = StreetGraphSchema.safeParse(
      graph({
        origin: 'built',
        sources: [
          {
            name: 'example',
            licence: 'CC-BY-4.0',
            attribution: 'Example contributors',
            retrieved: '2026-10-01',
          },
        ],
      }),
    );
    expect(sourced.success).toBe(true);
  });

  it('names a dangling service, checkpoint kind and graph feature', () => {
    const triangle = {
      id: 'inner',
      city: 'vienna',
      junctions: [
        { id: 'a', x: 0, y: 0 },
        { id: 'b', x: 1, y: 0 },
        { id: 'c', x: 0, y: 1 },
      ],
      segments: [
        {
          id: 'ab',
          street: 'North',
          from: 'a',
          to: 'b',
          lengthM: 40,
          speed: 'normal',
          oneWay: false,
          lanes: 2,
          traffic: TRAFFIC,
        },
        {
          id: 'bc',
          street: 'East',
          from: 'b',
          to: 'c',
          lengthM: 40,
          speed: 'normal',
          oneWay: false,
          lanes: 2,
          traffic: TRAFFIC,
        },
        {
          id: 'ca',
          street: 'West',
          from: 'c',
          to: 'a',
          lengthM: 40,
          speed: 'normal',
          oneWay: false,
          lanes: 2,
          traffic: TRAFFIC,
        },
      ],
      checkpoints: [{ id: 'sector', kind: 'missing-kind', segment: 'ab', at: 0.2 }],
    };
    const errors = checkStreetOpsContent(
      [
        {
          pack: 'street-ops-fixture',
          file: 'graphs/inner.yaml',
          kind: 'street-graph',
          items: [triangle],
        },
        {
          pack: 'street-ops-fixture',
          file: 'maneuvers/tram.yaml',
          kind: 'evasion-maneuver',
          items: [
            {
              id: 'cut-tram',
              era: { from: 1945, to: 1960 },
              requires: ['tram'],
              quality: 0.6,
              ticks: 4,
              suspicion: 0.2,
            },
          ],
        },
        {
          pack: 'street-ops-fixture',
          file: 'tails/watch.yaml',
          kind: 'tail-profile',
          items: [{ id: 'watch', service: 'missing-service', discipline: 0.5, team: 2, methods: [] }],
        },
      ],
      new Set(['street-ops-fixture/station']),
    );
    expect(errors.map((error) => `${error.file} ${error.path}`)).toEqual([
      'graphs/inner.yaml [0].checkpoints[0].kind',
      'maneuvers/tram.yaml [0].requires[0]',
      'tails/watch.yaml [0].service',
    ]);
    expect(TailProfileSchema.safeParse({ id: 'watch', service: 'station', discipline: 0.5, team: 2 }).success).toBe(
      true,
    );
  });

  it('loads an extension pack through the content kind registry', () => {
    const root = mkdtempSync(join(tmpdir(), 'street-ops-'));
    tempRoots.push(root);
    const pack = join(root, 'street-ops-fixture');
    mkdirSync(join(pack, 'graphs'), { recursive: true });
    writeFileSync(
      join(pack, 'pack.yaml'),
      toYaml({ id: 'street-ops-fixture', version: '1.0.0', contentSchema: 2, role: 'extension' }),
    );
    writeFileSync(join(pack, 'graphs', 'inner.yaml'), toYaml({ items: [graph()] }));
    const loaded = loadContent([pack], ['street-ops-fixture'], { kinds: [...STREET_OPS_KINDS] });
    expect(loaded.ok, loaded.ok ? '' : JSON.stringify(loaded.errors)).toBe(true);
  });
});
