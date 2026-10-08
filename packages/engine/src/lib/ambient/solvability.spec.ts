/**
 * Solvability gate: witnesses, anchors, fast path, slow path, cap and fallback.
 */

import { describe, expect, it } from 'vitest';

import type { DiscoveryInputs, DiscoveryResult } from '../city/discovery.js';
import type { Proposition } from '../model/core.js';

import {
  anchorsOf,
  applyForDuration,
  footprint,
  gate,
  verifierResult,
  type GateCache,
  type VerifierResult,
} from './solvability.js';

const fact = {
  id: 'prop:meets',
  subject: 'npc:clerk',
  predicate: 'MEETS_AT',
  object: 'npc:courier',
} as Proposition;

function discovery(): DiscoveryResult {
  return {
    ok: true,
    stages: [
      {
        kind: 'stage',
        stage: 'stage:meet',
        prop: fact,
        human: { edge: 'meeting', npc: 'npc:clerk' },
        signal: { edge: 'surveillance', loc: 'loc:cafe' },
      },
    ],
    single: [],
    root: {
      entities: new Set(),
      channels: new Set(),
      documents: new Set(),
      leads: new Set(),
    },
  };
}

const world = {
  npcs: {
    'npc:clerk': {
      schedule: { entries: [{ weekday: 0, phase: 1 as const, loc: 'loc:cafe' as const }] },
    },
    'npc:courier': {
      schedule: { entries: [{ weekday: 2, phase: 2 as const, loc: 'loc:park' as const }] },
    },
  },
  plot: {
    stages: [
      {
        status: 'pending',
        traces: [
          {
            index: 0,
            kind: 'meeting' as const,
            participants: ['npc:courier' as const],
            place: { kind: 'loc' as const, loc: 'loc:park' as const },
            evidences: ['MEETS_AT'],
            template: 'They meet.',
          },
        ],
      },
    ],
  },
};

function cacheOf(result: VerifierResult, slowRunsToday = 0): GateCache {
  return {
    result,
    anchors: anchorsOf(result, world),
    slowRunsToday,
  };
}

describe('solvability gate', () => {
  it('keeps the covered facts and both witness paths', () => {
    const result = verifierResult(discovery());
    expect([...result.solvable]).toEqual(['npc:clerk|MEETS_AT|npc:courier|']);
    const paths = result.witnesses.get('npc:clerk|MEETS_AT|npc:courier|');
    expect(paths?.[0]).toEqual({ edge: 'meeting', node: 'npc:clerk' });
    expect(paths?.[1]).toEqual({ edge: 'surveillance', node: 'loc:cafe' });
  });

  it('anchors meeting schedules and pending trace places', () => {
    const anchors = anchorsOf(verifierResult(discovery()), world);
    expect(anchors.has('npc:clerk|0|1|loc:cafe')).toBe(true);
    expect(anchors.has('npc:courier|2|2|loc:park')).toBe(true);
  });

  it('accepts a change that misses every anchor and witness without verifying', () => {
    const result = verifierResult(discovery());
    let ran = false;
    const decision = gate({
      change: { kind: 'location-status', locs: ['loc:unrelated'], status: 'closed-temporarily' },
      cache: cacheOf(result),
      slowCap: 6,
      world,
      verify: () => {
        ran = true;
        return result;
      },
    });
    expect(decision).toMatchObject({ decision: 'accept', via: 'fast' });
    expect(ran).toBe(false);
    expect(footprint({ kind: 'location-status', locs: ['loc:cafe'], status: 'open' }).size).toBe(0);
  });

  it('accepts a hitting change only when the solvable set still contains the old one', () => {
    const before = verifierResult(discovery());
    const widened: VerifierResult = {
      solvable: new Set([...before.solvable, 'extra']),
      witnesses: before.witnesses,
    };
    const accepted = gate({
      change: { kind: 'location-status', locs: ['loc:cafe'], status: 'closed-temporarily' },
      cache: cacheOf(before),
      slowCap: 6,
      world,
      verify: () => widened,
    });
    expect(accepted.decision).toBe('accept');
    expect(accepted.via).toBe('slow');
    expect(accepted.cache.slowRunsToday).toBe(1);
    expect(accepted.cache.result.solvable.has('extra')).toBe(true);

    const shrunk: VerifierResult = { solvable: new Set(), witnesses: new Map() };
    const rejected = gate({
      change: { kind: 'detain-npc', npc: 'npc:clerk' },
      cache: cacheOf(before),
      slowCap: 6,
      world,
      fallback: { op: 'crowd-modifier' },
      verify: () => shrunk,
    });
    expect(rejected.decision).toBe('reject');
    expect(rejected.via).toBe('slow');
    expect(rejected.fallback).toEqual({ op: 'crowd-modifier' });
    expect(rejected.cache.result).toBe(before);
  });

  it('drops a change past the slow-path cap and does not verify', () => {
    const before = verifierResult(discovery());
    let ran = false;
    const decision = gate({
      change: { kind: 'channel-outage', channel: 'chan:radio' },
      cache: { ...cacheOf(before, 6), anchors: new Set(['chan:radio']) },
      slowCap: 6,
      world,
      fallback: { op: 'metric-delta' },
      verify: () => {
        ran = true;
        return before;
      },
    });
    expect(decision).toMatchObject({ decision: 'reject', via: 'cap', fallback: { op: 'metric-delta' } });
    expect(ran).toBe(false);
    expect(decision.cache.slowRunsToday).toBe(6);
  });

  it('applies a closure, a detention and an outage for the whole check', () => {
    const inputs = {
      city: {
        locations: { 'loc:cafe': { id: 'loc:cafe' }, 'loc:park': { id: 'loc:park' } },
        routes: [{ a: 'dist:a', b: 'dist:b', cost: 1 }],
      },
      principals: {
        npcs: {
          'npc:clerk': {
            schedule: { entries: [{ weekday: 0, phase: 1, loc: 'loc:cafe' }] },
          },
        },
      },
      comms: { channels: { 'chan:radio': { id: 'chan:radio' } } },
    } as unknown as DiscoveryInputs;

    const closed = applyForDuration(inputs, {
      kind: 'location-status',
      locs: ['loc:cafe'],
      status: 'closed-temporarily',
    });
    expect(closed.city.locations['loc:cafe']).toBeUndefined();
    expect(closed.city.locations['loc:park']).toBeDefined();
    expect(closed.principals.npcs['npc:clerk']?.schedule.entries).toEqual([]);

    const detained = applyForDuration(inputs, { kind: 'detain-npc', npc: 'npc:clerk' });
    expect(detained.principals.npcs['npc:clerk']).toBeUndefined();

    const dark = applyForDuration(inputs, { kind: 'channel-outage', channel: 'chan:radio' });
    expect(dark.comms.channels['chan:radio']).toBeUndefined();

    const unrouted = applyForDuration(inputs, { kind: 'route-closure', a: 'dist:a', b: 'dist:b' });
    expect(unrouted.city.routes).toEqual([]);
  });
});
