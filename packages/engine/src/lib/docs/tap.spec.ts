/**
 * Tap transcripts are a Station lead: cover names, a real place, no identities.
 */
import { describe, expect, it } from 'vitest';

import type { SimEvent, WorldState } from '../model/state.js';
import { composeTapTranscript, coverName, fileTapTranscripts } from './tap.js';

function world(): WorldState {
  return {
    meta: { setting: { startDate: '1952-12-01' } },
    city: {
      locations: {
        'loc:cafe': { id: 'loc:cafe', name: 'Café Hochquell', type: 'cafe' },
        'loc:station': { id: 'loc:station', name: 'the Station', type: 'station-hq' },
      },
    },
    documents: {},
    documentPropositions: {},
  } as unknown as WorldState;
}

const meeting = {
  id: 'plot-evt:meet-1',
  at: { day: 4, phase: 0 as const },
  loc: 'loc:cafe' as const,
  participants: ['npc:ada-berger-1', 'npc:boris-novak-2'] as const,
};

describe('tap transcripts', () => {
  it('gives each voice a stable cover name', () => {
    expect(coverName('npc:ada-berger-1')).toBe(coverName('npc:ada-berger-1'));
    const taken = new Set([coverName('npc:ada-berger-1')]);
    expect(coverName('npc:ada-berger-1', taken)).not.toBe(coverName('npc:ada-berger-1'));
  });

  it('writes a guarded call about a real place and does not name the speakers', () => {
    const composed = composeTapTranscript(world(), meeting);
    expect(composed).toBeDefined();
    const doc = composed?.document;
    expect(doc?.kind).toBe('notice');
    expect(doc?.title).toContain('5 December 1952');
    expect(doc?.obtainableAt).toEqual(['loc:station']);
    expect(doc?.body).toContain('Café Hochquell');
    expect(doc?.body).toContain('5 December 1952, morning');
    expect(doc?.body).toContain('has not put a name to either voice');
    expect(doc?.body).not.toContain('npc:');
    expect(doc?.body).not.toContain('ada-berger');
    expect(doc?.body).not.toContain('boris-novak');
    const prop = composed?.propositions[0];
    expect(prop?.subject).toBe('loc:cafe');
    expect(prop?.object).toMatchObject({ kind: 'text' });
    if (prop?.object && typeof prop.object === 'object' && prop.object.kind === 'text') {
      expect(prop.object.value).toContain('meets');
      expect(prop.object.value).not.toContain('npc:');
    }
  });

  it('files each meeting once', () => {
    const event = { kind: 'meeting', ...meeting, visibility: 'hidden', origin: { stage: 's' } } as unknown as SimEvent;
    const once = fileTapTranscripts(world(), [event]);
    const twice = fileTapTranscripts(once, [event]);
    const ids = Object.keys(once.documents);
    expect(ids).toHaveLength(1);
    expect(Object.keys(twice.documents)).toEqual(ids);
    expect(Object.keys(once.documentPropositions)).toHaveLength(1);
  });
});
