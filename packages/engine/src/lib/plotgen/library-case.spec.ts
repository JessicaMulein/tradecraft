import { describe, expect, it } from 'vitest';

import { asTruth, type NpcId, type Proposition } from '../model/core.js';
import type { PlotState } from '../city/plot.js';
import type { WorldState } from '../model/state.js';
import { CELL_ORG_ID } from '../city/principals.js';
import { applyLibraryCase, buildLibraryCase } from './library-case.js';

const LEADER = 'npc:leader' as NpcId;
const ANNA = 'npc:anna' as NpcId;
const BORIS = 'npc:boris' as NpcId;

function npc(id: NpcId): WorldState['npcs'][NpcId] {
  return { id, org: CELL_ORG_ID } as WorldState['npcs'][NpcId];
}

function plot(): PlotState {
  return {
    template: 'sample',
    status: 'running',
    roles: [],
    materielSlots: [],
    targetSlots: [],
    materiel: asTruth('item:case' as never),
    leader: asTruth(LEADER),
    target: asTruth('org:cell' as never),
    abortPressure: 0,
    pressureKeys: [],
    materielSeized: false,
    stages: [
      {
        id: 'survey' as never,
        templateId: 'survey',
        requires: [],
        produces: [],
        deadline: { day: 12, phase: 0 },
        onDisrupted: { delay: 1, reroute: 0, abort: 0 },
        status: 'pending',
        traces: [
          {
            index: 0,
            kind: 'meeting',
            participants: [LEADER],
            place: { kind: 'loc', loc: 'loc:cafe' as never },
            evidences: ['LOCATED_AT'],
            template: 'They meet.',
          },
          {
            index: 1,
            kind: 'transmission',
            participants: [],
            channelKind: 'radio',
            evidences: ['LOCATED_AT'],
            template: 'A call.',
          },
        ],
      },
    ],
  };
}

function world(): Pick<WorldState, 'plots' | 'plot' | 'npcs'> {
  return {
    plots: [{ id: 'plot:sample' } as never],
    plot: plot(),
    npcs: { [LEADER]: npc(LEADER), [ANNA]: npc(ANNA), [BORIS]: npc(BORIS) },
  };
}

describe('library case', () => {
  it('states the leader plan and a meeting the brief and the radio can share', () => {
    const built = buildLibraryCase(world(), []);
    expect(built).toBeDefined();
    if (built === undefined) {
      return;
    }
    const predicates = built.brief.map((prop) => `${prop.predicate}:${prop.subject}`);
    expect(predicates).toContain(`MEMBER_OF:${LEADER}`);
    expect(predicates).toContain(`PLANS:${LEADER}`);
    const meet = built.brief.find((prop) => prop.predicate === 'MEETS_AT');
    expect(meet?.subject).toBe(LEADER);
    expect(meet?.place).toBe('loc:cafe');
    expect(built.extra.map((prop) => prop.id).every((id) => id.startsWith('prop:library-case/'))).toBe(true);
    const meeting = built.plot.stages[0]?.traces[0];
    expect(meeting?.participants).toContain(LEADER);
    expect(meeting?.participants).toContain(meet?.object);
    expect(meeting?.place).toEqual({ kind: 'loc', loc: 'loc:cafe' });
    expect(meeting?.evidences).toContain('MEETS_AT');
    const radio = built.plot.stages[0]?.traces[1];
    expect(radio?.evidences).toContain('MEETS_AT');
    expect(radio?.participants).toContain(LEADER);
  });

  it('reuses a meeting the cell already carries instead of naming a second place', () => {
    const held: Proposition = {
      id: 'prop:know/cell/meet' as never,
      subject: LEADER,
      predicate: 'MEETS_AT',
      object: ANNA,
      place: 'loc:drop' as never,
    };
    const plans: Proposition = {
      id: 'prop:know/cell/plan' as never,
      subject: LEADER,
      predicate: 'PLANS',
      object: { kind: 'text', value: 'the operation' },
    };
    const built = buildLibraryCase(
      {
        plots: [{ id: 'plot:sample' } as never],
        plot: plot(),
        npcs: { [LEADER]: npc(LEADER), [ANNA]: npc(ANNA) },
      },
      [held, plans],
    );
    expect(built).toBeDefined();
    if (built === undefined) {
      return;
    }
    const meet = built.brief.find((prop) => prop.predicate === 'MEETS_AT');
    expect(meet?.id).toBe(held.id);
    expect(meet?.place).toBe('loc:drop');
    expect(built.extra.some((prop) => prop.predicate === 'MEETS_AT')).toBe(false);
    expect(built.extra.some((prop) => prop.predicate === 'PLANS')).toBe(false);
    expect(built.plot.stages[0]?.traces[0]?.place).toEqual({ kind: 'loc', loc: 'loc:drop' });
  });

  it('keeps the organisation the cell already belongs to', () => {
    const held: Proposition = {
      id: 'prop:know/cell/member' as never,
      subject: LEADER,
      predicate: 'MEMBER_OF',
      object: 'org:cell-sample-action',
    };
    const built = buildLibraryCase(world(), [held]);
    expect(built).toBeDefined();
    if (built === undefined) {
      return;
    }
    const membership = built.brief.find((prop) => prop.predicate === 'MEMBER_OF' && prop.subject === LEADER);
    expect(membership?.object).toBe('org:cell-sample-action');
    expect(membership?.id.startsWith('prop:library-case/')).toBe(true);
  });

  it('leaves a core game alone', () => {
    const core = {
      plots: undefined,
      plot: plot(),
      npcs: { [LEADER]: npc(LEADER), [ANNA]: npc(ANNA) },
    };
    expect(buildLibraryCase(core, [])).toBeUndefined();
  });

  it('adds the case to the opening brief', () => {
    const cableId = 'doc:cable/brief' as never;
    const base = {
      plots: [{ id: 'plot:sample' } as never],
      plot: plot(),
      npcs: { [LEADER]: npc(LEADER), [ANNA]: npc(ANNA), [BORIS]: npc(BORIS) },
      documents: {
        [cableId]: {
          id: cableId,
          kind: 'cable' as const,
          title: 'Starting brief',
          date: { day: 0, phase: 0 },
          body: 'Report.',
          asserts: [],
        },
      },
      documentPropositions: {},
      player: { known: { entities: [], channels: [], drops: [] } },
      station: { knowledge: { known: [], falseBeliefs: [], knownEntities: [] } },
    };
    const next = applyLibraryCase(base as unknown as WorldState, []);
    const asserts = next.documents[cableId]?.asserts ?? [];
    expect(asserts.length).toBeGreaterThan(0);
    expect(next.player.known.entities).toContain(LEADER);
    expect(next.plot.stages[0]?.traces[0]?.evidences).toContain('MEETS_AT');
    const filed = asserts.flatMap((id) => {
      const prop = next.documentPropositions[id];
      return prop === undefined ? [] : [prop.predicate];
    });
    expect(filed).toContain('PLANS');
    expect(filed).toContain('MEETS_AT');
    expect(filed).toContain('MEMBER_OF');
  });
});
