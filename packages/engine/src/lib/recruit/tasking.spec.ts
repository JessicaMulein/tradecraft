/**
 * Tests for Asset tasking (task 18.1; Requirements 10.3, 10.4, 10.6, 22.6).
 *
 * These drive the pure `runAssetTask` over the four tasks:
 *
 * - collect: reports candidates filtered through the Asset's access/reliability
 *   (Req 10.4, 10.6);
 * - introduce: mints a Contact Channel and inherits a fraction of the
 *   introducer's trust (Req 22.6);
 * - service: reports the drop's contents (filtered) and carries left items;
 * - plant: places a Proposition with probability `reliability`.
 *
 * All four are deterministic for a seed, and `runAssetTask` throws on a
 * non-Asset relationship. `TASKING_EXPOSURE` is pinned against the shipped
 * default `exposure` weights and the meeting Exposure formula.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { crowdPenaltyProxy, meetingExposure } from '../action/arrange-meeting.js';
import { ScenarioConfigSchema } from '../config/scenario-config.js';
import { createPrng } from '../prng/prng.js';
import {
  asTruth,
  type DeadDropId,
  type NpcId,
  type Proposition,
  type Truth,
} from '../model/core.js';
import {
  newRelationship,
  type AssetAccess,
  type AssetProfile,
  type Relationship,
} from './asset.js';
import {
  runAssetTask,
  INTRODUCTION_TRUST_SHARE,
  TASKING_EXPOSURE,
  type AssetTaskContext,
} from './tasking.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function prop(id: string, subject: string): Truth<Proposition> {
  return asTruth({
    id,
    subject: subject as NpcId,
    predicate: 'LOCATED_AT',
    object: { kind: 'text', value: 'x' },
  });
}

function profile(reliability: number, access: Partial<AssetAccess> = {}): AssetProfile {
  return {
    access: asTruth({ locs: [], orgs: [], npcs: ['npc:t' as NpcId], ...access }),
    reliability: asTruth(reliability),
    turned: false,
    hostileControlled: asTruth(false),
  };
}

function assetRel(reliability = 1, trust = 0.6): Relationship {
  return {
    ...newRelationship('npc:asset' as NpcId),
    trust,
    recruited: true,
    asset: profile(reliability),
  };
}

// ---------------------------------------------------------------------------
// collect (Req 10.4, 10.6)
// ---------------------------------------------------------------------------

describe('runAssetTask: collect', () => {
  it('reports in-access candidates and labels the target', () => {
    const ctx: AssetTaskContext = {
      rel: assetRel(1),
      candidates: [prop('c1', 'npc:t'), prop('c2', 'npc:stranger')],
    };
    const result = runAssetTask(
      { kind: 'collect', target: 'npc:t' as NpcId },
      ctx,
      createPrng('collect'),
    );
    expect(result.kind).toBe('collect');
    if (result.kind === 'collect') {
      expect(result.target).toBe('npc:t');
      expect(result.reported.map((p) => p.id)).toEqual(['c1']);
    }
  });

  it('is deterministic for a seed', () => {
    const ctx: AssetTaskContext = {
      rel: assetRel(0.5),
      candidates: [prop('c1', 'npc:t'), prop('c2', 'npc:t'), prop('c3', 'npc:t')],
    };
    const task = { kind: 'collect', target: 'npc:t' as NpcId } as const;
    const a = runAssetTask(task, ctx, createPrng('seed'));
    const b = runAssetTask(task, ctx, createPrng('seed'));
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// introduce (Req 22.6)
// ---------------------------------------------------------------------------

describe('runAssetTask: introduce', () => {
  it('mints a Contact Channel and inherits a fraction of the introducer trust', () => {
    const result = runAssetTask(
      { kind: 'introduce', target: 'npc:friend' as NpcId },
      { rel: assetRel(1, 0.8) },
      createPrng('intro'),
    );
    expect(result.kind).toBe('introduce');
    if (result.kind === 'introduce') {
      expect(result.target).toBe('npc:friend');
      expect(result.channel).toBe(true);
      expect(result.inheritedTrust).toBeCloseTo(0.8 * INTRODUCTION_TRUST_SHARE, 10);
    }
  });

  it('clamps inherited trust into [0, 1]', () => {
    const result = runAssetTask(
      { kind: 'introduce', target: 'npc:friend' as NpcId },
      { rel: assetRel(1, 5) },
      createPrng('intro'),
    );
    if (result.kind === 'introduce') {
      expect(result.inheritedTrust).toBeLessThanOrEqual(1);
      expect(result.inheritedTrust).toBeGreaterThanOrEqual(0);
    }
  });
});

// ---------------------------------------------------------------------------
// service dead drop
// ---------------------------------------------------------------------------

describe('runAssetTask: service', () => {
  it('reports the drop contents (filtered) and carries the left items', () => {
    const ctx: AssetTaskContext = {
      rel: assetRel(1),
      dropContents: [prop('d1', 'npc:t'), prop('d2', 'npc:stranger')],
    };
    const result = runAssetTask(
      { kind: 'service', drop: 'drop:main' as DeadDropId, leave: ['item:pad'] },
      ctx,
      createPrng('service'),
    );
    expect(result.kind).toBe('service');
    if (result.kind === 'service') {
      expect(result.drop).toBe('drop:main');
      expect(result.collected.map((p) => p.id)).toEqual(['d1']);
      expect(result.left).toEqual(['item:pad']);
    }
  });

  it('defaults left items to empty', () => {
    const result = runAssetTask(
      { kind: 'service', drop: 'drop:main' as DeadDropId },
      { rel: assetRel(1), dropContents: [] },
      createPrng('service'),
    );
    if (result.kind === 'service') {
      expect(result.left).toEqual([]);
      expect(result.collected).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// plant
// ---------------------------------------------------------------------------

describe('runAssetTask: plant', () => {
  const planted = prop('plant-prop', 'npc:target') as unknown as Proposition;

  it('places the plant for a fully reliable Asset', () => {
    const result = runAssetTask(
      { kind: 'plant', prop: planted, at: undefined },
      { rel: assetRel(1) },
      createPrng('plant'),
    );
    expect(result.kind).toBe('plant');
    if (result.kind === 'plant') {
      expect(result.placed).toBe(true);
      expect(result.prop).toBe(planted);
    }
  });

  it('never places for a zero-reliability Asset', () => {
    const result = runAssetTask(
      { kind: 'plant', prop: planted },
      { rel: assetRel(0) },
      createPrng('plant'),
    );
    if (result.kind === 'plant') {
      expect(result.placed).toBe(false);
    }
  });

  it('is deterministic for a seed', () => {
    const task = { kind: 'plant', prop: planted } as const;
    const a = runAssetTask(task, { rel: assetRel(0.5) }, createPrng('p'));
    const b = runAssetTask(task, { rel: assetRel(0.5) }, createPrng('p'));
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// the tasking risk (slice-integration Req 10.7)
// ---------------------------------------------------------------------------

/** The shipped `config/scenario.yaml`, whose weights are the defaults. */
const SCENARIO_YAML_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../..',
  'config/scenario.yaml',
);

describe('TASKING_EXPOSURE', () => {
  it('is half the Exposure a risk-0.5 meeting adds under the default weights', () => {
    const scenario = ScenarioConfigSchema.parse(parseYaml(readFileSync(SCENARIO_YAML_PATH, 'utf8')));
    const risk = 0.5;
    const meeting = meetingExposure(scenario.recruitment.exposure, risk, crowdPenaltyProxy(risk), 0);
    expect(TASKING_EXPOSURE).toBeCloseTo(meeting / 2, 12);
    // Pinned: k1 = 0.6, k2 = 0.4, k3 = 0.3 give 0.5 × (0.3 + 0.2) = 0.25.
    expect(TASKING_EXPOSURE).toBe(0.25);
  });
});

// ---------------------------------------------------------------------------
// guard
// ---------------------------------------------------------------------------

describe('runAssetTask: guards', () => {
  it('throws when the relationship is not a running Asset', () => {
    const notAsset = newRelationship('npc:x' as NpcId);
    expect(() =>
      runAssetTask(
        { kind: 'collect', target: 'npc:t' as NpcId },
        { rel: notAsset },
        createPrng('g'),
      ),
    ).toThrow(/not a running Asset/);
  });
});
