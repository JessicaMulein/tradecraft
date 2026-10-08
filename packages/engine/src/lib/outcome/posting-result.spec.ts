/**
 * Posting Result: stats from the log and action results, carry from the view
 * and case file, redaction, and schema-1 outcome records lifted to schema 2.
 */

import { describe, expect, it } from 'vitest';

import { ARREST_LINE } from '../action/arrest.js';
import type { ActionResult } from '../action/result.js';
import { MADE_FACT_LINE } from '../action/surveil.js';
import { TURN_ACCEPT_LINE } from '../action/turn-agent.js';
import { OutcomeRecordSchema, type OutcomeRecord } from '../endings/outcome-record.js';
import type { Proposition } from '../model/core.js';
import type { ActionLogEntry } from '../model/state.js';
import {
  buildPlayerCarry,
  buildPostingResult,
  type CarryCaseFile,
  type CarryPerson,
  type CarryView,
  type PostedDebrief,
} from './posting-result.js';

function line(): ActionLogEntry {
  return { seq: 1, turn: 'turn:1', at: { day: 0, phase: 0 }, kind: 'line', text: '' } as ActionLogEntry;
}

function entry(action: object): ActionLogEntry {
  return {
    seq: 1,
    turn: 'turn:1',
    at: { day: 0, phase: 0 },
    kind: 'action',
    action,
  } as ActionLogEntry;
}

function result(patch: Partial<ActionResult> = {}): ActionResult {
  return {
    observations: [],
    factLines: [],
    scene: { loc: 'loc:desk', description: '', atmosphere: [], risk: 0, visible: [] },
    events: [],
    claimsAdded: [],
    ...patch,
  };
}

function prop(id: string, subject: string): Proposition {
  return {
    id,
    subject: subject as Proposition['subject'],
    predicate: 'KNOWS' as Proposition['predicate'],
    object: 'org:station' as Proposition['object'],
  };
}

const record = {
  schema: 1 as const,
  outcome: 'success' as const,
  endedAt: { day: 3, phase: 1 as const },
  seed: 'seed',
  generatorVersion: '0.7.0',
  content: { schema: 1, packs: [{ id: 'core', version: '1.0.0', hash: 'abc' }] },
  difficulty: 'standard',
  standing: 4,
  directives: [],
  survivingAssets: [],
  cover: { identity: 'clerk', blown: false, suspicion: 0.1 },
  hostileMemory: {
    knownCover: false,
    suspectedAssets: [],
    compromisedChannels: [],
    compromisedDrops: [],
    doctrineShift: {},
  },
  budgetRemaining: 10,
  region: { id: 'ignored' },
} as OutcomeRecord & { region?: unknown };

function person(patch: Partial<CarryPerson> & Pick<CarryPerson, 'id'>): CarryPerson {
  return {
    carryEligible: true,
    identified: true,
    name: 'Ada',
    aliases: [],
    descriptor: 'a tall clerk',
    sightings: [],
    ...patch,
  };
}

