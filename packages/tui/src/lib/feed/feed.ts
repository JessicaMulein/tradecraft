/**
 * The Feed composer's pure state and reducer (design, "TUI": "Feed composer:
 * pick Case File Claims or compose a Proposition (predicate, then subject,
 * object, place and window, chosen only from known entities). It shows
 * `validateFeed` errors inline"; Requirements 13.1, 37.1, 37.2).
 *
 * The composer lets the player choose what a turned agent tells their handler.
 * It has two modes:
 *
 * - **Mode A — pick Claims.** A selectable list of the player's Case File
 *   Claims; the player toggles which Claims to include in the feed.
 * - **Mode B — compose Propositions from known entities.** The player builds a
 *   {@link ComposedProposition} by choosing a predicate, subject and object (and
 *   optionally a place), each cycled only through options drawn from the
 *   player's known set.
 *
 * The behaviour — the active mode, the Claim cursor and the toggled Claim set,
 * the field cursor in the compose form and the chosen option on each field, and
 * the composed items staged so far — is kept here as a pure function so it can
 * be unit-tested without a TTY. The {@link FeedComposer} component holds this
 * state, renders it, dispatches one {@link FeedAction} per keypress, reads back
 * the {@link FeedState}, and {@link assembleFeed assembles} the {@link FeedItem}
 * list to hand to the injected `validateFeed`.
 *
 * ## Presentational over props
 *
 * The reducer never reaches the facade. The owning screen supplies the Claims
 * (`ClaimView[]`), the known entities (a {@link PeopleView}) and the predicate
 * options as props, and injects the `validateFeed` function; the reducer is a
 * pure function of key presses plus those option lists. This keeps the composer
 * testable without a live engine and keeps the one place that touches the facade
 * in the screen (the `tui-imports-only-player-view` rule, Req 13.5).
 *
 * ## Boundary
 *
 * The reducer uses only `@tradecraft/player-view` types: {@link ClaimView},
 * {@link ComposedProposition} and {@link FeedItem} (the latter two re-exported
 * by the facade from the engine, so the composer can name the items it builds
 * without importing the engine, Req 13.5).
 */

import type {
  ClaimView,
  ComposedProposition,
  FeedItem,
} from '@tradecraft/player-view';

/** A Claim id, as carried by a {@link ClaimView}. Mirrored off the view type. */
export type ClaimId = ClaimView['id'];

/** An entity id, as carried by a composed Proposition's subject. */
export type EntityId = ComposedProposition['subject'];

/** The object of a composed Proposition (an entity id or a literal). */
export type PropObject = ComposedProposition['object'];

/** A predicate id the composer offers (e.g. `core/MEMBER_OF`). */
export type PredicateId = ComposedProposition['predicate'];

/** A place id a composed Proposition may carry. */
export type PlaceId = NonNullable<ComposedProposition['place']>;

/**
 * One option offered for a compose field: a stable value plus a player-facing
 * label. The owning screen builds these from the {@link PeopleView} and the
 * content predicate vocabulary; the reducer only cycles the chosen index.
 */
export interface FieldOption<T> {
  readonly value: T;
  readonly label: string;
}

/** The option lists the compose form cycles each field through. */
export interface ComposeOptions {
  /** Predicates offered (from the content Predicate Vocabulary). */
  readonly predicates: readonly FieldOption<PredicateId>[];
  /** Subject entities offered (from the known set). */
  readonly subjects: readonly FieldOption<EntityId>[];
  /** Objects offered (known entities and/or literals). */
  readonly objects: readonly FieldOption<PropObject>[];
  /** Places offered; the first entry should represent "no place". */
  readonly places: readonly FieldOption<PlaceId | undefined>[];
}

/** The two composer modes the player tabs between. */
export const FEED_MODES = ['claims', 'compose'] as const;

/** Which composer mode is active. */
export type FeedMode = (typeof FEED_MODES)[number];

/** The compose form's fields, in entry order. */
export const COMPOSE_FIELDS = ['predicate', 'subject', 'object', 'place'] as const;

/** One field of the compose form. */
export type ComposeField = (typeof COMPOSE_FIELDS)[number];

/** The chosen option index on each compose field. */
export interface ComposeSelection {
  readonly predicate: number;
  readonly subject: number;
  readonly object: number;
  readonly place: number;
}

