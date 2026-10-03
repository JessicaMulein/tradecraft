/**
 * The Case File browser's pure state and reducer (design, "TUI": "Case File:
 * filterable by entity, source (npc, intercept, surveillance, document) and
 * grade, with grade and link editing"; Requirements 8.1, 13.3).
 *
 * The browser's behaviour — which Claim the cursor is on, the active filter,
 * the grade being composed, and which Claim is held as a link anchor — is kept
 * here as a pure function so it can be unit-tested without a TTY. The {@link
 * CaseFileBrowser} component holds this state, renders it, dispatches one {@link
 * CaseFileAction} per keypress and reads back the {@link CaseFileState}.
 *
 * ## The filter is emitted, not applied here
 *
 * The reducer never holds the Claims. It computes the active {@link
 * CaseFileFilter} from the player's filter choices, and the owning screen feeds
 * that to the facade's `caseFile.list(filter)` and passes the resulting {@link
 * ClaimView `ClaimView[]`} back in as a prop. This keeps the reducer a pure
 * function of key presses and keeps the one place that reaches the facade in the
 * screen, so the browser stays testable without a live engine.
 *
 * ## Boundary
 *
 * The reducer uses only `@tradecraft/player-view` types: {@link ClaimView} and
 * {@link CaseFileFilter}. The Admiralty Grade shape, its reliability letters and
 * credibility digits, and the source-kind list are mirrored locally — the
 * player-view facade does not re-export the engine's `AdmiraltyGrade`,
 * `ADMIRALTY_RELIABILITY`/`ADMIRALTY_CREDIBILITY` or `CLAIM_SOURCE_KINDS`
 * symbols, and the TUI may not reach into the engine (the
 * `tui-imports-only-player-view` dependency rule, Req 13.5). The mirrors match
 * the engine's shapes and order exactly, so the values the reducer composes are
 * assignable to what the facade's `caseFile.grade` accepts.
 */

import type { CaseFileFilter, ClaimView } from '@tradecraft/player-view';

/** A Claim id, as carried by a {@link ClaimView}. Mirrored off the view type. */
export type ClaimId = ClaimView['id'];

/** An entity id, as carried by a Claim's Proposition subject. */
export type EntityId = ClaimView['prop']['subject'];

/** A source-kind discriminant, as carried by a {@link ClaimView}. */
export type ClaimSourceKind = ClaimView['source']['kind'];

/**
 * An Admiralty Grade: source reliability (A–F) and information credibility
 * (1–6), the shape the facade's `caseFile.grade` accepts. Mirrored off the view
 * type so it stays structurally identical to the engine's `AdmiraltyGrade`
 * without importing it (Req 13.5).
 */
export type AdmiraltyGrade = NonNullable<ClaimView['grade']>;

/**
 * The six source-reliability letters, `A` (best) through `F`, mirroring the
 * engine's `ADMIRALTY_RELIABILITY` order. Kept local to the TUI because the
 * facade does not re-export the engine constant.
 */
export const ADMIRALTY_RELIABILITY = ['A', 'B', 'C', 'D', 'E', 'F'] as const;

/**
 * The six information-credibility digits, `1` (best) through `6`, mirroring the
 * engine's `ADMIRALTY_CREDIBILITY` order.
 */
export const ADMIRALTY_CREDIBILITY = [1, 2, 3, 4, 5, 6] as const;

/**
 * Every source kind, in a stable order, mirroring the engine's
 * `CLAIM_SOURCE_KINDS`. The source filter cycles through these plus an "all"
 * state (represented by `undefined`).
 */
export const CLAIM_SOURCE_KINDS = [
  'npc',
  'intercept',
  'surveillance',
  'document',
] as const;

/**
 * Which filter axis the player is currently editing. The browser cycles the
 * focused axis with left/right; the axis itself is chosen with a key per axis.
 */
export const FILTER_AXES = ['source', 'grade', 'entity'] as const;

/** One filter axis the browser can narrow the shown list on. */
export type FilterAxis = (typeof FILTER_AXES)[number];

/**
 * The Case File browser's full editable state.
 *
 * `cursor` indexes into the *shown* list (the filtered `ClaimView[]` the screen
 * supplies); the reducer clamps it against the current count. `filter` is the
 * active {@link CaseFileFilter} the screen applies — the reducer's one output to
 * the facade. `grade` is the Admiralty Grade being composed for the selected
 * Claim. `linkAnchor` holds the id of a Claim marked as the first half of a link
 * (the next link marks the pair); `undefined` when no anchor is held.
 */
