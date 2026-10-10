/**
 * The shipped street-ops demo pack (task 2.2). Original geometry, loaded as an
 * extension and not selected by the default scenario.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { loadContent } from '@tradecraft/content';

import { checkStreetOpsContent, type StreetOpsSource } from './check.js';
import { STREET_OPS_KINDS } from './content.js';

const PACKS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'content', 'packs');
const PACK = join(PACKS, 'street-ops-core');

const DIRS = [
  join(PACKS, 'core'),
  join(PACKS, 'era-cold-war-early'),
  join(PACKS, 'lib-central-europe'),
  join(PACKS, 'lib-russian'),
  join(PACKS, 'city-vienna'),
  join(PACKS, 'city-berlin'),
  PACK,
];

function source(kind: string, file: string): StreetOpsSource {
  const parsed = parse(readFileSync(join(PACK, file), 'utf8')) as { items?: unknown[] };
  return { pack: 'street-ops-core', file, kind, items: parsed.items ?? [] };
}

describe('street-ops-core demo pack', () => {
  it('loads with the city pack and its references resolve', () => {
    const loaded = loadContent(DIRS, ['street-ops-core'], { kinds: [...STREET_OPS_KINDS] });
    expect(loaded.ok, loaded.ok ? '' : JSON.stringify(loaded.errors.slice(0, 6))).toBe(true);
    const graphs = [
      source('street-graph', 'graphs/inner-court.yaml'),
      source('street-graph', 'graphs/block-grid.yaml'),
    ];
    const sources = [
      ...graphs,
      source('vehicle', 'vehicles/vehicles.yaml'),
      source('evasion-maneuver', 'maneuvers/maneuvers.yaml'),
      source('surveillance-method', 'methods/methods.yaml'),
      source('tail-profile', 'tails/tails.yaml'),
      source('checkpoint-kind', 'checkpoints/checkpoints.yaml'),
      source('street-story', 'street-stories/stories.yaml'),
      source('composure-table', 'composure/composure.yaml'),
      source('map-document', 'maps/folded.yaml'),
    ];
    expect(graphs.reduce((count, item) => count + item.items.length, 0)).toBe(2);
    expect(sources.find((item) => item.kind === 'evasion-maneuver')?.items).toHaveLength(8);
    expect(sources.find((item) => item.kind === 'tail-profile')?.items).toHaveLength(3);
    expect(sources.find((item) => item.kind === 'street-story')?.items).toHaveLength(10);
    const errors = checkStreetOpsContent(
      sources,
      new Set([
        'era-cold-war-early/hostile-foreign-directorate',
        'era-cold-war-early/hostile-security-apparat',
        'city-vienna/city-security-directorate',
      ]),
    );
    expect(errors).toEqual([]);
  });
});
