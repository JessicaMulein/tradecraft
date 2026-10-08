/**
 * The Help view projection (Requirement 26.5; design, "Help and hints": "Help
 * lists `quote()` results for the current Location plus the glossary").
 *
 * `helpView` builds the Help panel: the engine's pure `quote()` for the actions
 * the current Location offers, together with the glossary drawn from the loaded
 * {@link ContentSet}. It is a pure read of view-safe surface — the Location
 * Type's `allowedActions`, the shared Location gate, the per-action base cost,
 * and the authored glossary — so, like the other projections in `../api`, it
 * reads no {@link Truth} field and holds no handle on the Truth Store.
 *
 * ## Why representative quotes
 *
 * The design's "`quote()` results for the current Location" is the cost and
 * eligibility the UI shows *before* a target is chosen. Some actions quote
 * fully from the Location alone (`wait` always; `surveil`/`intercept` at the
 * current Location), and for those `helpView` calls the engine's real `quote()`
 * with a representative action pinned to the current Location. Others
 * (`travel`, `talk`, `read`, `pay`, …) only become quotable once the player
 * picks a target, so for them `helpView` reports the shared Location gate —
 * whether the Location allows the action and is open now (Requirement 21.5) —
 * and the action's documented representative base cost. Either way the entry
 * answers Requirement 26.5's "the actions available at the current Location with
 * their costs"; `targeted` marks the second group so the TUI can prompt for a
 * target at use.
 */

import {
  ARREST_PHASE_COST,
  CABLE_PHASE_COST,
  DECRYPT_PHASE_COST,
  PAY_PHASE_COST,
  TASK_PHASE_COST,
  isOpenAt,
  locationTypeOf,
  quote as engineQuote,
  type Action,
  type ActionKind,
  type ActionQuote,
  type Location,
  type ResolverContext,
  type WorldState,
} from '@tradecraft/engine';
import type { GlossaryTerm } from '@tradecraft/content';

import type {
  HelpActionEntry,
  HelpGlossaryEntry,
  HelpView,
} from '../api/types.js';

/**
 * The representative base phase cost for an action kind, as the help list shows
 * it before a target is chosen. These mirror the per-action cost constants in
 * the engine's action modules (`TALK_PHASE_COST`, `READ_PHASE_COST`, …); they
 * are the cost the engine's `quote()` returns for a straightforward instance of
 * the kind. `travel` and `wait` vary by route/phase count and are quoted with a
 * representative value (one phase) here. Case File / view operations (grade,
 * link, note, help) are not actions and never appear.
 */
const BASE_PHASE_COST: Readonly<Record<ActionKind, number>> = {
  talk: 1,
  approach: 1,
  travel: 1,
  'arrange-meeting': 1,
  surveil: 1,
  follow: 1,
  'service-drop': 1,
  intercept: 1,
  decrypt: DECRYPT_PHASE_COST,
  read: 1,
  cable: CABLE_PHASE_COST,
  task: TASK_PHASE_COST,
  pay: PAY_PHASE_COST,
  confront: 1,
  arrest: ARREST_PHASE_COST,
  'turn-agent': 1,
  feed: 0,
  'attend-duty': 1,
  wait: 1,
};

/**
 * The action kinds that quote fully from the current Location, with a
 * representative action we can build without a player-chosen target. For these
 * `helpView` calls the engine's real `quote()`.
 */
const SELF_QUOTABLE: ReadonlySet<ActionKind> = new Set<ActionKind>([
  'wait',
  'surveil',
  'intercept',
]);

/**
 * Build the {@link HelpView} for the player's current Location and the loaded
 * glossary. `ctx` carries the Content Set the engine `quote()` and the Location
 * Type lookup need; `glossary` is the Content Set's glossary registry (keyed by
 * term). Pure over view-safe state and content.
 */
export function helpView(
  state: WorldState,
  ctx: ResolverContext,
  glossary: ReadonlyMap<string, GlossaryTerm>,
): HelpView {
  const locId = state.player.loc;
  const place = state.city.locations[locId];
  const name = place?.name ?? localOf(locId);

  const actions: HelpActionEntry[] = [];
  if (place !== undefined) {
    const type = locationTypeOf(ctx.content, place);
    const kinds = (type?.allowedActions ?? []) as readonly ActionKind[];
    for (const kind of kinds) {
      actions.push(helpEntryFor(state, ctx, place, kind));
    }
  }

  return {
    location: { id: locId, name },
    actions,
    glossary: glossaryEntries(glossary),
  };
}

/** Build one {@link HelpActionEntry} for an allowed action kind. */
function helpEntryFor(
  state: WorldState,
  ctx: ResolverContext,
  place: Location,
  kind: ActionKind,
): HelpActionEntry {
  if (SELF_QUOTABLE.has(kind)) {
    const action = representativeAction(state, kind);
    if (action !== undefined) {
      return { kind, quote: engineQuote(state, action, ctx), targeted: false };
    }
  }
  // Target-dependent (or otherwise not self-quotable): report the shared
  // Location gate and the representative base cost.
  return { kind, quote: gateQuote(state, place, kind), targeted: isTargeted(kind) };
}

/**
 * A representative {@link Action} of a self-quotable kind, pinned to the current
 * Location. Returns `undefined` for kinds that are not self-quotable (they take
 * the gate path instead).
 */
function representativeAction(
  state: WorldState,
  kind: ActionKind,
): Action | undefined {
  switch (kind) {
    case 'wait':
      return { kind: 'wait', phases: 1 };
    case 'surveil':
      return { kind: 'surveil', at: state.player.loc, phases: 1 };
    case 'intercept':
      return { kind: 'intercept' };
    default:
      return undefined;
  }
}

/**
 * The Location-gate quote for a target-dependent action kind: `allowed` is true
 * when the Location is open now and its Type permits the kind, matching the
 * engine's shared Location gate (Requirement 21.5). The `phases` is the
 * representative base cost; `money` is 0 (money costs depend on the chosen
 * target). A closed Location or a kind the Type does not permit yields
 * `allowed: false` with the matching reason.
 */
function gateQuote(
  state: WorldState,
  place: Location,
  kind: ActionKind,
): ActionQuote {
  if (!isOpenAt(place, state.time.phase)) {
    return {
      allowed: false,
      reason: `${place.name} is closed in this phase`,
      phases: 0,
      money: 0,
    };
  }
  return { allowed: true, phases: BASE_PHASE_COST[kind], money: 0 };
}

/** Action kinds whose eligibility/exact cost depends on a chosen target. */
function isTargeted(kind: ActionKind): boolean {
  return !SELF_QUOTABLE.has(kind);
}

/** The glossary entries in alphabetical order by term. */
function glossaryEntries(
  glossary: ReadonlyMap<string, GlossaryTerm>,
): HelpGlossaryEntry[] {
  return [...glossary.values()]
    .map((t) => ({ term: t.term, definition: t.definition }))
    .sort((a, b) => (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));
}

/** The local part of a namespaced entity id (`loc:kiosk` -> `kiosk`). */
function localOf(id: string): string {
  const colon = id.indexOf(':');
  return colon === -1 ? id : id.slice(colon + 1);
}
