/**
 * The debrief screen's section paging — a pure reducer and selectors over a
 * {@link DebriefView} (design, "Arrests, end conditions, the debrief and the
 * Outcome Record" → the Debrief screen; Requirements 13.8, 19.6). Task 22.11.
 *
 * The end-of-game debrief is read one *section* at a time: the outcome summary,
 * every NPC's true allegiance versus the one they presented, the actual Plot
 * timeline, the Case File Claims that were lies, the leads that were noise, the
 * Propositions the player fed, the Directive results, and the score and grading
 * accuracy (Req 19.6). This module is the paging logic — which section the
 * reader is on and how up/down moves between them — kept pure and separate from
 * the Ink component so navigation is unit-testable without a TTY. The component
 * holds this state, dispatches one {@link DebriefAction} per keypress, and reads
 * back the {@link DebriefSectionsState} to render the current section.
 *
 * The debrief data itself comes from the facade's `views.debrief()`, which
 * returns a {@link DebriefView} once the game has ended and `null` before then.
 * This module only pages through a present view; the `null` (game-not-ended)
 * case is the component's placeholder state and never reaches the reducer.
 */

import type { DebriefView } from '@tradecraft/player-view';

/**
 * The stable identity of each debrief section, in the fixed reading order the
 * reader pages through. Mirrors the design's Debrief screen sections and the
 * {@link DebriefView} field order (Req 19.6): the outcome summary first, then
 * the revealed ground-truth sections, then the player's final score.
 */
export const DEBRIEF_SECTION_IDS = [
  'outcome',
  'allegiances',
  'timeline',
  'lies',
  'noise-leads',
  'fed-propositions',
  'directives',
  'score',
] as const;

/** One debrief section's identity. */
export type DebriefSectionId = (typeof DEBRIEF_SECTION_IDS)[number];

/** The number of sections the reader pages through. */
export const DEBRIEF_SECTION_COUNT = DEBRIEF_SECTION_IDS.length;

/** The player-facing title for each section (design, Debrief screen). */
export const DEBRIEF_SECTION_TITLES: Readonly<
  Record<DebriefSectionId, string>
> = {
  outcome: 'Outcome',
  allegiances: 'True allegiances',
  timeline: 'Plot timeline',
  lies: 'Claims that were lies',
  'noise-leads': 'Side threads & rumours',
  'fed-propositions': 'Propositions you fed',
  directives: 'Directive results',
  score: 'Score & grading accuracy',
} as const;

/**
 * The debrief paging state: the view the screen renders and the index of the
 * section currently on screen, clamped to `[0, DEBRIEF_SECTION_COUNT - 1]`.
 *
 * The section set is fixed (every debrief has all eight sections, each possibly
 * empty), so the cursor never depends on the data — an empty section still
 * exists and is paged to; the component renders a "nothing here" line for it.
 */
export interface DebriefSectionsState {
  /** The debrief the screen renders, from `views.debrief()`. */
  readonly view: DebriefView;
  /** The on-screen section index, clamped to the section list. */
  readonly section: number;
}

/** A paging action, one per keypress the component handles. */
export type DebriefAction =
  /** Page to the next/previous section (clamped at the ends). */
  | { readonly type: 'next-section' }
  | { readonly type: 'prev-section' }
  /** Jump to the first/last section. */
  | { readonly type: 'first-section' }
  | { readonly type: 'last-section' }
  /** Page to a specific section by index (clamped into range). */
  | { readonly type: 'select-section'; readonly index: number }
  /** Page to a specific section by its id. */
  | { readonly type: 'go-to'; readonly id: DebriefSectionId }
  /**
   * Replace the underlying debrief (e.g. the facade returns a fresh view). The
   * cursor is kept where it is, re-clamped onto the fixed section list.
   */
  | { readonly type: 'set-view'; readonly view: DebriefView };

/** The initial paging state: the first section (the outcome summary) on screen. */
export function initialDebriefSectionsState(
  view: DebriefView,
): DebriefSectionsState {
  return { view, section: 0 };
}

/** Clamp a desired section index into `[0, DEBRIEF_SECTION_COUNT - 1]`. */
function clampSection(index: number): number {
  if (index < 0) {
    return 0;
  }
  if (index > DEBRIEF_SECTION_COUNT - 1) {
    return DEBRIEF_SECTION_COUNT - 1;
  }
  return Math.trunc(index);
}

/**
 * The pure debrief-paging reducer (design, Debrief screen). Applies one
 * {@link DebriefAction} to the {@link DebriefSectionsState} and returns the next
 * state; never mutates its input. The section cursor is always clamped to the
 * fixed section list, so up/down never runs off either end.
 */
export function reduceDebriefSections(
  state: DebriefSectionsState,
  action: DebriefAction,
): DebriefSectionsState {
  switch (action.type) {
    case 'next-section':
      return { ...state, section: clampSection(state.section + 1) };
    case 'prev-section':
      return { ...state, section: clampSection(state.section - 1) };
    case 'first-section':
      return { ...state, section: 0 };
    case 'last-section':
      return { ...state, section: DEBRIEF_SECTION_COUNT - 1 };
    case 'select-section':
      return { ...state, section: clampSection(action.index) };
    case 'go-to':
      return { ...state, section: DEBRIEF_SECTION_IDS.indexOf(action.id) };
    case 'set-view':
      return { view: action.view, section: clampSection(state.section) };
    default:
      return state;
  }
}

/** The id of the section currently on screen. */
export function currentSectionId(state: DebriefSectionsState): DebriefSectionId {
  return DEBRIEF_SECTION_IDS[clampSection(state.section)];
}

/** The player-facing title of the section currently on screen. */
export function currentSectionTitle(state: DebriefSectionsState): string {
  return DEBRIEF_SECTION_TITLES[currentSectionId(state)];
}

/**
 * How many rows the given section holds in a {@link DebriefView} — the length of
 * the backing list for the revealed-ground-truth sections. The `outcome` and
 * `score` sections are single summaries, so they report `1`. The component uses
 * this to show a section's item count and to render an "empty" line when a
 * list section has no rows.
 */
export function sectionItemCount(
  view: DebriefView,
  id: DebriefSectionId,
): number {
  switch (id) {
    case 'outcome':
      return 1;
    case 'allegiances':
      return view.allegiances.length;
    case 'timeline':
      return view.timeline.length + (view.plots?.length ?? 0);
    case 'lies':
      return view.lies.length;
    case 'noise-leads':
      return view.noiseLeads.length;
    case 'fed-propositions':
      return view.fedPropositions.length;
    case 'directives':
      return view.directives.length;
    case 'score':
      return 1;
    default:
      return 0;
  }
}
