/**
 * Campaign View projections: officer, archive, known enemies, and the HQ step.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { ArchiveVisibleEntry, CampaignView, Officer, PlayerCarry } from './state.js';
import {
  archiveView,
  campaignView,
  hqStepView,
  knownEnemiesView,
  officerView,
} from './view.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function officer(): Officer {
  return {
    name: 'Ada',
    background: 'analyst',
    rank: 'case-officer',
    skills: { german: { level: 1, xp: 3 } },
    traits: ['strained'],
    stress: 20,
    reprimands: 0,
    legends: [
      {
        id: 'lg-1',
        cover: 'clerk',
        name: 'Helen',
        official: true,
        posting: 0,
        observedBurnedBy: ['svc-east'],
      },
      {
        id: 'lg-2',
        cover: 'clerk',
        name: 'Irene',
        official: true,
        posting: 1,
        observedBurnedBy: [],
      },
    ],
    careerStanding: 4,
    careerPoints: 2,
    factions: { security: 2, operations: 0, registry: -1 },
  };
}

function carry(over: Partial<PlayerCarry> = {}): PlayerCarry {
  return {
    identified: [],
    unidentified: [],
    heldClaims: [],
    grades: [],
    notes: [],
    observedBurns: [],
    ...over,
  };
}

function entry(over: Partial<ArchiveVisibleEntry> = {}): ArchiveVisibleEntry {
  return {
    index: 0,
    city: 'vienna',
    year: 1948,
    legend: 'lg-1',
    rankAtStart: 'case-officer',
    outcome: 'success',
    redacted: { sections: [{ id: 'plot', items: [{ kind: 'redacted', ref: 'redact:1' }] }] },
    stats: {
      decrypts: 0,
      recruits: 0,
      turned: 0,
      surveilObservations: 0,
      followsCompleted: 0,
      arrestsCorrect: 0,
      arrestsWrongful: 0,
      madeFactLines: 0,
      meetingsHeld: 0,
      dropsServiced: 0,
    },
    carry: carry(),
    caseFileRef: 'case-file:0',
    plotTemplate: 'rail-junction',
    plots: [],
    ...over,
  };
}

function view(): CampaignView {
  return {
    officer: officer(),
    offers: [],
    pendingRequisitions: ['language-course'],
    trainingUsed: 1,
    chosen: 'offer-1',
    staged: { assets: [], endOffers: [], accusation: { text: 'You named the wrong officer.' } },
    hqCast: [],
    arcs: [{ id: 'nemesis', stage: 'shadow', status: 'active' }],
    unk: {},
  };
}

describe('campaign view projections', () => {
  it('keeps the renderable campaign and the HQ step free of hidden records', () => {
    const current = view();
    expect(campaignView({ view: current })).toBe(current);
    expect(hqStepView({ step: { kind: 'assets' }, view: current })).toEqual({
      kind: 'assets',
      offers: [],
      staged: current.staged,
      pendingRequisitions: ['language-course'],
      arcs: current.arcs,
      trainingUsed: 1,
      chosen: 'offer-1',
    });
  });

  it('marks a legend burned only from observed burns, and bands faction reputation', () => {
    const shown = officerView({
      officer: officer(),
      carries: [carry({ observedBurns: ['lg-1'] })],
    });
    expect(shown.rank).toBe('case-officer');
    expect(shown.skills.german).toEqual({ level: 1, xp: 3 });
    expect(shown.traits).toEqual(['strained']);
    expect(shown.stress).toBe(20);
    expect(shown.careerStanding).toBe(4);
    expect(shown.legends.map((legend) => [legend.id, legend.burned])).toEqual([
      ['lg-1', true],
      ['lg-2', false],
    ]);
    expect(shown.factions).toEqual([
      { faction: 'operations', band: 'neutral' },
      { faction: 'registry', band: 'cold' },
      { faction: 'security', band: 'trusted' },
    ]);
    const text = JSON.stringify(shown);
    expect(text).not.toContain('observedBurnedBy');
    expect(text).not.toContain('svc-east');
    expect(text).not.toContain('hostileControlled');
  });

  it('shows redacted debriefs and read-only case files until the reveal', () => {
    const open = archiveView({
      archive: {
        visible: [
          entry({
            carry: carry({
              identified: [{ person: 'cp-7', name: 'Bruno', aliases: ['B'] }],
            }),
          }),
        ],
      },
    });
    expect(open.revealed).toBe(false);
    expect(open.debriefs).toBeUndefined();
    expect(open.arcs).toBeUndefined();
    expect(open.timeline).toEqual([
      {
        index: 0,
        city: 'vienna',
        year: 1948,
        legend: 'lg-1',
        rank: 'case-officer',
        outcome: 'success',
        debrief: { sections: [{ id: 'plot', items: [{ kind: 'redacted', ref: 'redact:1' }] }] },
        caseFile: {
          ref: 'case-file:0',
          identified: [{ person: 'cp-7', name: 'Bruno', aliases: ['B'] }],
          unidentified: [],
          heldClaims: [],
          grades: [],
          notes: [],
        },
      },
    ]);
    expect(JSON.stringify(open)).not.toContain('hqMole');

    const closed = archiveView({
      archive: {
        visible: [entry()],
        reveal: {
          debriefs: [{ outcome: 'success', cause: 'plot', sections: [{ id: 'plot', text: 'The full plot.' }] }],
          hqMole: 'cp-3',
          arcs: {
            nemesis: { bindings: { nemesis: 'cp-3' }, stage: 'duel', clues: {} },
          },
          dossiers: {},
        },
      },
    });
    expect(closed.revealed).toBe(true);
    expect(closed.debriefs?.[0]?.sections[0]?.text).toBe('The full plot.');
    expect(closed.arcs?.nemesis?.stage).toBe('duel');
    expect(closed.timeline[0]?.debrief.sections[0]?.items[0]).toEqual({ kind: 'redacted', ref: 'redact:1' });
    const revealed = JSON.stringify(closed);
    expect(revealed).not.toContain('hqMole');
    expect(revealed).not.toContain('dossiers');
  });

  it('lists only persons who appear in a Player Carry', () => {
    const enemies = knownEnemiesView({
      archive: {
        visible: [
          entry({
            city: 'vienna',
            year: 1948,
            carry: carry({
              identified: [{ person: 'cp-7', name: 'Bruno', aliases: [], apparentAffiliation: 'org:cafe' }],
              unidentified: [
                { person: 'face-1', descriptor: 'a grey coat', sightings: [{ city: 'lisbon', year: 1947 }] },
              ],
            }),
          }),
          entry({
            index: 1,
            city: 'lisbon',
            year: 1950,
            carry: carry({
              identified: [{ person: 'cp-7', name: 'Bruno', aliases: [] }],
              unidentified: [
                {
                  person: 'face-1',
                  descriptor: 'a grey coat',
                  sightings: [
                    { city: 'lisbon', year: 1947 },
                    { city: 'vienna', year: 1949 },
                  ],
                },
              ],
            }),
          }),
        ],
      },
    });
    expect(enemies).toEqual([
      {
        person: 'face-1',
        label: 'a grey coat',
        kind: 'observed',
        aliases: [],
        contacts: [
          { city: 'lisbon', year: 1947 },
          { city: 'vienna', year: 1949 },
        ],
      },
      {
        person: 'cp-7',
        label: 'Bruno',
        kind: 'identified',
        aliases: [],
        apparentAffiliation: 'org:cafe',
        contacts: [
          { city: 'vienna', year: 1948 },
          { city: 'lisbon', year: 1950 },
        ],
      },
    ]);
  });

  it('does not mention a truth field in the view entry', () => {
    const source = readFileSync(join(HERE, 'view.ts'), 'utf8');
    expect(source).not.toContain('.truth');
    expect(source).toContain('export function officerView');
    expect(source).toContain('export function knownEnemiesView');
  });
});