/**
 * The Feed composer's full editable state.
 *
 * `mode` is the active composer mode. In `claims` mode, `claimCursor` indexes
 * into the shown `ClaimView[]` and `selected` holds the toggled Claim ids. In
 * `compose` mode, `field` is the focused form field and `selection` holds the
 * chosen option index on each field. `composed` holds the composed Propositions
 * the player has staged (added) so far. `errorsShown` is `true` once a submit
 * attempt surfaced validation errors, so the screen can render them inline until
 * the player changes the feed.
 */
export interface FeedState {
  /** The active composer mode. */
  readonly mode: FeedMode;
  /** The cursor in the shown Claim list (`claims` mode). */
  readonly claimCursor: number;
  /** How many Claims the shown list holds (for clamping). */
  readonly claimCount: number;
  /** The toggled-in Claim ids (`claims` mode). */
  readonly selected: readonly ClaimId[];
  /** The focused compose field (`compose` mode). */
  readonly field: ComposeField;
  /** The chosen option index on each compose field. */
  readonly selection: ComposeSelection;
  /** The composed Propositions staged so far. */
  readonly composed: readonly ComposedProposition[];
  /** Whether a submit attempt has surfaced errors to show inline. */
  readonly errorsShown: boolean;
}

/** The initial-state options the screen seeds the reducer with. */
export interface FeedInit {
  /** How many Claims the shown list starts with. */
  readonly claimCount?: number;
}

/** The initial composer state: `claims` mode, nothing selected or composed. */
export function initialFeedState(init: FeedInit = {}): FeedState {
  return {
    mode: 'claims',
    claimCursor: 0,
    claimCount: init.claimCount ?? 0,
    selected: [],
    field: 'predicate',
    selection: { predicate: 0, subject: 0, object: 0, place: 0 },
    composed: [],
    errorsShown: false,
  };
}

/** A Feed composer action, one per keypress the component handles. */
export type FeedAction =
  /** Switch to the other mode (tab). */
  | { readonly type: 'mode-toggle' }
  /** Move the Claim cursor down/up the shown list (clamped, no wrap). */
  | { readonly type: 'claim-next' }
  | { readonly type: 'claim-prev' }
  /** Re-sync the shown-Claim count after the screen re-filters. */
  | { readonly type: 'set-claim-count'; readonly count: number }
  /** Toggle the Claim at the given id into/out of the feed. */
  | { readonly type: 'claim-toggle'; readonly id: ClaimId }
  /** Move the compose-field focus to the next/previous field (wrapping). */
  | { readonly type: 'field-next' }
  | { readonly type: 'field-prev' }
  /** Cycle the focused field's chosen option forward/back (wrapping). */
  | {
      readonly type: 'option-next';
      readonly options: ComposeOptions;
    }
  | {
      readonly type: 'option-prev';
      readonly options: ComposeOptions;
    }
  /** Stage the currently composed Proposition as an item. */
  | { readonly type: 'compose-add'; readonly options: ComposeOptions }
  /** Remove the last staged composed Proposition. */
  | { readonly type: 'compose-remove-last' }
  /** Mark that a submit attempt surfaced errors (show them inline). */
  | { readonly type: 'mark-errors' }
  /** Clear the surfaced-errors flag (feed changed since). */
  | { readonly type: 'clear-errors' };

/** Clamp a cursor into `[0, count)` (0 when the list is empty). */
function clampCursor(cursor: number, count: number): number {
  if (count <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(cursor, count - 1));
}

/** Advance an index within a list, wrapping, by `step` (+1 or -1). */
function cycleIndex(length: number, current: number, step: number): number {
  if (length === 0) {
    return 0;
  }
  return (current + step + length) % length;
}

/** The other mode from the given one. */
function otherMode(mode: FeedMode): FeedMode {
  return mode === 'claims' ? 'compose' : 'claims';
}

/** Move the compose-field focus by `step`, wrapping {@link COMPOSE_FIELDS}. */
function nextField(field: ComposeField, step: number): ComposeField {
  const index = COMPOSE_FIELDS.indexOf(field);
  const base = index === -1 ? 0 : index;
  const slot = (base + step + COMPOSE_FIELDS.length) % COMPOSE_FIELDS.length;
  return COMPOSE_FIELDS[slot] as ComposeField;
}

/** How many options the given field offers. */
function fieldLength(field: ComposeField, options: ComposeOptions): number {
  switch (field) {
    case 'predicate':
      return options.predicates.length;
    case 'subject':
      return options.subjects.length;
    case 'object':
      return options.objects.length;
    case 'place':
      return options.places.length;
    default:
      return 0;
  }
}

