/**
 * Snapshots for the web shell's city aids, notice lines and the duty alert.
 */

import { describe, expect, it } from 'vitest';

import {
  cityLines,
  dutiesLines,
  hereStatus,
  isNoticeFact,
  mapStatus,
  statusLine,
  storiesLines,
} from './city-text.js';

const clock = { day: 3, phase: 'afternoon', location: 'The Riverside Café', budget: 1200, standing: 4 };

describe('web city aids', () => {
  it('snapshots the City, Stories and Duties lines', () => {
    expect(cityLines([{ id: 'evt:fair', name: 'Harvest fair' }])).toEqual(['Harvest fair']);
    expect(cityLines([])).toEqual(['Nothing you have heard about yet.']);
    expect(
      storiesLines([{ title: 'fair', status: 'active', articles: [{ title: 'The fair opens' }] }]),
    ).toEqual(['fair (active)', '  The fair opens']);
    expect(
      dutiesLines('low', 0.2, [{ template: 'office-hours', day: 3, status: 'pending', mandatory: true }]),
    ).toEqual(['Standing low (0.2)', 'office-hours · day 3 · pending · mandatory']);
  });

  it('snapshots a learned status, a notice fact line and the duty alert', () => {
    expect(mapStatus({ name: 'Café', status: 'closed-temporarily' })).toBe('closed-temporarily');
    expect(mapStatus({ name: 'Café' })).toBe('—');
    expect(hereStatus('closed-temporarily')).toBe('Status: closed-temporarily');
    expect(hereStatus(undefined)).toBeUndefined();
    expect(isNoticeFact('A notice is posted: Curfew.')).toBe(true);
    expect(isNoticeFact('You arrive at the café.')).toBe(false);
    expect(statusLine(clock)).toBe('Day 3, afternoon · The Riverside Café · budget 1200 · standing 4');
    expect(statusLine(clock, 'Your employer expects you for Office hours.')).toBe(
      'Day 3, afternoon · The Riverside Café · budget 1200 · standing 4 · Duty: Your employer expects you for Office hours.',
    );
  });
});
