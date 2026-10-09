/**
 * Regional projections (multi-city Requirement 17).
 */

import { describe, expect, it } from 'vitest';
import type { LocId, NpcId, WorldState } from '@tradecraft/engine';

import { CaseFile } from '../casefile/casefile.js';
import { listClaims, peopleView } from '../api/views.js';
import { papersView, regionMapView } from './views.js';

function regional(): WorldState {
  return {
    time: { day: 2, phase: 0 },
    player: {
      loc: 'loc:halt' as LocId,
      city: 'city:north',
      papers: ['paper:pass'],
      known: { entities: ['npc:ana'], drops: [] },
      unkIds: {},
    },
    npcs: {
      'npc:ana': {
        id: 'npc:ana',
        persona: { name: 'Ana' },
        descriptor: { summary: 'a courier' },
        schedule: { entries: [] },
      },
    },
    relationships: {},
    orgs: {},
    city: { locations: {}, districts: {}, routes: [] },
    travelDocs: {
      'paper:pass': {
        id: 'paper:pass',
        kind: 'passport',
        holder: 'player',
        issuedBy: { kind: 'station', id: 'hub' },
        quality: 0.2,
        satisfies: ['post:line'],
      },
    },
    region: {
      template: 'central',
      order: ['city:north', 'city:east'],
      cities: {
        'city:north': {
          id: 'city:north',
          name: 'Northport',
          styleSheet: 'Salt and coal smoke.',
          tier: 'full',
          country: 'Northland',
          districts: {},
          locations: {
            'loc:halt': { id: 'loc:halt', name: 'North Halt', public: true },
            'loc:cafe': { id: 'loc:cafe', name: 'Cafe', public: true },
          },
          routes: [],
          weather: { condition: 'clear', label: 'clear', season: 'summer' },
          sectorLines: [],
        },
        'city:east': {
          id: 'city:east',
          name: 'Eastport',
          tier: 'coarse',
          country: 'Eastland',
          districts: {},
          locations: {
            'loc:east': { id: 'loc:east', name: 'East Halt', public: true },
          },
          routes: [],
          weather: { condition: 'clear', label: 'clear', season: 'summer' },
          sectorLines: [],
        },
      },
      intercity: {
        'route:east': {
          id: 'route:east',
          mode: 'rail',
          from: 'loc:halt',
          to: 'loc:east',
          fromCity: 'city:north',
          toCity: 'city:east',
          duration: 2,
          fare: 12,
          borders: ['post:line'],
          timetable: 'morning',
        },
      },
      borderPosts: {},
      jurisdiction: {},
      latency: {},
    },
    locationOf: {
      'npc:ana': { city: 'city:east', loc: 'loc:east' },
    },
  } as unknown as WorldState;
}

describe('regional player view', () => {
  it('lists cities, routes and papers, and leaves quality off the papers', () => {
    const view = regionMapView(regional());
    expect(view?.cities.map((city) => city.name)).toEqual(['Northport', 'Eastport']);
    expect(view?.routes[0]).toMatchObject({ mode: 'rail', duration: 2, fare: 12, borders: ['post:line'] });
    expect(view?.departures[0]?.destination).toBe('Eastport');
    const papers = papersView(regional());
    expect(papers[0]?.kind).toBe('passport');
    expect(papers[0]).not.toHaveProperty('quality');
    expect(JSON.stringify(papers)).not.toContain('0.2');
  });

  it('shows the last city the player saw, not the hidden placement', () => {
    const state = regional();
    const file = new CaseFile();
    file.add({
      source: { kind: 'surveillance', loc: 'loc:cafe' as LocId },
      prop: {
        subject: 'npc:ana' as NpcId,
        predicate: 'core/seen',
        object: { kind: 'text', value: 'here' },
        place: 'loc:cafe' as LocId,
      },
      observedAt: { day: 1, phase: 0 },
    });
    const person = peopleView(state, file).people.find((row) => row.label === 'Ana');
    expect(person?.lastKnownCity).toEqual({ id: 'city:north', name: 'Northport' });
    const east = listClaims(file, { city: 'city:east' }, state);
    const north = listClaims(file, { city: 'city:north' }, state);
    expect(east).toEqual([]);
    expect(north).toHaveLength(1);
  });

  it('returns no region map in slice mode', () => {
    const slice = { player: { papers: [] }, region: undefined } as unknown as WorldState;
    expect(regionMapView(slice)).toBeUndefined();
    expect(papersView(slice)).toEqual([]);
  });
});
