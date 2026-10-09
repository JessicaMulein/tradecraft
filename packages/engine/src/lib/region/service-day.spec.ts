import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { asTruth, type NpcId, type Proposition } from '../model/core.js';
import { addPhases } from '../clock/clock.js';
import { emptyHostileBeliefs } from '../hostile/beliefs.js';
import type { ServiceId } from '../fidelity/types.js';
import { leakageBounded, serviceDay, visibleToPosting, type QueuedShare } from './service-day.js';
import type { ServiceState } from './services.js';
import { liaisonShare } from '../liaison/exchange.js';

const at = { day: 0, phase: 0 as const };

function service(id: ServiceId, kind: ServiceState['kind'], cover = 0): ServiceState {
  return {
    id,
    kind,
    country: kind === 'local-security' ? 'Northland' : undefined,
    doctrine: { riskTolerance: id.endsWith('east') ? 0.2 : 0.9, securityConsciousness: 0.2, deceptionAppetite: 0.2 },
    residencies: {
      'city:north': { officers: [`npc:${id.slice('service:'.length)}` as NpcId], channels: [], drops: [], capacity: 1 },
    },
    beliefs: {
      ...emptyHostileBeliefs(),
      coverSuspicion: cover,
      watch: asTruth({ persons: [], descriptors: [] }),
    },
    knowledge: { known: [], falseBeliefs: [], knownEntities: [] },
  };
}

function base(services: Record<ServiceId, ServiceState>, shares: readonly QueuedShare[] = []) {
  return {
    seed: 'day',
    order: ['city:north' as const, 'city:east' as const],
    services,
    rivalry: [],
    candidates: {},
    at,
    shares,
    burnThreshold: 0.8,
    playerCity: 'city:north' as const,
    countries: ['Northland', 'Eastland'],
    cities: [
      { id: 'city:north' as const, country: 'Northland' },
      { id: 'city:east' as const, country: 'Eastland' },
    ],
    routes: [{ id: 'route:rail' as const, fromCity: 'city:north' as const, toCity: 'city:east' as const, to: 'loc:halt' as const, duration: 2 }],
    png: [],
    burned: false,
  };
}

describe('service day', () => {
  it('expels the player from a country and ends the game when every country bars them', () => {
    const local = service('service:north-watch', 'local-security', 0.95);
    const expelled = serviceDay(base({ [local.id]: local }));
    expect(expelled.png).toEqual(['Northland']);
    expect(expelled.playerCity).toBe('city:east');
    expect(expelled.playerLoc).toBe('loc:halt');
    expect(expelled.burned).toBe(false);
    expect(expelled.events.some((event) => event.kind === 'expelled')).toBe(true);

    const everywhere = serviceDay({
      ...base({ [local.id]: local }),
      countries: ['Northland'],
      cities: [{ id: 'city:north', country: 'Northland' }],
      routes: [],
    });
    expect(everywhere.burned).toBe(true);
    expect(everywhere.ended).toEqual({ outcome: 'failure', at, cause: 'burned' });
  });

  it('burns the player when a hostile service crosses the threshold', () => {
    const hostile = service('service:hostile', 'hostile', 0.8);
    const day = serviceDay(base({ [hostile.id]: hostile }));
    expect(day.burned).toBe(true);
    expect(day.events.some((event) => event.kind === 'player-burned')).toBe(true);
  });

  it('publishes an arrest when a rival exposes an agent', () => {
    const east = service('service:east', 'hostile');
    const west = service('service:west', 'hostile');
    const local = service('service:watch', 'local-security');
    const day = serviceDay({
      ...base({
        [east.id]: east,
        [west.id]: west,
        [local.id]: local,
      }),
      rivalry: [{
        from: east.id,
        to: west.id,
        share: false,
        delayPhases: 1,
        compete: true,
        expose: 1,
      }],
    });
    expect(day.events.some((event) => event.kind === 'public-announcement' && event.text.includes('npc:east'))).toBe(true);
  });

  it('Property 8: Shared-intelligence leakage bound', () => {
    // Feature: multi-city, Property 8: Shared-intelligence leakage bound
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 6 }),
        fc.array(fc.integer({ min: 1, max: 40 }), { minLength: 1, maxLength: 3 }),
        fc.boolean(),
        (delay, ids, hub) => {
          const props: Proposition[] = ids.map((id) => ({
            id: `prop:${id}`,
            subject: 'npc:agent' as NpcId,
            predicate: 'KNOWS',
            object: { kind: 'text' as const, value: 'desk' },
          }));
          const from = service('service:from', 'hostile');
          const to = service('service:to', 'liaison');
          const shares: QueuedShare[] = props.map((prop) => ({
            from: from.id,
            to: to.id,
            prop,
            queuedAt: 0,
            delay,
          }));
          const early = serviceDay({ ...base({ [from.id]: from, [to.id]: to }), shares, at });
          if (delay > 0) {
            expect(early.adoptions.some((item) => item.origin === 'share')).toBe(false);
          }
          const due = serviceDay({
            ...base({ [from.id]: from, [to.id]: to }),
            shares: delay === 0 ? shares : early.shares,
            at: addPhases(at, delay),
          });
          expect(due.adoptions.filter((item) => item.origin === 'share').map((item) => item.prop.id)).toEqual(
            props.map((prop) => prop.id),
          );
          const penetrated = {
            ...to,
            liaison: {
              reliability: asTruth(1),
              agenda: { conceal: [], promote: [], obtain: [] },
              trust: 0.4,
              delayPhases: 1,
            },
            penetratedBy: asTruth({ service: from.id, agent: 'npc:mole' as NpcId, delayPhases: delay }),
          };
          const shared = liaisonShare(penetrated, props);
          const posting = 'city:north' as const;
          const seen = ['city:north' as const, 'city:east' as const].filter((city) => visibleToPosting(hub, posting, city));
          expect(leakageBounded(
            due.adoptions,
            shared.relayed,
            props,
            [{ city: posting, hub, seen }],
          )).toBe(true);
          expect(shared.relayed.map((prop) => prop.id)).toEqual(props.map((prop) => prop.id));
        },
      ),
      { numRuns: 100 },
    );
  });
});
