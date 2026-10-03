/**
 * Component tests for the Ink People pane (task 22.7; design, "Player Aids":
 * "People view"; Requirement 33.4). These render the real components with
 * ink-testing-library and assert: the list shows each person by
 * name-or-descriptor with rapport and the Asset tag and the selection cursor;
 * the detail panel shows affiliation, aliases, last sighting, Asset status,
 * rapport and Claim counts; the parallel org/item lists render; and the empty
 * states render.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { PeopleView } from '@tradecraft/player-view';

import { PeopleList, PeoplePane, PersonDetail } from './people-view.js';
import type { PersonRow } from './people-list.js';

afterEach(() => {
  cleanup();
});

/** A view-safe person-row fixture. */
function person(id: string, overrides: Partial<PersonRow> = {}): PersonRow {
  return {
    id: id as PersonRow['id'],
    identified: true,
    label: `Person ${id}`,
    aliases: [],
    asset: false,
    rapport: 'neutral',
    claimsAsSubject: 0,
    claimsAsSource: 0,
    ...overrides,
  };
}

const view: PeopleView = {
  people: [
    person('npc:viktor', {
      label: 'Viktor Lang',
      apparentAffiliation: 'trade mission',
      rapport: 'warm',
      asset: true,
      aliases: ['unk:3'],
      lastSighting: { day: 2, phase: 1 },
      claimsAsSubject: 4,
      claimsAsSource: 2,
    }),
    person('unk:7', {
      identified: false,
      label: 'tall man in a grey coat',
      rapport: 'cold',
    }),
  ],
  orgs: [
    { id: 'org:mission' as never, name: 'Trade Mission', allegiance: 'hostile' },
  ],
  items: [{ id: 'item:ledger' as never, claimCount: 3 }],
};

describe('PeopleList', () => {
  it('lists each person by name-or-descriptor with rapport and Asset tag', () => {
    const { lastFrame } = render(<PeopleList view={view} selected={0} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Viktor Lang');
    expect(frame).toContain('warm');
    expect(frame).toContain('[asset]');
    expect(frame).toContain('tall man in a grey coat');
    expect(frame).toContain('cold');
  });

  it('shows the selection cursor on the selected row', () => {
    const { lastFrame } = render(<PeopleList view={view} selected={1} />);
    const lines = (lastFrame() ?? '').split('\n');
    const unkLine = lines.find((l) => l.includes('grey coat')) ?? '';
    const viktorLine = lines.find((l) => l.includes('Viktor Lang')) ?? '';
    expect(unkLine).toContain('>');
    expect(viktorLine).not.toContain('>');
  });

  it('shows a hint for an empty list', () => {
    const { lastFrame } = render(
      <PeopleList view={{ people: [], orgs: [], items: [] }} selected={-1} />,
    );
    expect(lastFrame() ?? '').toContain('No one known yet.');
  });
});

describe('PersonDetail', () => {
  it('shows affiliation, aliases, last sighting, Asset, rapport and Claim counts', () => {
    const { lastFrame } = render(<PersonDetail person={view.people[0]} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Viktor Lang');
    expect(frame).toContain('identified');
    expect(frame).toContain('trade mission');
    expect(frame).toContain('unk:3');
    expect(frame).toContain('Day 2, afternoon');
    expect(frame).toContain('Asset: yes');
    expect(frame).toContain('Rapport: warm');
    expect(frame).toContain('4 about');
    expect(frame).toContain('2 from');
  });

  it('falls back for an unidentified person with no record', () => {
    const { lastFrame } = render(<PersonDetail person={view.people[1]} />);
    const frame = lastFrame() ?? '';
    expect(frame).toContain('tall man in a grey coat');
    expect(frame).toContain('unidentified');
    expect(frame).toContain('unknown');
    expect(frame).toContain('Last seen: never');
    expect(frame).toContain('Asset: no');
  });

  it('shows a hint when nothing is selected', () => {
    const { lastFrame } = render(<PersonDetail person={undefined} />);
    expect(lastFrame() ?? '').toContain('Select a person.');
  });
});

describe('PeoplePane', () => {
  it('shows the list, the selected detail and the org/item lists', () => {
    const { lastFrame } = render(
      <PeoplePane view={view} selected={0} person={view.people[0]} />,
    );
    const frame = lastFrame() ?? '';
    expect(frame).toContain('Viktor Lang');
    expect(frame).toContain('Organisations');
    expect(frame).toContain('Trade Mission');
    expect(frame).toContain('hostile');
    expect(frame).toContain('Items');
    expect(frame).toContain('item:ledger');
    expect(frame).toContain('3 claims');
  });
});