export interface CaseFileState {
  /** The index of the highlighted Claim in the shown list. */
  readonly cursor: number;
  /** How many Claims the shown list currently holds (for clamping). */
  readonly count: number;
  /** The filter axis the player is editing (cycled by left/right). */
  readonly axis: FilterAxis;
  /** The active filter the screen applies via `caseFile.list`. */
  readonly filter: CaseFileFilter;
  /** The Admiralty Grade being composed for the selected Claim. */
  readonly grade: AdmiraltyGrade;
  /** The id of a Claim held as the first half of a link, if any. */
  readonly linkAnchor?: ClaimId;
}

/**
 * The entity ids the browser can cycle the entity filter through. The screen
 * supplies them (the entities present in the Case File), so the reducer need not
 * reach the facade; cycling walks this list plus an "all" state.
 */
export interface CaseFileInit {
  /** How many Claims the shown list starts with. */
  readonly count?: number;
  /** The entities the entity filter can cycle through. */
  readonly entities?: readonly EntityId[];
  /** A starting filter, if the screen opened the browser pre-filtered. */
  readonly filter?: CaseFileFilter;
}

/** The default Admiralty Grade the grade cursor starts on (A1, the best). */
const DEFAULT_GRADE: AdmiraltyGrade = { reliability: 'A', credibility: 1 };

/**
 * The initial browser state: the cursor on the first Claim, the source axis
 * focused, no filter active, the grade cursor on A1 and no link anchor held.
 */
export function initialCaseFileState(init: CaseFileInit = {}): CaseFileState {
  return {
    cursor: 0,
    count: init.count ?? 0,
    axis: 'source',
    filter: init.filter ?? {},
    grade: DEFAULT_GRADE,
    linkAnchor: undefined,
  };
}

/** A Case File browser action, one per keypress the component handles. */
export type CaseFileAction =
  /** Move the Claim cursor down/up the shown list (clamped, no wrap). */
  | { readonly type: 'cursor-next' }
  | { readonly type: 'cursor-prev' }
  /** Re-sync the shown-list count after the screen re-filters. */
  | { readonly type: 'set-count'; readonly count: number }
  /** Move the filter-axis focus to the next/previous axis (wrapping). */
  | { readonly type: 'axis-next' }
  | { readonly type: 'axis-prev' }
  /** Cycle the focused axis's value forward/back (wrapping through "all"). */
  | { readonly type: 'filter-next'; readonly entities?: readonly EntityId[] }
  | { readonly type: 'filter-prev'; readonly entities?: readonly EntityId[] }
  /** Clear every filter axis back to "all". */
  | { readonly type: 'filter-clear' }
  /** Adjust the grade cursor's reliability letter / credibility digit. */
  | { readonly type: 'grade-reliability'; readonly step: number }
  | { readonly type: 'grade-credibility'; readonly step: number }
  /** Mark the given Claim as the link anchor, or clear a held anchor. */
  | { readonly type: 'link-anchor'; readonly id: ClaimId }
  | { readonly type: 'link-clear' };

/** Advance an index within a list, wrapping, by `step` (+1 or -1). */
function cycleIndex(length: number, current: number, step: number): number {
  if (length === 0) {
    return 0;
  }
  return (current + step + length) % length;
}

/** Clamp a cursor into `[0, count)` (0 when the list is empty). */
function clampCursor(cursor: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(cursor, count - 1));
}

/**
 * Cycle a value through a list plus an "all" (undefined) state. The order is
 * `all → items[0] → … → items[n-1] → all`, so stepping past either end lands on
 * "all". Returns the next value for `step` (+1 forward, −1 back).
 *
 * The current value is located with `eq`, defaulting to `Object.is`. Grades are
 * `{ reliability, credibility }` objects rebuilt fresh each call, so the grade
 * axis passes a value-equality comparator rather than relying on reference
 * identity (which would always miss and treat the current grade as "all").
 */
function cycleWithAll<T>(
  items: readonly T[],
  current: T | undefined,
  step: number,
  eq: (a: T, b: T) => boolean = Object.is,
): T | undefined {
  // "all" sits at index 0; the items follow at 1..length.
  const slots = items.length + 1;
  const found = current === undefined ? -1 : items.findIndex((item) => eq(item, current));
  const currentSlot = found === -1 ? 0 : found + 1;
  const nextSlot = (currentSlot + step + slots) % slots;
  return nextSlot === 0 ? undefined : items[nextSlot - 1];
}

/** Compare two Admiralty Grades by value. */
function gradeEq(a: AdmiraltyGrade, b: AdmiraltyGrade): boolean {
  return a.reliability === b.reliability && a.credibility === b.credibility;
}

/**
 * Drop a key from the filter when its value is `undefined`, else set it. An
 * omitted axis does not filter, matching {@link CaseFileFilter}'s "omitted field
 * does not filter on that axis" rule.
 */
