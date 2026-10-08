/**
 * City, Stories and Duties views, and learned map status.
 */

import { asTruth, type EntityId } from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import { CaseFile } from '../casefile/casefile.js';
import type { WorldState } from '@tradecraft/engine';

import { cityView, dutiesView, knownLocationStatus, storiesView, type DutiesView } from './city-views.js';

function world(): WorldState {
  return {
    time: { day: 3, phase: 1 },
    player: {
      known: { entities: ['evt:fair' as EntityId], channels: [], drops: [] },
      readDocuments: ['doc:paper'],
    },
    documents: {
      'doc:paper': {
        id: 'doc:paper',
        kind: 'newspaper',
        title: 'The fair opens',
        date: { day: 3, phase: 0 },
        body: 'The fair is underway.',
        asserts: [],
      },
    },
    documentPropositions: {},
    ambient: {
      events: {
        'evt:fair': { name: 'Harvest fair', public: true },
        'evt:raid': { name: 'The raid', public: false },
      },
      stories: {
        'story:fair': {
          id: 'story:fair',
          key: 'fair',
          source: 'evt:fair',
          chain: ['announced'],
          beats: [{ beat: 'The fair is underway', day: 3, props: [] }],
          lastDevelopment: 3,
          status: 'active',
          priority: 1,
        },
      },
      duties: [
        {
          id: 'duty:office',
          template: 'office-hours',
          loc: 'loc:office',
          slot: { day: 3, phase: 1 },
          phases: 1,
          mandatory: true,
          standingGain: 0.05,
          suspicionDelta: 0.02,
          attendees: [],
          status: 'pending',
        },
      ],
      coverStanding: asTruth(0.2),
      lastKnownStatus: { 'loc:cafe': 'open' },
      overlays: [],
    },
  } as unknown as WorldState;
}

describe('city views', () => {
  it('lists only events the player has learned, and groups a story they have read', () => {
    const view = cityView(world(), new CaseFile());
    expect(view.events).toEqual([{ id: 'evt:fair', name: 'Harvest fair' }]);
    expect(storiesView(world()).stories.map((story) => story.id)).toEqual(['story:fair']);
  });

  it('shows cover standing as a band and the status the player learned', () => {
    const duties: DutiesView = dutiesView(world());
    expect(duties.band).toBe('low');
    expect(duties.duties.map((duty) => duty.id)).toEqual(['duty:office']);
    expect(JSON.stringify(duties)).not.toContain('hookLedger');
    expect(knownLocationStatus(world(), 'loc:cafe')).toBe('open');
    expect(knownLocationStatus(world(), 'loc:bar')).toBeUndefined();
  });
});
