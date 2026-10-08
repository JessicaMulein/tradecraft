/**
 * Property 17: Ambient truth isolation and notification soundness.
 * Validates Requirements 8.6, 13.3, 20.2, 20.3, 20.4, 20.5.
 */

import { asTruth, isPlayerVisibleKind, type EntityId, type SimEvent, type WorldState } from '@tradecraft/engine';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { CaseFile } from '../casefile/casefile.js';
import { notify } from '../notify/notify.js';
import type { NotifyView } from '../notify/view.js';

import { cityView, dutiesView, knownLocationStatus, storiesView } from './city-views.js';

const FORBIDDEN = [
  'regard',
  'recollection',
  'recollections',
  'memory',
  'informant',
  'informants',
  'hookLedger',
  'hook-ledger',
  'life',
  'lifeState',
  'origin',
];

function keysOf(value: unknown, found: Set<string>): void {
  if (value === null || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      keysOf(item, found);
    }
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    found.add(key);
    keysOf(child, found);
  }
}

function world(known: readonly string[], learnedStatus: string): WorldState {
  return {
    player: {
      known: { entities: known.map((id) => id as EntityId), channels: [], drops: [] },
      readDocuments: [],
    },
    documents: {},
    documentPropositions: {},
    ambient: {
      events: {
        'evt:fair': { name: 'Harvest fair' },
        'evt:raid': { name: 'The raid' },
      },
      stories: {},
      duties: [],
      coverStanding: asTruth(0.5),
      lastKnownStatus: { 'loc:cafe': learnedStatus },
      regard: asTruth({ 'npc:ada': { warmth: 0.4, wariness: 0.1, familiarity: 0.2 } }),
      memory: asTruth({ 'npc:ada': [{ id: 'rec:saw', kind: 'saw' }] }),
      informants: asTruth({ 'npc:ada': 'hostile' }),
      hookLedger: asTruth([{ kind: 'delay-stage', day: 1, detail: 'meet+1' }]),
      life: { 'npc:ada': { mood: 0.4, removed: 'detained' } },
    },
    sideThreads: [{ id: 'thread:rumour', origin: 'emergent', participants: ['npc:ada'] }],
  } as unknown as WorldState;
}

describe('Property 17: Ambient truth isolation and notification soundness', () => {
  // Feature: ambient-world, Property 17: Ambient truth isolation and notification soundness
  it('keeps hidden city truth out of the views, lists only learned events, and ignores hidden notices', () => {
    const view = { npcs: {}, city: { locations: {} }, player: { known: { entities: [], channels: [], drops: [] } }, meetings: {} } as unknown as NotifyView;
    fc.assert(
      fc.property(
        fc.subarray(['evt:fair', 'evt:raid']),
        fc.constantFrom('open', 'closed-temporarily'),
        fc.boolean(),
        (known, status, hidden) => {
          const state = world(known, status);
          const caseFile = new CaseFile();
          const projected = {
            city: cityView(state, caseFile),
            stories: storiesView(state),
            duties: dutiesView(state),
            mapStatus: knownLocationStatus(state, 'loc:cafe'),
            caseFile: caseFile.list(),
          };
          const keys = new Set<string>();
          keysOf(projected, keys);
          for (const forbidden of FORBIDDEN) {
            expect(keys.has(forbidden)).toBe(false);
          }
          expect(projected.city.events.map((event) => event.id).sort()).toEqual([...known].sort());
          expect(projected.mapStatus).toBe(status);
          const visible: SimEvent = {
            id: 'e:cable',
            at: { day: 1, phase: 1 },
            visibility: 'player',
            kind: 'cable',
            doc: 'doc:brief',
          } as SimEvent;
          const secret: SimEvent = {
            id: 'e:gossip',
            at: { day: 1, phase: 1 },
            visibility: 'hidden',
            kind: 'gossip',
            npc: 'npc:ada',
          } as SimEvent;
          expect(isPlayerVisibleKind(secret.kind)).toBe(false);
          const base = notify([visible], view);
          const mixed = hidden ? notify([secret, visible, secret], view) : notify([visible], view);
          expect(mixed).toEqual(base);
        },
      ),
      { numRuns: 100 },
    );
  });
});
