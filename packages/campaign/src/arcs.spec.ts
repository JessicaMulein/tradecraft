/**
 * Arc engine: bindings, condition checks, stage advance, and active threads.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createPrng } from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import {
  activeArcThreads,
  advanceArcs,
  conditionHolds,
  initArcs,
  type ArcFacts,
} from './arcs.js';
import { campaignContent } from './content/library.js';
import { campaignSources, loadCampaignContent } from './content/load.js';
import type { ArcThreadTemplate } from './content/schemas.js';
import type { CampaignTruth, CarryClaim } from './state.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CORE = join(ROOT, 'packages', 'content', 'packs', 'core');

const loaded = loadCampaignContent([CORE], ['core']);
if (!loaded.ok) {
  throw new Error(loaded.errors.map((error) => error.message).join('; '));
}
const content = campaignContent(loaded.value, campaignSources([CORE], new Set(['core'])).sources);

function facts(patch: Partial<ArcFacts> = {}): ArcFacts {
  return {
    postingIndex: 0,
    year: 1948,
    service: 'svc-east',
    rank: 'case-officer',
    notoriety: 0,
    heldClaims: [],
    presentClues: [],
    roster: {},
    ...patch,
  };
}

function claim(id: string): CarryClaim {
  return {
    id,
    prop: {
      id: `prop:${id}`,
      subject: 'npc:cp-1',
      predicate: 'MEMBER_OF',
      object: 'org:station',
    },
    text: id,
    relation: 'none',
  };
}

function nemesisArc(stage = 'shadow'): CampaignTruth['arcs'][string] {
  return { bindings: { nemesis: 'cp-7' }, stage, clues: {} };
}

describe('arc engine', () => {
  it('binds the mole and mints a nemesis on the campaign stream', () => {
    const first = initArcs(content.arcs, { mole: 'cp-1', hostiles: [], nextPerson: 2 }, createPrng('arcs'));
    const second = initArcs(content.arcs, { mole: 'cp-1', hostiles: [], nextPerson: 2 }, createPrng('arcs'));
    expect(second.arcs).toEqual(first.arcs);
    expect(first.arcs['mole-hunt']?.bindings.mole).toBe('cp-1');
    expect(first.arcs['nemesis']?.bindings.nemesis).toBe('cp-2');
    expect(first.nemesis).toBe('cp-2');
    expect(first.nextPerson).toBe(3);
    expect(first.arcs['nemesis']?.stage).toBe('shadow');
    expect(first.view.map((arc) => arc.id)).toEqual(['mole-hunt', 'nemesis']);

    const drawn = initArcs(
      content.arcs,
      {
        mole: 'cp-1',
        hostiles: [
          { id: 'cp-9', status: 'at-large' },
          { id: 'cp-4', status: 'at-large' },
          { id: 'cp-3', status: 'dead' },
        ],
        nextPerson: 2,
      },
      createPrng('pick'),
    );
    const again = initArcs(
      content.arcs,
      {
        mole: 'cp-1',
        hostiles: [
          { id: 'cp-9', status: 'at-large' },
          { id: 'cp-4', status: 'at-large' },
          { id: 'cp-3', status: 'dead' },
        ],
        nextPerson: 2,
      },
      createPrng('pick'),
    );
    expect(again.arcs['nemesis']?.bindings.nemesis).toBe(drawn.arcs['nemesis']?.bindings.nemesis);
    expect(['cp-4', 'cp-9']).toContain(drawn.arcs['nemesis']?.bindings.nemesis);
    expect(drawn.arcs['nemesis']?.bindings.nemesis).not.toBe('cp-3');
  });

  it('advances from a held clue, and a truth clue does not satisfy clue-held in that fold', () => {
    const template = content.arcs.find((arc) => arc.id === 'nemesis');
    if (template === undefined) {
      throw new Error('missing nemesis arc');
    }
    const open = { nemesis: nemesisArc() };
    const held = advanceArcs(open, [template], facts({ heldClaims: [claim('nemesis-identified')] }));
    expect(held['nemesis']?.stage).toBe('duel');
    expect(held['nemesis']?.clues['nemesis-identified']).toBe(true);
    expect(conditionHolds(
      { kind: 'stage-done', stage: 'shadow' },
      template,
      held['nemesis'] ?? nemesisArc(),
      facts(),
    )).toBe(true);

    const present = advanceArcs(
      open,
      [template],
      facts({ presentClues: [{ clue: 'nemesis-identified', present: true }] }),
    );
    expect(present['nemesis']?.stage).toBe('shadow');
    expect(present['nemesis']?.clues['nemesis-identified']).toBe(true);
    expect(advanceArcs(open, [template], facts())).toBe(open);
  });

  it('injects the active stage thread and drops a resolved arc and a cell slot', () => {
    const started = initArcs(content.arcs, { mole: 'cp-1', hostiles: [], nextPerson: 2 }, createPrng('arcs'));
    const quiet = activeArcThreads(started.arcs, content.arcs, content.arcThreads, facts());
    expect(quiet.map((thread) => thread.template)).toEqual(['mole-rumour']);
    expect(quiet[0]).toMatchObject({
      arc: 'mole-hunt',
      bindings: { visitor: 'cp-1' },
      clues: [{ id: 'mole-access' }],
      priority: 1,
    });

    const arcs: CampaignTruth['arcs'] = {
      ...started.arcs,
      nemesis: {
        bindings: { nemesis: 'cp-2' },
        stage: 'shadow',
        clues: {},
      },
    };
    const placed = activeArcThreads(
      arcs,
      content.arcs,
      content.arcThreads,
      facts({
        postingIndex: 1,
        service: 'svc-east',
        roster: { 'cp-2': { status: 'at-large', service: 'svc-east' } },
      }),
    );
    expect(placed.map((thread) => thread.template)).toEqual(['nemesis-shadow', 'mole-rumour']);
    expect(placed[0]?.bindings).toEqual({ rival: 'cp-2' });

    const resolved = activeArcThreads(
      arcs,
      content.arcs,
      content.arcThreads,
      facts({
        postingIndex: 1,
        service: 'svc-east',
        roster: { 'cp-2': { status: 'dead', service: 'svc-east' } },
      }),
    );
    expect(resolved.map((thread) => thread.template)).toEqual(['mole-rumour']);

    const planted = {
      id: 'planted',
      roleSlots: [
        { id: 'insider', archetypes: ['cell'] },
        { id: 'visitor', archetypes: ['station-clerk'] },
      ],
      slots: [
        { id: 'insider', binding: 'mole' },
        { id: 'visitor', binding: 'mole' },
      ],
      clues: [{ id: 'mole-access', prop: 'KNOWS' }],
    } as ArcThreadTemplate;
    const mole = content.arcs.find((arc) => arc.id === 'mole-hunt');
    if (mole === undefined) {
      throw new Error('missing mole-hunt arc');
    }
    const rewritten = {
      ...mole,
      stages: mole.stages.map((stage, index) => (index === 0 ? { ...stage, thread: 'planted' } : stage)),
    };
    const filtered = activeArcThreads(started.arcs, [rewritten], [planted], facts());
    expect(filtered[0]?.bindings).toEqual({ visitor: 'cp-1' });
    expect(filtered[0]?.bindings).not.toHaveProperty('insider');
  });

  it('checks year, rank, and notoriety against the posting', () => {
    const template = content.arcs[0];
    if (template === undefined) {
      throw new Error('missing arc');
    }
    const arc = { bindings: {}, stage: template.stages[0]?.id ?? 'shadow', clues: {} };
    expect(conditionHolds({ kind: 'year-between', from: 1950, to: 1955 }, template, arc, facts({ year: 1952 }))).toBe(true);
    expect(conditionHolds({ kind: 'year-between', from: 1950, to: 1955 }, template, arc, facts({ year: 1949 }))).toBe(false);
    expect(conditionHolds({ kind: 'rank-at-least', rank: 'chief-of-station' }, template, arc, facts())).toBe(false);
    expect(
      conditionHolds({ kind: 'rank-at-least', rank: 'chief-of-station' }, template, arc, facts({ rank: 'controller' })),
    ).toBe(true);
    expect(conditionHolds({ kind: 'notoriety-at-least', value: 0.5 }, template, arc, facts({ notoriety: 0.5 }))).toBe(true);
    expect(conditionHolds({ kind: 'notoriety-at-least', value: 0.5 }, template, arc, facts({ notoriety: 0.49 }))).toBe(false);
  });
});
