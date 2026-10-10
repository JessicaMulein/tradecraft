/**
 * Street reactions (task 11). A service records what it could have seen, and
 * the player hears a cable or a street notice, never the reason.
 */

import { describe, expect, it } from 'vitest';

import { asTruth } from '../model/core.js';
import { emptyHostileBeliefs } from '../hostile/beliefs.js';
import type { ServiceState } from '../region/services.js';
import { streetOpsAddOn } from './addon.js';
import { runtimeFromScenario } from './drive.js';
import {
  STREET_REACTIONS_HOOK,
  borderWatch,
  incidentForBluff,
  incidentForCheckpoint,
  incidentForTail,
  mergePlates,
  noteServices,
  streetEvents,
} from './hooks.js';
import { emptyStreetOpsTruth } from './state.js';

const at = { day: 2, phase: 1 as const };

function service(): ServiceState {
  return {
    id: 'service:local',
    kind: 'local-security',
    doctrine: { arrests: 0.5, deceptionAppetite: 0.2, surveillance: 0.4 },
    residencies: {},
    beliefs: {
      ...emptyHostileBeliefs(),
      coverSuspicion: 0.1,
      watch: asTruth({ persons: [], descriptors: [] }),
    },
    knowledge: { known: [], falseBeliefs: [], knownEntities: [] },
  } as ServiceState;
}

describe('street reactions', () => {
  it('sends a cable after a seizure and does not name the cause', () => {
    const seized = incidentForCheckpoint({
      service: 'service:local',
      plate: 'P-POOLCO',
      postId: 'halt',
      outcome: 'vehicle-seized',
      suspicionDelta: 0.3,
    });
    const quiet = incidentForTail({ service: 'service:local', suspicionDelta: 0, alert: false, search: false });
    const reaction = streetEvents([quiet, seized], at, {});
    expect(reaction.events.every((event) => event.visibility === 'player')).toBe(true);
    expect(reaction.events.map((event) => event.kind)).toEqual(['public-announcement', 'public-announcement', 'cable']);
    const text = JSON.stringify(reaction.events);
    expect(text.includes('tail')).toBe(false);
    expect(text.includes('bluff')).toBe(false);
    expect(text.includes('suspicion')).toBe(false);
    expect(reaction.plates).toEqual(['P-POOLCO']);
    expect(reaction.posture['service:local']).toEqual({ alert: true, search: true });
    const again = streetEvents([seized], at, reaction.posture);
    expect(again.events.map((event) => event.kind)).toEqual(['cable']);
  });

  it('puts a noted plate on the service watch list once', () => {
    const failed = incidentForBluff({ service: 'service:local', suspicionDelta: 0.2, plate: 'P-1', failed: true });
    const noted = noteServices({ 'service:local': service() }, [failed]);
    const watch = borderWatch(noted?.['service:local'], mergePlates([], ['P-1']));
    expect(watch.descriptors).toEqual(['P-1']);
    expect(noted?.['service:local']?.beliefs.coverSuspicion).toBeCloseTo(0.3);
    const twice = borderWatch(noted?.['service:local'], ['P-1']);
    expect(twice.descriptors).toEqual(['P-1']);
    expect(streetOpsAddOn(runtimeFromScenario({ streetOps: { enabled: true } })).hooks.map((hook) => hook.id)).toEqual([
      STREET_REACTIONS_HOOK,
    ]);
    expect(emptyStreetOpsTruth().posture).toEqual({});
  });

  it('records a tail without telling the player why the police moved', () => {
    const burned = incidentForTail({ service: 'service:hostile', suspicionDelta: 0.2, alert: true, search: true });
    const reaction = streetEvents([burned], at, {});
    expect(reaction.events).toEqual([]);
    expect(reaction.posture['service:hostile']).toEqual({ alert: true, search: true });
  });
  it('reports a real border post without a cable when the car is only turned back', () => {
    const turned = incidentForCheckpoint({
      service: 'service:local',
      plate: 'P-1',
      postId: 'post:line',
      outcome: 'turned-back',
      suspicionDelta: 0.1,
    });
    const reaction = streetEvents([turned], at, {});
    expect(reaction.events.map((event) => event.kind)).toEqual(['public-announcement', 'border-outcome']);
    expect(reaction.plates).toEqual([]);
  });
});
