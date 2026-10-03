/**
 * Unit tests for the pure debrief section-paging reducer (task 22.11; design,
 * Debrief screen; Requirements 13.8, 19.6). These drive {@link
 * reduceDebriefSections} directly — no TTY — and assert that paging up and down
 * walks the fixed section list and clamps at both ends, that first/last and
 * go-to jump correctly, that `set-view` keeps the cursor re-clamped, and that
 * the selectors report the right section id, title and item counts.
 */

import { describe, expect, it } from 'vitest';
import type { DebriefView } from '@tradecraft/player-view';

import {
  DEBRIEF_SECTION_COUNT,
  DEBRIEF_SECTION_IDS,
  currentSectionId,
  currentSectionTitle,
  initialDebriefSectionsState,
  reduceDebriefSections,
  sectionItemCount,
  type DebriefSectionsState,
} from './debrief-sections.js';

/** A minimal ended-game {@link DebriefView} fixture (every field present). */
function makeView(overrides: Partial<DebriefView> = {}): DebriefView {
  return {
    outcome: 'burned',
    endedAt: { day: 7, phase: 2 },
    cause: 'cover blown at the border',
    allegiances: [
      {
        npc: 'npc:viktor',
        name: 'Viktor',
        role: 'cell',
        apparent: 'neutral',
        trueOrg: 'org:hostile',
        trueOrgName: 'The Service',
        deceptive: true,
      },
    ],
    timeline: [
      {
        stage: 'stage:1',
        templateId: 'tmpl:recruit',
        status: 'executed',
        deadline: { day: 3, phase: 0 },
        traces: ['A courier changed hands at the station.'],
      },
    ],
    lies: [
      { claim: 'claim:1', text: 'Viktor is a journalist', deliberate: true },
    ],
    noiseLeads: [
      {
        claim: 'claim:2',
        text: 'A smuggling ring works the docks',
        kind: 'side-thread',
        thread: 'thread:docks',
      },
    ],
    fedPropositions: [
      {
        agent: 'npc:ana',
        text: 'The drop moved to the park',
        classification: 'deception',
      },
    ],
    directives: [
      {
        id: 'dir:1',
        text: 'Identify the handler',
        status: 'met',
        reward: 2,
      },
    ],
    score: {
      standing: 5,
      claimsTotal: 10,
      claimsTrue: 7,
      gradedTotal: 6,
      gradedCorrect: 4,
      gradingAccuracy: 4 / 6,
    },
    ...overrides,
  };
}

describe('initialDebriefSectionsState', () => {
  it('starts on the first section (the outcome summary)', () => {
    const state = initialDebriefSectionsState(makeView());
    expect(state.section).toBe(0);
    expect(currentSectionId(state)).toBe('outcome');
  });
});

describe('reduceDebriefSections paging', () => {
  const start = initialDebriefSectionsState(makeView());

  it('pages forward through every section in order', () => {
    let state: DebriefSectionsState = start;
    const seen = [currentSectionId(state)];
    for (let i = 1; i < DEBRIEF_SECTION_COUNT; i += 1) {
      state = reduceDebriefSections(state, { type: 'next-section' });
      seen.push(currentSectionId(state));
    }
    expect(seen).toEqual([...DEBRIEF_SECTION_IDS]);
  });

  it('clamps at the last section when paging past the end', () => {
    let state: DebriefSectionsState = start;
    for (let i = 0; i < DEBRIEF_SECTION_COUNT + 3; i += 1) {
      state = reduceDebriefSections(state, { type: 'next-section' });
    }
    expect(state.section).toBe(DEBRIEF_SECTION_COUNT - 1);
    expect(currentSectionId(state)).toBe('score');
  });

  it('clamps at the first section when paging before the start', () => {
    const state = reduceDebriefSections(start, { type: 'prev-section' });
    expect(state.section).toBe(0);
    expect(currentSectionId(state)).toBe('outcome');
  });

  it('jumps to the last and first sections', () => {
    const last = reduceDebriefSections(start, { type: 'last-section' });
    expect(currentSectionId(last)).toBe('score');
    const first = reduceDebriefSections(last, { type: 'first-section' });
    expect(currentSectionId(first)).toBe('outcome');
  });

  it('selects a section by index, clamping out-of-range values', () => {
    const timeline = reduceDebriefSections(start, {
      type: 'select-section',
      index: 2,
    });
    expect(currentSectionId(timeline)).toBe('timeline');
    const clampedHigh = reduceDebriefSections(start, {
      type: 'select-section',
      index: 999,
    });
    expect(clampedHigh.section).toBe(DEBRIEF_SECTION_COUNT - 1);
    const clampedLow = reduceDebriefSections(start, {
      type: 'select-section',
      index: -5,
    });
    expect(clampedLow.section).toBe(0);
  });

  it('goes to a section by its id', () => {
    const state = reduceDebriefSections(start, {
      type: 'go-to',
      id: 'fed-propositions',
    });
    expect(currentSectionId(state)).toBe('fed-propositions');
    expect(currentSectionTitle(state)).toBe('Propositions you fed');
  });

  it('does not mutate the input state', () => {
    const next = reduceDebriefSections(start, { type: 'next-section' });
    expect(start.section).toBe(0);
    expect(next).not.toBe(start);
  });
});

describe('reduceDebriefSections set-view', () => {
  it('replaces the view and keeps the cursor, re-clamped', () => {
    const atLast = reduceDebriefSections(
      initialDebriefSectionsState(makeView()),
      { type: 'last-section' },
    );
    const fresh = makeView({ cause: 'operation disrupted' });
    const state = reduceDebriefSections(atLast, {
      type: 'set-view',
      view: fresh,
    });
    expect(state.view.cause).toBe('operation disrupted');
    expect(state.section).toBe(DEBRIEF_SECTION_COUNT - 1);
  });
});

describe('sectionItemCount', () => {
  const view = makeView();

  it('reports 1 for the single-summary sections', () => {
    expect(sectionItemCount(view, 'outcome')).toBe(1);
    expect(sectionItemCount(view, 'score')).toBe(1);
  });

  it('reports the backing list length for the revealed sections', () => {
    expect(sectionItemCount(view, 'allegiances')).toBe(1);
    expect(sectionItemCount(view, 'timeline')).toBe(1);
    expect(sectionItemCount(view, 'lies')).toBe(1);
    expect(sectionItemCount(view, 'noise-leads')).toBe(1);
    expect(sectionItemCount(view, 'fed-propositions')).toBe(1);
    expect(sectionItemCount(view, 'directives')).toBe(1);
  });

  it('reports 0 for an empty list section', () => {
    const empty = makeView({ allegiances: [], lies: [] });
    expect(sectionItemCount(empty, 'allegiances')).toBe(0);
    expect(sectionItemCount(empty, 'lies')).toBe(0);
  });
});
