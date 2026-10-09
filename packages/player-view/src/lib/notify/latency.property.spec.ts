/**
 * Property 12 — regional latency and notification soundness (multi-city task 11.2).
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  addPhases,
  enqueueNotices,
  isPlayerVisibleKind,
  releaseNotices,
  resultReadyAt,
  timeToPhases,
  type GameTime,
  type Phase,
  type SimEvent,
} from '@tradecraft/engine';

import { notify } from './notify.js';
import type { NotifyView } from './view.js';

const HERE = 'city:north' as const;
const THERE = 'city:east' as const;

function view(): NotifyView {
  return {
    npcs: {},
    city: { locations: {} },
    player: { known: { entities: [], channels: [], drops: [] } },
    deadDrops: {},
    station: { directives: [] },
    meetings: {},
  } as unknown as NotifyView;
}

function report(at: GameTime, city: typeof HERE | typeof THERE): SimEvent {
  return {
    id: `e:${city}:${at.day}.${at.phase}` as SimEvent['id'],
    at,
    visibility: 'player',
    city,
    kind: 'outstation-report',
  };
}

describe('Property 12: regional latency and notification soundness', () => {
  it('delivers a notice only after latency, and only carriage notices during transit', () => {
    // Feature: multi-city, Property 12: Regional latency and notification soundness
    const seen = view();
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 12 }),
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 1, max: 4 }),
        fc.boolean(),
        (day, phase, wait, inTransit) => {
          const at = { day, phase: phase as Phase };
          const remote = report(at, THERE);
          const carriage = {
            id: 'e:carriage' as SimEvent['id'],
            at,
            visibility: 'player' as const,
            city: null,
            kind: 'public-announcement' as const,
            text: 'The carriage is delayed.',
          };
          const hidden: SimEvent = {
            id: 'e:hidden' as SimEvent['id'],
            at,
            visibility: 'hidden',
            city: THERE,
            kind: 'asset-arrested',
            npc: 'npc:mole',
          };
          const route = {
            playerCity: HERE,
            inTransit,
            latency: { sameCountry: 0, crossBorder: wait, acrossCurtain: wait },
            countryOf: (city: string) => (city === HERE ? 'Northland' : 'Eastland'),
          };
          const pending = enqueueNotices([remote, carriage, hidden], route);
          const early = releaseNotices(pending, at, inTransit);
          const earlyIds = notify(early.due, seen).map((note) => note.id);
          expect(earlyIds).not.toContain(`notification:${remote.id}`);

          const later = releaseNotices(pending, addPhases(at, wait), inTransit);
          const notes = notify(later.due, seen);
          const visibleOnly = notify(
            later.due.filter((event) => isPlayerVisibleKind(event.kind) && event.visibility === 'player'),
            seen,
          );
          expect(notes).toEqual(visibleOnly);
          expect(notes.some((note) => note.factLine.includes('secret'))).toBe(false);
          const remoteDue = notes.some((note) => note.id === `notification:${remote.id}`);
          const carriageDue = notes.some((note) => note.id === `notification:${carriage.id}`);
          if (inTransit) {
            expect(remoteDue).toBe(false);
            expect(carriageDue).toBe(true);
          } else {
            expect(remoteDue).toBe(true);
            expect(timeToPhases(addPhases(at, wait))).toBeGreaterThanOrEqual(timeToPhases(at) + wait);
          }
          const ready = resultReadyAt(at, wait, 'courier', wait);
          expect(timeToPhases(ready)).toBeGreaterThanOrEqual(timeToPhases(at) + wait);
        },
      ),
      { numRuns: 100 },
    );
  });
});
