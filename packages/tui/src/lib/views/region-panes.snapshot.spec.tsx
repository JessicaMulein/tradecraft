/**
 * Snapshots for the regional screens and the status bar in transit
 * (multi-city Requirement 17).
 */

import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from 'ink-testing-library';
import type { CarriageView, PaperView, RegionMapView, StatusView } from '@tradecraft/player-view';

import { StatusBar } from '../scene/status-bar.js';
import { CarriagePane, DeparturesPane, PapersPane, RegionMapPane } from './region-panes.js';

function plain(frame: string | undefined): string {
  // eslint-disable-next-line no-control-regex
  return (frame ?? '').replace(/\u001B\[[0-9;]*m/g, '');
}

const region: RegionMapView = {
  template: 'central-1953',
  here: 'city:north',
  cities: [
    {
      id: 'city:north',
      name: 'Northport',
      country: 'Northland',
      locations: [{ id: 'loc:halt', name: 'North Halt' }],
    },
    {
      id: 'city:east',
      name: 'Eastport',
      country: 'Eastland',
      locations: [],
    },
  ],
  routes: [
    {
      id: 'route:east',
      mode: 'rail',
      fromCity: 'city:north',
      toCity: 'city:east',
      fromName: 'Northport',
      toName: 'Eastport',
      duration: 2,
      fare: 12,
      borders: ['post:line'],
    },
  ],
  departures: [],
  papers: [],
};

const papers: readonly PaperView[] = [
  {
    id: 'paper:pass',
    kind: 'passport',
    holder: 'player',
    issuedBy: { kind: 'station', id: 'station:hub' },
    valid: { from: { day: 1, phase: 0 }, to: { day: 30, phase: 3 } },
    satisfies: ['post:line'],
  },
];

const carriage: CarriageView = {
  transit: 'transit:1',
  destination: 'Eastport',
  arrives: { day: 4, phase: 1 },
  travellers: ['you', 'a courier'],
};

const transitStatus: StatusView = {
  time: { day: 3, phase: 2 },
  location: { id: 'loc:halt', name: 'North Halt' },
  budget: 400,
  standing: 2,
  ended: false,
  transit: {
    destination: { id: 'city:east', name: 'Eastport' },
    arrives: { day: 4, phase: 1 },
  },
};

afterEach(() => {
  cleanup();
});

describe('regional screens', () => {
  it('renders the region map', () => {
    const { lastFrame } = render(<RegionMapPane view={region} />);
    expect(plain(lastFrame())).toMatchInlineSnapshot(`
      "Region · central-1953
      > Northport · Northland
          North Halt
        Eastport · Eastland
      Routes
      Northport → Eastport · rail · 2 phases · 12 · post:line"
    `);
  });

  it('renders the departures board', () => {
    const { lastFrame } = render(
      <DeparturesPane
        view={[
          {
            route: 'route:east',
            mode: 'rail',
            destination: 'Eastport',
            at: { day: 3, phase: 0 },
            duration: 2,
            fare: 12,
            borders: ['post:line'],
            quote: { allowed: true, phases: 3, money: 12 },
          },
        ]}
      />,
    );
    expect(plain(lastFrame())).toContain('rail → Eastport');
    expect(plain(lastFrame())).toContain('quote 3 phases');
  });

  it('renders held papers without a quality figure', () => {
    const { lastFrame } = render(<PapersPane papers={papers} />);
    const frame = plain(lastFrame());
    expect(frame).toContain('passport · player · station station:hub');
    expect(frame).toContain('post:line');
    expect(frame).not.toContain('quality');
  });

  it('renders the carriage and the status bar in transit', () => {
    const carriageFrame = plain(render(<CarriagePane view={carriage} />).lastFrame());
    expect(carriageFrame).toContain('Carriage → Eastport');
    expect(carriageFrame).toContain('you');
    expect(carriageFrame).toContain('Talk and observe from the scene.');
    cleanup();
    const status = plain(render(<StatusBar status={transitStatus} />).lastFrame());
    expect(status).toContain('In transit → Eastport');
    expect(status).toContain('arrives Day 4, afternoon');
  });
});
