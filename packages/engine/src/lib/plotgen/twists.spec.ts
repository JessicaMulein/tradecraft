import { describe, expect, it } from 'vitest';

import { asTruth, revealTruth } from '../model/core.js';
import type { NpcId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import type { Npc } from '../city/npc.js';
import { docId } from '../docs/document.js';
import type { ComposedDocument } from '../docs/document.js';
import { HOSTILE_ORG_ID } from '../city/principals.js';

import type { PlotStateV2 } from './types.js';
import {
  falseFlagRumours,
  materialiseTwists,
  twistGroundTruth,
  withFalseFlagRumour,
} from './twists.js';

function plot(twist: PlotStateV2['twist'], id = 'plot:dockside-fire'): PlotStateV2 {
  return {
    id,
    templateId: 'dockside-fire',
    displayName: 'Dockside fire',
    archetype: 'sabotage',
    role: 'primary',
    variantKey: 'k',
    cells: [{ org: 'org:cell-dockside-fire-action', spec: 'action', security: 0.4, members: ['npc:leader'] }],
    cutouts: [],
    bindings: {},
    roleHolders: { leader: 'npc:leader' },
    knowledge: {},
    runtimeBranches: [],
    outcomes: { success: [], failure: [] },
    offMap: [],
    stages: [],
    subPlots: [],
    standingPenalty: 0,
    standingReward: 0,
    ...(twist === undefined ? {} : { twist }),
  } as PlotStateV2;
}

function world(plots: readonly PlotStateV2[], npc?: Npc): WorldState {
  const npcs = npc === undefined ? {} : { [npc.id]: npc };
  return {
    time: { day: 0, phase: 0 },
    city: { locations: {} },
    orgs: {},
    npcs,
    documents: {},
    documentPropositions: {},
    plots,
  } as unknown as WorldState;
}

describe('library twists', () => {
  it('files a false-flag membership as a notice and keeps it out of the truth store', () => {
    const planted = plot({
      kind: 'false-flag',
      facadeStages: [],
      decoy: 'org:front-dockside-fire',
      cover: [{ npc: 'npc:leader', org: 'org:front-dockside-fire' }],
      plants: [
        { kind: 'document', org: 'org:front-dockside-fire' },
        { kind: 'rumour', org: 'org:front-dockside-fire' },
      ],
      propositions: ['MEMBER_OF'],
    });
    const next = materialiseTwists(world([planted]));
    const noticeId = docId('notice', 'plant/plot:dockside-fire');
    const notice = next.documents[noticeId];
    expect(notice?.kind).toBe('notice');
    expect(notice?.title).toBe('A note naming a local crew');
    expect(notice?.obtainableAt).toEqual([]);
    expect(next.orgs['org:front-dockside-fire' as keyof typeof next.orgs]?.kind).toBe('front');
    const propId = notice?.asserts[0];
    expect(propId).toBeDefined();
    if (propId === undefined) {
      return;
    }
    expect(next.documentPropositions[propId]?.object).toBe('org:front-dockside-fire');
    const truth = twistGroundTruth(next);
    expect(truth.facts.some((fact) => fact.object === 'org:front-dockside-fire')).toBe(false);
    expect(truth.facts.some((fact) => fact.object === 'org:cell-dockside-fire-action')).toBe(true);
    const rumours = falseFlagRumours(next);
    expect(rumours).toHaveLength(1);
    expect(rumours[0]?.asserts[0]?.id).toBe(propId);
  });

  it('rewrites an inside man to the hostile service while they still present as station', () => {
    const clerk = {
      id: 'npc:clerk' as NpcId,
      apparentAllegiance: 'neutral',
      trueAllegiance: asTruth({ org: 'org:station' }),
    } as Npc;
    const planted = plot({
      kind: 'inside-man',
      facadeStages: [],
      inside: 'npc:clerk',
      trueAllegiance: 'hostile',
      apparentAllegiance: 'station',
      propositions: ['REPORTS_TO'],
    });
    const next = materialiseTwists(world([planted], clerk));
    const npc = next.npcs['npc:clerk' as NpcId];
    expect(npc?.apparentAllegiance).toBe('station');
    expect(revealTruth(npc?.trueAllegiance ?? asTruth({ org: 'org:station' })).org).toBe(HOSTILE_ORG_ID);
    const truth = twistGroundTruth(next);
    expect(truth.allegiances[0]?.allegiance.org).toBe(HOSTILE_ORG_ID);
    expect(truth.facts.map((fact) => fact.predicate).sort()).toEqual(['MEMBER_OF', 'REPORTS_TO']);
  });

  it('leaves an edition unchanged when there is no false-flag rumour', () => {
    const composed: ComposedDocument = {
      document: {
        id: docId('newspaper', 'day-1'),
        kind: 'newspaper',
        title: 'The paper',
        date: { day: 1, phase: 0 },
        body: 'Quiet.',
        asserts: [],
      },
      propositions: [],
    };
    expect(withFalseFlagRumour(composed, [])).toBe(composed);
  });
});