function withAxis(
  filter: CaseFileFilter,
  axis: FilterAxis,
  value: EntityId | ClaimSourceKind | AdmiraltyGrade | undefined,
): CaseFileFilter {
  const next: {
    entity?: EntityId;
    source?: ClaimSourceKind;
    grade?: AdmiraltyGrade;
  } = {
    ...(filter.entity === undefined ? {} : { entity: filter.entity }),
    ...(filter.source === undefined ? {} : { source: filter.source }),
    ...(filter.grade === undefined ? {} : { grade: filter.grade }),
  };
  if (value === undefined) {
    delete next[axis];
  } else {
    // The caller only ever passes the value type that matches the axis.
    next[axis] = value as never;
  }
  return next;
}

/** Cycle the focused filter axis's value by `step`, returning the next filter. */
function cycleFilter(
  state: CaseFileState,
  step: number,
  entities: readonly EntityId[],
): CaseFileFilter {
  switch (state.axis) {
    case 'source':
      return withAxis(
        state.filter,
        'source',
        cycleWithAll(CLAIM_SOURCE_KINDS, state.filter.source, step),
      );
    case 'grade':
      return withAxis(
        state.filter,
        'grade',
        cycleWithAll(gradeOptions(), state.filter.grade, step, gradeEq),
      );
    case 'entity':
      return withAxis(
        state.filter,
        'entity',
        cycleWithAll(entities, state.filter.entity, step),
      );
    default:
      return state.filter;
  }
}

/**
 * Every Admiralty Grade in a stable order, so the grade filter can cycle through
 * them. Reliability letter is the major axis, credibility digit the minor one
 * (A1, A2, … A6, B1, …).
 */
function gradeOptions(): readonly AdmiraltyGrade[] {
  const grades: AdmiraltyGrade[] = [];
  for (const reliability of ADMIRALTY_RELIABILITY) {
    for (const credibility of ADMIRALTY_CREDIBILITY) {
      grades.push({ reliability, credibility });
    }
  }
  return grades;
}

/**
 * The pure Case File browser reducer (design, "Case File"). Applies one {@link
 * CaseFileAction} to the {@link CaseFileState} and returns the next state;
 * never mutates its input. The {@link CaseFileBrowser} component maps each
 * keypress to an action and feeds it here, so the whole browser's navigation,
 * filtering and grade-composition behaviour is testable as a pure function.
 */
export function reduceCaseFile(
  state: CaseFileState,
  action: CaseFileAction,
): CaseFileState {
  switch (action.type) {
    case 'cursor-next':
      return { ...state, cursor: clampCursor(state.cursor + 1, state.count) };
    case 'cursor-prev':
      return { ...state, cursor: clampCursor(state.cursor - 1, state.count) };
    case 'set-count':
      return {
        ...state,
        count: Math.max(0, action.count),
        cursor: clampCursor(state.cursor, Math.max(0, action.count)),
      };
    case 'axis-next':
      return { ...state, axis: nextAxis(state.axis, 1) };
    case 'axis-prev':
      return { ...state, axis: nextAxis(state.axis, -1) };
    case 'filter-next':
      return {
        ...state,
        filter: cycleFilter(state, 1, action.entities ?? []),
      };
    case 'filter-prev':
      return {
        ...state,
        filter: cycleFilter(state, -1, action.entities ?? []),
      };
    case 'filter-clear':
      return { ...state, filter: {} };
    case 'grade-reliability':
      return {
        ...state,
        grade: {
          ...state.grade,
          reliability:
            ADMIRALTY_RELIABILITY[
              cycleIndex(
                ADMIRALTY_RELIABILITY.length,
                ADMIRALTY_RELIABILITY.indexOf(state.grade.reliability),
                action.step,
              )
            ] ?? state.grade.reliability,
        },
      };
    case 'grade-credibility':
      return {
        ...state,
        grade: {
          ...state.grade,
          credibility:
            ADMIRALTY_CREDIBILITY[
              cycleIndex(
                ADMIRALTY_CREDIBILITY.length,
                ADMIRALTY_CREDIBILITY.indexOf(state.grade.credibility),
                action.step,
              )
            ] ?? state.grade.credibility,
        },
      };
    case 'link-anchor':
      return { ...state, linkAnchor: action.id };
    case 'link-clear':
      return { ...state, linkAnchor: undefined };
    default:
      return state;
  }
}

/** Move the filter-axis focus by `step`, wrapping around {@link FILTER_AXES}. */
function nextAxis(axis: FilterAxis, step: number): FilterAxis {
  const index = FILTER_AXES.indexOf(axis);
  const base = index === -1 ? 0 : index;
  return FILTER_AXES[(base + step + FILTER_AXES.length) % FILTER_AXES.length] as FilterAxis;
}

/** Render an Admiralty Grade as it reads on a report, e.g. `B2`. */
export function formatGrade(grade: AdmiraltyGrade): string {
  return `${grade.reliability}${grade.credibility}`;
}