describe('posting result', () => {
  it('counts stats from the action log and action results only', () => {
    const built = buildPostingResult({
      index: 2,
      plotTemplate: 'rail-junction',
      outcome: record,
      log: [
        line(),
        entry({ kind: 'decrypt', intercept: 'int:1', submission: { kind: 'plaintext', text: 'a' } }),
        entry({ kind: 'decrypt', intercept: 'int:2', submission: { kind: 'plaintext', text: 'b' } }),
        entry({ kind: 'surveil', at: 'loc:desk', phases: 1 }),
        entry({ kind: 'follow', target: 'npc:courier' }),
        entry({ kind: 'turn-agent', npc: 'npc:clerk', lever: 'ego' }),
        entry({ kind: 'arrest', npc: 'npc:courier' }),
        entry({ kind: 'arrest', npc: 'npc:clerk' }),
        entry({ kind: 'service-drop', drop: 'drop:box', mode: 'load', items: [] }),
        entry({ kind: 'talk', npc: 'npc:clerk' }),
      ],
      results: [
        result({
          observations: [
            {
              kind: 'proposition',
              prop: prop('p1', 'npc:courier'),
              at: { day: 0, phase: 0 },
              source: { kind: 'intercept', id: 'int:1' },
            },
          ],
        }),
        result({ factLines: ['You have already broken this traffic.'] }),
        result({
          observations: [
            {
              kind: 'proposition',
              prop: prop('p2', 'npc:courier'),
              at: { day: 0, phase: 0 },
              source: { kind: 'surveillance', loc: 'loc:desk' },
            },
            {
              kind: 'proposition',
              prop: prop('p3', 'npc:clerk'),
              at: { day: 0, phase: 0 },
              source: { kind: 'surveillance', loc: 'loc:desk' },
            },
          ],
          factLines: [MADE_FACT_LINE],
        }),
        result({ factLines: ['You keep them in sight.'] }),
        result({ factLines: [TURN_ACCEPT_LINE] }),
        result({ factLines: [ARREST_LINE] }),
        result({ factLines: [ARREST_LINE] }),
        result({ events: [{ kind: 'drop-loaded' } as ActionResult['events'][number]] }),
        result({ factLines: ['You speak.'] }),
      ],
      standingStart: 10,
      standingAfter: [10, 10, 10, 10, 10, 10, 8],
      view: { persons: [], observedBurns: [] },
      caseFile: { claims: [], grades: [], notes: [] },
      debrief: { outcome: 'success', cause: 'done', sections: [] },
      protectedIds: new Set(),
      identities: {},
      hostiles: [],
      assets: [],
      arcClues: [],
      service: 'svc:east',
      cityId: 'core',
    });
    expect(built.stats).toEqual({
      decrypts: 1,
      recruits: 0,
      turned: 1,
      surveilObservations: 2,
      followsCompleted: 1,
      arrestsCorrect: 1,
      arrestsWrongful: 1,
      madeFactLines: 1,
      meetingsHeld: 0,
      dropsServiced: 1,
    });
  });

  it('builds carry from the view and case file, and keeps npc ids out of unidentified refs', () => {
    const view: CarryView = {
      persons: [
        person({ id: 'npc:ada', name: 'Ada', aliases: ['A'] }),
        person({ id: 'npc:crowd', carryEligible: false, name: 'Crowd' }),
        person({
          id: 'unk:4',
          identified: false,
          name: '',
          descriptor: 'a grey coat',
          sightings: [{ city: 'core', year: 1949 }],
        }),
      ],
      observedBurns: ['lg-1'],
    };
    const claim = {
      id: 'c1',
      prop: prop('p1', 'unk:4'),
      text: 'A grey coat was seen.',
      relation: 'none' as const,
    };
    const other = {
      id: 'c2',
      prop: prop('p2', 'npc:crowd'),
      text: 'The crowd moved.',
      relation: 'none' as const,
    };
    const caseFile: CarryCaseFile = {
      claims: [claim, other],
      grades: [{ source: 'c1', grade: 'B2' }],
      notes: [{ seq: 1, at: { day: 1, phase: 0 }, attachTo: 'c1', text: 'note' }],
    };
    const carry = buildPlayerCarry(view, caseFile);
    expect(carry.identified).toEqual([
      { person: 'npc:ada', name: 'Ada', aliases: ['A'] },
    ]);
    expect(carry.unidentified).toEqual([
      { person: 'cu-0', descriptor: 'a grey coat', sightings: [{ city: 'core', year: 1949 }] },
    ]);
    expect(JSON.stringify(carry)).not.toContain('npc:mole');
    expect(carry.heldClaims).toEqual([claim]);
    expect(carry.observedBurns).toEqual(['lg-1']);
    expect(carry.grades).toEqual(caseFile.grades);
    expect(carry.notes).toEqual(caseFile.notes);

    const shifted = buildPostingResult({
      index: 0,
      plotTemplate: 'rail-junction',
      outcome: record,
      log: [],
      results: [],
      view,
      caseFile,
      debrief: { outcome: 'success', cause: 'done', sections: [] },
      protectedIds: new Set(),
      identities: { 'unk:4': 'npc:mole' },
      hostiles: [
        { id: 'cp-1', status: 'at-large' },
        { id: 'cp-2', status: 'arrested' },
      ],
      assets: [{ person: 'cp-3', npc: 'npc:ada', rel: { access: ['files'] } }],
      arcClues: [{ clue: 'rumour', present: true }],
      service: 'svc:east',
      cityId: 'core',
    });
    const otherIdentity = buildPostingResult({
      index: 0,
      plotTemplate: 'rail-junction',
      outcome: record,
      log: [],
      results: [],
      view,
      caseFile,
      debrief: { outcome: 'success', cause: 'done', sections: [] },
      protectedIds: new Set(),
      identities: { 'unk:4': 'npc:other' },
      hostiles: [],
      assets: [],
      arcClues: [],
      service: 'svc:east',
      cityId: 'core',
    });
    expect(shifted.carry).toEqual(otherIdentity.carry);
    expect(shifted.extract.unidentified).toEqual([{ ref: 'cu-0', npc: 'npc:mole' }]);
    expect(shifted.extract.survivingHostiles).toEqual([{ id: 'cp-1', status: 'at-large' }]);
    expect(shifted.extract.assets[0]?.rel.access).toEqual(['files']);
    expect(shifted.extract.arcClues).toEqual([{ clue: 'rumour', present: true }]);
  });

  it('redacts a protected item unless the case file corroborated it', () => {
    const fact = prop('seen', 'npc:mole');
    const debrief: PostedDebrief = {
      outcome: 'success',
      cause: 'done',
      sections: [
        {
          id: 'allegiances',
          items: [
            { text: 'The clerk works for the station.', entities: ['npc:clerk'] },
            { text: 'The mole is hostile.', entities: ['npc:mole'], prop: fact },
            { text: 'The timeline ran.', entities: [] },
          ],
        },
      ],
    };
    const shown = buildPostingResult({
      index: 1,
      plotTemplate: 'rail-junction',
      outcome: record,
      log: [],
      results: [],
      view: { persons: [], observedBurns: [] },
      caseFile: {
        claims: [{ id: 'c', prop: fact, text: 'seen', relation: 'corroborated' }],
        grades: [],
        notes: [],
      },
      debrief,
      protectedIds: new Set(['npc:mole']),
      identities: {},
      hostiles: [],
      assets: [],
      arcClues: [],
      service: 'svc:east',
      cityId: 'core',
    });
    expect(shown.debrief.redacted.sections[0]?.items).toEqual([
      { kind: 'shown', item: { text: 'The clerk works for the station.' } },
      { kind: 'shown', item: { text: 'The mole is hostile.' } },
      { kind: 'shown', item: { text: 'The timeline ran.' } },
    ]);
    expect(shown.debrief.full.sections[0]?.items).toHaveLength(3);

    const hidden = buildPostingResult({
      index: 1,
      plotTemplate: 'rail-junction',
      outcome: record,
      log: [],
      results: [],
      view: { persons: [], observedBurns: [] },
      caseFile: {
        claims: [{ id: 'c', prop: fact, text: 'seen', relation: 'none' }],
        grades: [],
        notes: [],
      },
      debrief,
      protectedIds: new Set(['npc:mole']),
      identities: {},
      hostiles: [],
      assets: [],
      arcClues: [],
      service: 'svc:east',
      cityId: 'core',
    });
    expect(hidden.debrief.redacted.sections[0]?.items[1]).toEqual({
      kind: 'redacted',
      ref: 'redacted:allegiances:1',
    });
  });

  it('lifts a schema-1 outcome record to schema 2 and drops the region block', () => {
    const built = buildPostingResult({
      index: 4,
      plotTemplate: 'rail-junction',
      outcome: record,
      log: [],
      results: [],
      view: { persons: [], observedBurns: [] },
      caseFile: { claims: [], grades: [], notes: [] },
      debrief: { outcome: 'success', cause: 'done', sections: [] },
      protectedIds: new Set(),
      identities: {},
      hostiles: [],
      assets: [],
      arcClues: [],
      service: 'svc:east',
      cityId: 'core',
    });
    expect(built.plotTemplate).toBe('rail-junction');
    expect(built.plots).toEqual([
      {
        templateId: 'rail-junction',
        variantKey: 'rail-junction',
        archetype: 'rail-junction',
        role: 'primary',
        outcome: 'success',
      },
    ]);
    expect(built.outcome.schema).toBe(2);
    expect(built.outcome).not.toHaveProperty('region');
    expect(OutcomeRecordSchema.safeParse(built.outcome).success).toBe(true);

    const schema2 = {
      ...record,
      schema: 2 as const,
      plots: [
        {
          templateId: 'kept',
          variantKey: 'kept',
          archetype: 'sabotage',
          role: 'primary' as const,
          outcome: 'disrupted',
        },
      ],
      selection: { historyHash: 'abc' },
    };
    delete (schema2 as { region?: unknown }).region;
    const kept = buildPostingResult({
      index: 4,
      plotTemplate: 'rail-junction',
      outcome: schema2,
      log: [],
      results: [],
      view: { persons: [], observedBurns: [] },
      caseFile: { claims: [], grades: [], notes: [] },
      debrief: { outcome: 'success', cause: 'done', sections: [] },
      protectedIds: new Set(),
      identities: {},
      hostiles: [],
      assets: [],
      arcClues: [],
      service: 'svc:east',
      cityId: 'core',
    });
    expect(kept.plots).toEqual(schema2.plots);
    expect(kept.outcome.selection).toEqual({ historyHash: 'abc' });
  });
});
