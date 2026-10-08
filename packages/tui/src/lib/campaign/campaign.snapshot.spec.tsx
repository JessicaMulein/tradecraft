/**
 * Snapshot tests for the campaign screens (task 13.3). Each screen is rendered
 * with ink-testing-library from a fixed fixture. Colour codes are stripped so
 * the frame is the same in a local run and in CI.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type {
  ArchiveView,
  CampaignChoice,
  HqOptionView,
  HqStepView,
  KnownEnemyView,
  OfficerView,
} from '@tradecraft/player-view';

import { CreationScreen, type CampaignBackground } from './creation.js';
import { HqScreen } from './hq-screen.js';
import {
  ArchiveScreen,
  CampaignEndScreen,
  CampaignLoadErrorScreen,
  KnownEnemiesScreen,
  OfficerScreen,
} from './career-screens.js';

function plain(frame: string | undefined): string {
  // eslint-disable-next-line no-control-regex
  return (frame ?? '').replace(/\u001B\[[0-9;]*m/g, '');
}

afterEach(() => {
  cleanup();
});

const backgrounds: readonly CampaignBackground[] = [
  { id: 'analyst', label: 'Analyst' },
  { id: 'field-officer', label: 'Field officer' },
];

function hq(kind: HqStepView['kind'], extra: Partial<HqStepView> = {}): HqStepView {
  return {
    kind,
    offers: [],
    staged: { assets: [], endOffers: [] },
    pendingRequisitions: [],
    arcs: [],
    trainingUsed: 0,
    ...extra,
  };
}

function choice(choice: CampaignChoice, allowed: boolean, reason = '', cost = 0): HqOptionView {
  return { choice, quote: { allowed, reason, cost } };
}

const officer: OfficerView = {
  name: 'Ada',
  background: 'analyst',
  rank: 'case-officer',
  skills: { cryptanalysis: { level: 2, xp: 4 }, german: { level: 1, xp: 0 } },
  traits: ['strained'],
  stress: 20,
  legends: [
    { id: 'lg-1', cover: 'clerk', name: 'Helen', official: true, posting: 1, burned: false },
    { id: 'lg-2', cover: 'journalist', name: 'Marta', official: false, posting: 2, burned: true },
  ],
  careerStanding: 3,
  factions: [
    { faction: 'political', band: 'cold' },
    { faction: 'security', band: 'warm' },
  ],
};

const archive: ArchiveView = {
  revealed: true,
  timeline: [
    {
      index: 0,
      city: 'east',
      year: 1948,
      legend: 'lg-1',
      rank: 'case-officer',
      outcome: 'success',
      debrief: {
        sections: [
          {
            id: 'plot',
            items: [
              { kind: 'shown', item: { text: 'The posting ended.' } },
              { kind: 'redacted', ref: 'redact-1' },
            ],
          },
        ],
      },
      caseFile: {
        ref: 'cf-1',
        identified: [{ person: 'cp-100', name: 'Helen', aliases: [] }],
        unidentified: [{ person: 'unk:1', descriptor: 'a tall clerk', sightings: [] }],
        heldClaims: [
          {
            id: 'claim-1',
            prop: { id: 'prop-1', subject: 'npc:helen', predicate: 'MEMBER_OF', object: 'org:station' },
            text: 'Helen is a member of the station.',
            relation: 'none',
          },
        ],
        grades: [],
        notes: [{ seq: 1, at: { day: 4, phase: 1 }, attachTo: 1, text: 'She asked for a meeting.' }],
      },
    },
  ],
  debriefs: [{ outcome: 'success', cause: 'plot', sections: [{ id: 'plot', text: 'The cell was broken.' }] }],
};

const enemies: readonly KnownEnemyView[] = [
  {
    person: 'cp-9',
    label: 'Viktor',
    kind: 'identified',
    aliases: [],
    apparentAffiliation: 'security',
    contacts: [{ city: 'east', year: 1948 }],
  },
];

describe('campaign screen snapshots', () => {
  it('creation', () => {
    const { lastFrame } = render(
      <CreationScreen
        backgrounds={backgrounds}
        defaults={{ seed: 'career-seed', name: 'Ada' }}
        onCreate={vi.fn()}
      />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "New Career

      > Seed: career-seed
        Difficulty: standard
        Officer: Ada
        Background: Analyst
        Start year: 1948

      ↑/↓ move · ←/→ change · type the seed and name · Enter to begin"
    `);
  });

  it('headquarters debrief', () => {
    const { lastFrame } = render(
      <HqScreen
        step={hq('debrief')}
        officerName="Ada"
        year={1949}
        options={[choice({ kind: 'advance' }, true)]}
        onChoose={vi.fn()}
      />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Debrief — Ada, 1949

      The posting is closed. Continue when the debrief has been read.

      > Continue — allowed (cost 0)

      ↑/↓ move · Enter to choose"
    `);
  });

  it('headquarters review', () => {
    const { lastFrame } = render(
      <HqScreen
        step={hq('review', {
          staged: {
            assets: [],
            endOffers: [],
            review: { score: 4, decision: 'promote', text: 'The board promotes Ada.' },
          },
        })}
        officerName="Ada"
        year={1949}
        options={[choice({ kind: 'advance' }, true)]}
        onChoose={vi.fn()}
      />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Review Board — Ada, 1949

      The board promotes Ada. (promote, score 4)

      > Continue — allowed (cost 0)

      ↑/↓ move · Enter to choose"
    `);
  });

  it('headquarters capture', () => {
    const { lastFrame } = render(
      <HqScreen
        step={hq('capture', {
          staged: {
            assets: [],
            endOffers: [],
            capture: { kind: 'imprisonment', yearsLost: 2, defectionOffer: true },
          },
        })}
        options={[choice({ kind: 'advance' }, true)]}
        onChoose={vi.fn()}
      />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Capture

      imprisonment, 2 years lost. Defection is offered.

      > Continue — allowed (cost 0)

      ↑/↓ move · Enter to choose"
    `);
  });

  it('headquarters assets', () => {
    const { lastFrame } = render(
      <HqScreen
        step={hq('assets', {
          staged: {
            assets: [{ id: 'cp-100', name: 'Helen', rapport: 'warm', history: 'east, 1948' }],
            endOffers: [],
          },
        })}
        options={[choice({ kind: 'asset-decision', asset: 'cp-100', decision: 'handover' }, true)]}
        onChoose={vi.fn()}
      />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Asset decisions

      Helen — warm. east, 1948

      > Hand over Helen — allowed (cost 0)

      ↑/↓ move · Enter to choose"
    `);
  });

  it('headquarters arcs and accusation', () => {
    const { lastFrame } = render(
      <HqScreen
        step={hq('arcs', { arcs: [{ id: 'mole-hunt', stage: 'suspect', status: 'active' }] })}
        options={[
          choice({ kind: 'advance' }, true),
          choice({ kind: 'accuse', figure: 'cp-1' }, false, 'The archive does not support that accusation.'),
        ]}
        onChoose={vi.fn()}
      />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Arc events

      mole-hunt: suspect (active)

      > Continue — allowed (cost 0)
        Accuse cp-1 — refused — The archive does not support that accusation. (cost 0)

      ↑/↓ move · Enter to choose"
    `);
  });

  it('headquarters offers', () => {
    const { lastFrame } = render(
      <HqScreen
        step={hq('offers', {
          offers: [
            {
              id: 'offer-east',
              city: 'east',
              service: 'svc-east',
              year: 1949,
              tourYears: 2,
              tier: 'quiet',
              theme: 'penetrate',
              assigned: true,
            },
          ],
        })}
        options={[choice({ kind: 'accept-offer', offer: 'offer-east' }, true)]}
        onChoose={vi.fn()}
      />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Posting offers

      east · svc-east · 1949 · quiet · penetrate · assigned

      > Accept east (quiet, 1949) — allowed (cost 0)

      ↑/↓ move · Enter to choose"
    `);
  });

  it('headquarters preparation', () => {
    const { lastFrame } = render(
      <HqScreen
        step={hq('prepare', { pendingRequisitions: ['budget-credit'], trainingUsed: 1 })}
        alerts={['Medical leave is required.']}
        options={[
          choice({ kind: 'requisition', id: 'budget-credit' }, true, '', 2),
          choice({ kind: 'train', skill: 'german' }, false, 'Training is already spent.'),
          choice({ kind: 'leave' }, true),
          choice({ kind: 'legend', cover: 'clerk', name: 'Helen' }, true),
        ]}
        onChoose={vi.fn()}
      />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Preparation

      Training used 1. Requisitions: budget-credit. Choose a legend before departure.

      Medical leave is required.

      > Requisition budget-credit — allowed (cost 2)
        Train german — refused — Training is already spent. (cost 0)
        Take leave — allowed (cost 0)
        Legend clerk as Helen — allowed (cost 0)

      ↑/↓ move · Enter to choose"
    `);
  });

  it('headquarters end offers', () => {
    const { lastFrame } = render(
      <HqScreen
        step={hq('end-offers', { staged: { assets: [], endOffers: ['retire'] } })}
        options={[
          choice({ kind: 'retire' }, true),
          choice({ kind: 'decline-end-offer' }, true),
        ]}
        onChoose={vi.fn()}
      />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "End offers

      No postings are on offer.

      > Retire — allowed (cost 0)
        Decline and see other postings — allowed (cost 0)

      ↑/↓ move · Enter to choose"
    `);
  });

  it('archive', () => {
    const { lastFrame } = render(<ArchiveScreen archive={archive} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Archive

      Posting 1  east  1948  case-officer  lg-1  success

      Debrief
      plot: The posting ended.
      plot: [redacted redact-1]

      Case file
      Case file cf-1
        Helen
        a tall clerk
        Helen is a member of the station.
        She asked for a meeting.

      Full reveal
      success (plot)
      plot: The cell was broken."
    `);
  });

  it('officer', () => {
    const { lastFrame } = render(<OfficerScreen officer={officer} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Ada  case-officer
      Standing 3
      Stress 20

      Skills
      cryptanalysis  level 2  xp 4
      german  level 1  xp 0

      Traits
      strained

      Legends
      Helen  clerk  posting 1  official
      Marta  journalist  posting 2  non-official  burned

      Reputation
      political  cold
      security  warm"
    `);
  });

  it('known enemies', () => {
    const { lastFrame } = render(<KnownEnemiesScreen enemies={enemies} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Known enemies

      Viktor  identified  security  east 1948"
    `);
  });

  it('campaign end', () => {
    const { lastFrame } = render(
      <CampaignEndScreen
        end={{ kind: 'disgrace', year: 1951, posting: 2, cause: 'The board dismissed Ada.', rank: 'case-officer' }}
        archive={archive}
      />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Campaign end  Disgrace
      Final rank case-officer
      1951, after posting 2
      The board dismissed Ada.

      Archive

      Posting 1  east  1948  case-officer  lg-1  success

      Debrief
      plot: The posting ended.
      plot: [redacted redact-1]

      Case file
      Case file cf-1
        Helen
        a tall clerk
        Helen is a member of the station.
        She asked for a meeting.

      Full reveal
      success (plot)
      plot: The cell was broken."
    `);
  });

  it('load error campaign-version', () => {
    const { lastFrame } = render(
      <CampaignLoadErrorScreen error={{ kind: 'campaign-version', saved: 4, supported: 1 }} />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Career not loaded
      This save is version 4. This career reads version 1.
      The open career is unchanged."
    `);
  });

  it('load error migration-failed', () => {
    const { lastFrame } = render(
      <CampaignLoadErrorScreen error={{ kind: 'migration-failed', from: 1, issues: ['missing officer'] }} />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Career not loaded
      Migration from version 1 failed. missing officer
      The open career is unchanged."
    `);
  });

  it('load error hash-mismatch', () => {
    const { lastFrame } = render(
      <CampaignLoadErrorScreen error={{ kind: 'hash-mismatch', file: 'campaign.json' }} />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Career not loaded
      The save file campaign.json does not match its recorded hash.
      The open career is unchanged."
    `);
  });

  it('load error manifest-mismatch', () => {
    const { lastFrame } = render(
      <CampaignLoadErrorScreen
        error={{ kind: 'manifest-mismatch', differing: [{ id: 'core', saved: '1', loaded: '2' }] }}
      />,
    );
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Career not loaded
      The posting was saved under different content. core (saved 1, loaded 2)
      The open career is unchanged."
    `);
  });
});
