/**
 * The tutorial suggestion reads the Player View only, and only while hints
 * are on.
 */
import { describe, expect, it } from 'vitest';

import type { EngineApi } from '../api/types.js';
import { tutorialSuggestion } from './tutorial.js';

function api(
  over: Partial<EngineApi> & { hints?: { enabled: boolean } },
): EngineApi {
  const base = {
    hints: { enabled: true },
    actions: () => [
      {
        action: { kind: 'wait', phases: 1 },
        quote: { allowed: true, phases: 1, money: 0 },
      },
      {
        action: { kind: 'read', doc: 'doc:brief' },
        quote: { allowed: true, phases: 0, money: 0 },
      },
    ],
    caseFile: { list: () => [], evidence: () => 0 },
    views: {
      here: () => ({
        location: { id: 'loc:cafe', type: 'kaffeehaus' },
        visible: [],
      }),
      map: () => ({ districts: [] }),
      people: () => ({ people: [] }),
      documents: () => ({
        documents: [{ id: 'doc:brief', title: 'Starting Brief', read: false }],
      }),
      intercepts: () => ({ intercepts: [] }),
    },
  };
  return {
    ...base,
    ...over,
    views: { ...base.views, ...over.views },
  } as unknown as EngineApi;
}

describe('tutorialSuggestion', () => {
  it('says nothing when hints are off', () => {
    expect(
      tutorialSuggestion(api({ hints: { enabled: false } })),
    ).toBeUndefined();
  });

  it('points at an unread document ahead of waiting', () => {
    const suggestion = tutorialSuggestion(api({}));
    expect(suggestion?.rule).toBe('read');
    expect(suggestion?.text).toContain('Starting Brief');
    expect(suggestion?.action).toEqual({ kind: 'read', doc: 'doc:brief' });
  });

  it('points at an arrest once the catalogue offers one', () => {
    const suggestion = tutorialSuggestion(
      api({
        actions: () => [
          {
            action: { kind: 'read', doc: 'doc:brief' },
            quote: { allowed: true, phases: 0, money: 0 },
          },
          {
            action: { kind: 'arrest', npc: 'npc:ana' },
            quote: { allowed: true, phases: 1, money: 0 },
          },
        ],
        views: {
          documents: () => ({
            documents: [
              { id: 'doc:brief', title: 'Starting Brief', read: false },
            ],
          }),
          people: () => ({
            people: [{ id: 'npc:ana', label: 'Ana', claimsAsSubject: 2 }],
          }),
        },
      } as unknown as Partial<EngineApi>),
    );
    expect(suggestion?.rule).toBe('arrest');
    expect(suggestion?.text).toContain('Ana');
  });

  it('says to break off a meeting before opening an unread paper', () => {
    const suggestion = tutorialSuggestion(
      api({
        actions: () => [
          {
            action: { kind: 'read', doc: 'doc:brief' },
            quote: { allowed: true, phases: 0, money: 0 },
          },
          {
            action: { kind: 'talk', npc: 'npc:ana', breakOff: true },
            quote: { allowed: true, phases: 1, money: 0 },
          },
        ],
        views: {
          people: () => ({
            people: [{ id: 'npc:ana', label: 'Ana', claimsAsSubject: 0 }],
          }),
        },
      } as unknown as Partial<EngineApi>),
    );
    expect(suggestion?.rule).toBe('break-off');
    expect(suggestion?.text).toContain('Ana');
    expect(suggestion?.action).toEqual({
      kind: 'talk',
      npc: 'npc:ana',
      breakOff: true,
    });
  });

  it('points at the car when a drive is offered and nothing else is due', () => {
    const suggestion = tutorialSuggestion(
      api({
        actions: () => [
          {
            action: { kind: 'wait', phases: 1 },
            quote: { allowed: true, phases: 1, money: 0 },
          },
          {
            action: { kind: 'street-ops.drive', vehicle: 'staff-saloon' },
            quote: { allowed: true, phases: 0, money: 0 },
          },
        ],
        views: {
          documents: () => ({
            documents: [{ id: 'doc:brief', title: 'Starting Brief', read: true }],
          }),
        },
      } as unknown as Partial<EngineApi>),
    );
    expect(suggestion?.rule).toBe('drive');
    expect(suggestion?.text).toContain('Take the car');
    expect(suggestion?.action).toEqual({
      kind: 'street-ops.drive',
      vehicle: 'staff-saloon',
    });
  });
});
