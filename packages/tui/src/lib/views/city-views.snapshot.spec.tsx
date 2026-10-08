/**
 * Snapshots for the City, Stories and Duties panes, notice lines and the
 * cover-duty status-bar alert.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { ActionOption, CityView, DutiesView, HereView, StatusView, StoriesView } from '@tradecraft/player-view';

import { ActionMenu } from '../here/action-menu.js';
import { HerePane } from '../here/here-pane.js';
import { StatusBar } from '../scene/status-bar.js';
import { CityPane, DutiesPane, NoticeLines, StoriesPane } from './city-views.js';

function plain(frame: string | undefined): string {
  // eslint-disable-next-line no-control-regex
  return (frame ?? '').replace(/\u001B\[[0-9;]*m/g, '');
}

const city: CityView = {
  events: [{ id: 'evt:fair', name: 'Harvest fair' }],
};

const stories: StoriesView = {
  stories: [
    {
      id: 'story:fair',
      title: 'fair',
      status: 'active',
      articles: [{ doc: 'doc:paper', title: 'The fair opens' }],
    },
  ],
};

const duties: DutiesView = {
  standing: 0.2,
  band: 'low',
  duties: [
    {
      id: 'duty:office',
      template: 'office-hours',
      loc: 'loc:office',
      day: 3,
      phase: 1,
      status: 'pending',
      mandatory: true,
    },
  ],
};

const status: StatusView = {
  time: { day: 3, phase: 1 },
  location: { id: 'loc:cafe', name: 'The Riverside Café' },
  budget: 1200,
  standing: 4,
  ended: false,
};

const here: HereView = {
  location: {
    id: 'loc:cafe',
    name: 'The Riverside Café',
    type: 'kaffeehaus',
    tags: ['sector:american', 'type:kaffeehaus'],
    district: { id: 'district:inner', name: 'Innere Stadt' },
    atmosphere: ['smoky'],
    risk: 2,
    public: true,
    status: 'closed-temporarily',
  },
  crowd: 'busy',
  weather: 'cold and clear',
  visible: [],
};

const attend: readonly ActionOption[] = [
  {
    action: { kind: 'attend-duty', duty: 'duty:office' },
    quote: { allowed: true, phases: 1, money: 0 },
  },
];

afterEach(() => {
  cleanup();
});

describe('ambient panes', () => {
  it('snapshots the City, Stories and Duties views', () => {
    expect(plain(render(<CityPane view={city} />).lastFrame())).toMatchInlineSnapshot(`
      "City
      Harvest fair"
    `);
    cleanup();
    expect(plain(render(<StoriesPane view={stories} />).lastFrame())).toMatchInlineSnapshot(`
      "Stories

      fair (active)
        The fair opens"
    `);
    cleanup();
    expect(plain(render(<DutiesPane view={duties} />).lastFrame())).toMatchInlineSnapshot(`
      "Cover duties
      Standing low (0.2)
      office-hours · day 3 · pending · mandatory"
    `);
  });

  it('snapshots notice fact lines and the duty alert', () => {
    expect(plain(render(<NoticeLines lines={['A notice is posted: Curfew.']} />).lastFrame())).toMatchInlineSnapshot(`
      "Notices
      A notice is posted: Curfew."
    `);
    cleanup();
    expect(
      plain(render(<StatusBar status={status} dutyAlert="Your employer expects you for Office hours." />).lastFrame()),
    ).toContain('Duty: Your employer expects you for Office hours.');
  });

  it('snapshots a learned location status and the attend-duty action', () => {
    expect(plain(render(<HerePane here={here} />).lastFrame())).toContain('Status: closed-temporarily');
    cleanup();
    expect(plain(render(<ActionMenu options={attend} />).lastFrame())).toContain('attend duty — 1 phase');
  });
});
