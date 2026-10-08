/**
 * Archive, Officer, Known Enemies, Campaign End and load errors (task 13.2).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { ArchiveView, KnownEnemyView, OfficerView } from '@tradecraft/player-view';

import {
  ArchiveScreen,
  CampaignEndScreen,
  CampaignLoadErrorScreen,
  KnownEnemiesScreen,
  OfficerScreen,
} from './career-screens.js';

afterEach(() => {
  cleanup();
});

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
    { faction: 'security', band: 'warm' },
    { faction: 'political', band: 'cold' },
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
        unidentified: [
          { person: 'unk:1', descriptor: 'a tall clerk', sightings: [{ city: 'east', year: 1948 }] },
        ],
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
  debriefs: [
    { outcome: 'success', cause: 'plot', sections: [{ id: 'plot', text: 'The cell was broken.' }] },
  ],
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
  {
    person: 'unk:2',
    label: 'a grey coat',
    kind: 'observed',
    aliases: [],
    contacts: [{ city: 'west', year: 1949 }],
  },
];

describe('career screens', () => {
  it('shows the timeline, the redacted debrief and the read-only case file', () => {
    const { lastFrame } = render(<ArchiveScreen archive={archive} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Posting 1  east  1948  case-officer  lg-1  success');
    expect(frame).toContain('plot: The posting ended.');
    expect(frame).toContain('plot: [redacted redact-1]');
    expect(frame).toContain('Case file cf-1');
    expect(frame).toContain('Helen');
    expect(frame).toContain('a tall clerk');
    expect(frame).toContain('Helen is a member of the station.');
    expect(frame).toContain('She asked for a meeting.');
    expect(frame).toContain('The cell was broken.');
  });

  it('shows rank, skills, traits, stress, observed burns, standing and reputation', () => {
    const { lastFrame } = render(<OfficerScreen officer={officer} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Ada  case-officer');
    expect(frame).toContain('Standing 3');
    expect(frame).toContain('Stress 20');
    expect(frame).toContain('cryptanalysis  level 2  xp 4');
    expect(frame).toContain('german  level 1  xp 0');
    expect(frame).toContain('strained');
    expect(frame).toContain('Helen  clerk  posting 1  official');
    expect(frame).not.toContain('Helen  clerk  posting 1  official  burned');
    expect(frame).toContain('Marta  journalist  posting 2  non-official  burned');
    expect(frame).toContain('political  cold');
    expect(frame).toContain('security  warm');
  });

  it('lists identified and observed enemies with where they were met', () => {
    const { lastFrame } = render(<KnownEnemiesScreen enemies={enemies} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Viktor  identified  security  east 1948');
    expect(frame).toContain('a grey coat  observed  west 1949');
  });

  it('shows the end type, final rank, timeline and full reveal', () => {
    const { lastFrame } = render(
      <CampaignEndScreen
        end={{ kind: 'disgrace', year: 1951, posting: 2, cause: 'The board dismissed Ada.', rank: 'case-officer' }}
        archive={archive}
      />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Campaign end  Disgrace');
    expect(frame).toContain('Final rank case-officer');
    expect(frame).toContain('1951, after posting 2');
    expect(frame).toContain('The board dismissed Ada.');
    expect(frame).toContain('Posting 1  east  1948');
    expect(frame).toContain('The cell was broken.');
  });

  it('names each campaign load error and leaves the career unopened', () => {
    const errors = [
      {
        error: { kind: 'campaign-version' as const, saved: 4, supported: 1 },
        text: 'This save is version 4. This career reads version 1.',
      },
      {
        error: { kind: 'migration-failed' as const, from: 1, issues: ['missing officer'] },
        text: 'Migration from version 1 failed. missing officer',
      },
      {
        error: { kind: 'hash-mismatch' as const, file: 'campaign.json' },
        text: 'The save file campaign.json does not match its recorded hash.',
      },
      {
        error: {
          kind: 'manifest-mismatch' as const,
          differing: [{ id: 'core', saved: '1', loaded: '2' }],
        },
        text: 'The posting was saved under different content. core (saved 1, loaded 2)',
      },
    ];
    for (const row of errors) {
      const { lastFrame } = render(<CampaignLoadErrorScreen error={row.error} />);
      const frame = lastFrame() ?? '';
      expect(frame).toContain(row.text);
      expect(frame).toContain('The open career is unchanged.');
      cleanup();
    }
  });
});