/** Cycle the focused field's chosen option index by `step`. */
function cycleOption(
  selection: ComposeSelection,
  field: ComposeField,
  options: ComposeOptions,
  step: number,
): ComposeSelection {
  const length = fieldLength(field, options);
  return {
    ...selection,
    [field]: cycleIndex(length, selection[field], step),
  };
}

/**
 * Build the {@link ComposedProposition} the compose form currently describes,
 * reading each field's chosen option out of `options`. Returns `undefined` when
 * any required field (predicate, subject, object) has no option to choose, so
 * the composer can refuse to stage an incomplete Proposition.
 */
export function currentComposed(
  selection: ComposeSelection,
  options: ComposeOptions,
): ComposedProposition | undefined {
  const predicate = options.predicates[selection.predicate]?.value;
  const subject = options.subjects[selection.subject]?.value;
  const object = options.objects[selection.object]?.value;
  if (predicate === undefined || subject === undefined || object === undefined) {
    return undefined;
  }
  const place = options.places[selection.place]?.value;
  const base: ComposedProposition = { predicate, subject, object };
  return place === undefined ? base : { ...base, place };
}

/**
 * Toggle a Claim id in a selection list, preserving order (appended on add,
 * filtered on remove).
 */
function toggleClaim(
  selected: readonly ClaimId[],
  id: ClaimId,
): readonly ClaimId[] {
  return selected.includes(id)
    ? selected.filter((claim) => claim !== id)
    : [...selected, id];
}

/**
 * The pure Feed composer reducer (design, "Feed composer"). Applies one {@link
 * FeedAction} to the {@link FeedState} and returns the next state; never mutates
 * its input. Any change to the assembled feed clears the surfaced-errors flag,
 * so stale {@link FeedError}s do not linger after the player edits the feed.
 */
export function reduceFeed(state: FeedState, action: FeedAction): FeedState {
  switch (action.type) {
    case 'mode-toggle':
      return { ...state, mode: otherMode(state.mode) };
    case 'claim-next':
      return {
        ...state,
        claimCursor: clampCursor(state.claimCursor + 1, state.claimCount),
      };
    case 'claim-prev':
      return {
        ...state,
        claimCursor: clampCursor(state.claimCursor - 1, state.claimCount),
      };
    case 'set-claim-count': {
      const count = Math.max(0, action.count);
      return {
        ...state,
        claimCount: count,
        claimCursor: clampCursor(state.claimCursor, count),
      };
    }
    case 'claim-toggle':
      return {
        ...state,
        selected: toggleClaim(state.selected, action.id),
        errorsShown: false,
      };
    case 'field-next':
      return { ...state, field: nextField(state.field, 1) };
    case 'field-prev':
      return { ...state, field: nextField(state.field, -1) };
    case 'option-next':
      return {
        ...state,
        selection: cycleOption(state.selection, state.field, action.options, 1),
      };
    case 'option-prev':
      return {
        ...state,
        selection: cycleOption(state.selection, state.field, action.options, -1),
      };
    case 'compose-add': {
      const prop = currentComposed(state.selection, action.options);
      if (prop === undefined) {
        return state;
      }
      return {
        ...state,
        composed: [...state.composed, prop],
        errorsShown: false,
      };
    }
    case 'compose-remove-last':
      return state.composed.length === 0
        ? state
        : {
            ...state,
            composed: state.composed.slice(0, -1),
            errorsShown: false,
          };
    case 'mark-errors':
      return { ...state, errorsShown: true };
    case 'clear-errors':
      return { ...state, errorsShown: false };
    default:
      return state;
  }
}

/**
 * Assemble the {@link FeedItem} list the composer currently describes: the
 * toggled Case File Claims (as `{ from: 'claim' }` items, in selection order)
 * followed by the staged composed Propositions (as `{ from: 'composed' }`
 * items). This is what the screen hands to the injected `validateFeed`.
 */
export function assembleFeed(state: FeedState): FeedItem[] {
  const claimItems: FeedItem[] = state.selected.map((claim) => ({
    from: 'claim',
    claim,
  }));
  const composedItems: FeedItem[] = state.composed.map((prop) => ({
    from: 'composed',
    prop,
  }));
  return [...claimItems, ...composedItems];
}

/** The player-facing label for a compose field. */
export function fieldLabel(field: ComposeField): string {
  switch (field) {
    case 'predicate':
      return 'predicate';
    case 'subject':
      return 'subject';
    case 'object':
      return 'object';
    case 'place':
      return 'place';
    default:
      return field;
  }
}
