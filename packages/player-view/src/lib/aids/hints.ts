/**
 * The content-driven hints store (Requirement 26.6; design, "Help and hints":
 * "Hints are content-defined `{ trigger, text }`. Seen flags live in the view
 * state, not the Sim").
 *
 * A hint is one-off guidance the UI shows the **first time** each hint trigger
 * occurs, and only when hints are enabled. The hints themselves are authored in
 * a pack's `hints.yaml` and reach us through the loaded {@link ContentSet}; this
 * module owns the *view-side* part the design pins here:
 *
 * - the **seen flags**, which track which triggers have already fired. They live
 *   in this store — a Player-View structure — and never in the {@link WorldState}
 *   or the Truth Store, so showing a hint cannot perturb the Sim and a replay of
 *   the same seed is unaffected by whether a player saw a hint; and
 * - the **first-occurrence** rule: {@link HintStore.fire} returns a hint the
 *   first time its trigger is raised and `undefined` on every later occurrence,
 *   so a trigger that recurs each phase (a low Budget, say) shows its hint once.
 *
 * The store is deliberately a pure view structure with no engine coupling: it
 * reads the hint text from content and keeps a {@link Set} of seen triggers. A
 * caller raises a trigger by calling {@link HintStore.fire}; whether a trigger
 * has *occurred* is a question the caller answers from the player-visible view
 * (e.g. "the player now holds an Unidentified Subject"), which keeps this store
 * free of any truth read.
 */

import type { ContentSet, Hint, HintTrigger } from '@tradecraft/content';
import {
  MADE_FACT_LINE,
  balance,
  type Action,
  type GameTime,
  type WorldState,
} from '@tradecraft/engine';

import type { CaseFile } from '../casefile/casefile.js';
import type { ActionOption } from '../api/types.js';

/**
 * A hint ready to show the player: its trigger and its rendered text. The text
 * is taken verbatim from the authored hint (the core-pack hints are plain prose
 * with no template slots), so this carries nothing truth-bearing.
 */
export interface HintView {
  readonly trigger: HintTrigger;
  readonly text: string;
}

/**
 * The view-side hints store. Construct it from the loaded {@link ContentSet}
 * (the authored hints) and whether hints are enabled; then raise a trigger with
 * {@link fire} each time the UI detects the trigger's situation. The store keeps
 * the seen flags, so the first `fire` of a trigger returns its hint and later
 * ones return `undefined`.
 */
export class HintStore {
  /** The authored hint for each trigger (at most one per trigger). */
  private readonly byTrigger: ReadonlyMap<HintTrigger, Hint>;
  /** Whether hints are enabled (the resolved scenario `hints` setting). */
  private readonly enabledFlag: boolean;
  /** The triggers that have already fired (the view-side seen flags). */
  private readonly seen: Set<HintTrigger>;

  constructor(content: ContentSet, enabled: boolean) {
    this.byTrigger = indexHintsByTrigger(content);
    this.enabledFlag = enabled;
    this.seen = new Set();
  }

  /**
   * Raise a trigger. Returns the trigger's hint the **first** time it is raised
   * (and only when hints are enabled and the pack defines a hint for it), and
   * `undefined` on every later call — the first-occurrence rule (Requirement
   * 26.6). Raising a trigger only marks the view-side seen flag; it never
   * touches Sim state.
   *
   * A trigger with no authored hint, or a store with hints disabled, is a
   * silent no-op: the seen flag is still recorded so later calls stay
   * consistent, but nothing is shown. (Marking a disabled trigger as seen keeps
   * the behaviour "shown at most once" even if hints are toggled on later in a
   * session; the design's intent is one-off guidance, not a backlog.)
   */
  fire(trigger: HintTrigger): HintView | undefined {
    if (this.seen.has(trigger)) {
      return undefined;
    }
    this.seen.add(trigger);
    if (!this.enabledFlag) {
      return undefined;
    }
    const hint = this.byTrigger.get(trigger);
    if (hint === undefined) {
      return undefined;
    }
    return { trigger, text: hint.text };
  }

  /** Whether a trigger has already fired (its view-side seen flag is set). */
  hasSeen(trigger: HintTrigger): boolean {
    return this.seen.has(trigger);
  }

  /**
   * Whether hints are enabled for this store (the resolved scenario `hints`
   * setting). Read by the facade's `saves.load` so it rebuilds the loaded game's
   * hints store with the same enabled flag as the live one, keeping the toggle
   * stable across a load (a save/load never silently turns hints on or off).
   */
  get enabled(): boolean {
    return this.enabledFlag;
  }

  /**
   * The hint a trigger would show, ignoring the seen flags — a read-only peek
   * for a Help/debug surface that lists the available hints. Returns
   * `undefined` when the pack defines no hint for the trigger. Does not mark the
   * trigger as seen.
   */
  peek(trigger: HintTrigger): HintView | undefined {
    const hint = this.byTrigger.get(trigger);
    return hint === undefined ? undefined : { trigger, text: hint.text };
  }
}

/**
 * Index the loaded hints by their trigger. There is one hint per trigger by
 * convention (the core pack authors exactly one); if a pack set ever defines
 * more than one for a trigger, the last one in the registry's iteration order
 * wins, which is deterministic because the loader keys hints by their
 * namespaced id in insertion (load) order.
 */
function indexHintsByTrigger(content: ContentSet): Map<HintTrigger, Hint> {
  const byTrigger = new Map<HintTrigger, Hint>();
  for (const hint of content.hints.values()) {
    byTrigger.set(hint.trigger, hint);
  }
  return byTrigger;
}

// ---------------------------------------------------------------------------
// View-side trigger definitions (slice-integration task 8.4; design "Hints")
// ---------------------------------------------------------------------------
//
// The HintStore above owns the seen flags and the first-occurrence rule. It does
// NOT decide *whether* a trigger's situation has occurred — the design pins that
// decision to the Player View: "the pipeline fires hint triggers from Player
// View facts only" (design, "Hints"). This section is that decision, as a pure
// function of a player-visible snapshot. The Turn Pipeline builds the snapshot
// after a turn commits and `fire`s each trigger the function reports, so a hint
// shows the first time its situation is true and never again.
//
// Every trigger reads only Player-View data: the committed WorldState's
// view-safe fields (budget, Standing, read Documents, collected Intercepts,
// arranged meetings, recruited Relationships, open Directives, the brief leads),
// the Case File's Claims, the turn's Fact Lines, and the action catalogue. None
// reads the Truth Store or a Truth-branded field. Two triggers the pack names
// would otherwise read ground truth — `cover-suspicion-high` (the player's
// hidden Cover Suspicion is a `Truth<number>`) and `plot-deadline-near` (the
// Plot's hidden schedule) — are redefined here to stay truth-free:
//
// - `cover-suspicion-high` fires on the "you may have been made" Fact Line the
//   surveil/follow resolvers surface ({@link MADE_FACT_LINE}), a player-visible
//   signal that the player's cover is drawing attention, instead of reading
//   `player.coverSuspicion`.
// - `plot-deadline-near` fires when a Starting-Brief lead the player holds in
//   the Case File states a deadline (a Proposition window end) within one day of
//   now, instead of reading the Plot's hidden stage schedule.

/**
 * The fraction of the starting Budget below which `budget-low` fires (design,
 * "Hints": "Budget below 20% of start"). A whole-number comparison against
 * `0.2 × ledger.start`.
 */
export const BUDGET_LOW_FRACTION = 0.2;

/**
 * The horizon, in days, within which a stated deadline counts as "near" for
 * `directive-near-deadline` and `plot-deadline-near` (design: "within one day").
 * A deadline at or before `now + 1 day` (and not already past) is near.
 */
export const DEADLINE_NEAR_DAYS = 1;

/**
 * The player-visible snapshot the trigger definitions read (slice-integration
 * task 8.4). The Turn Pipeline assembles it after a turn commits:
 *
 * - `state` — the committed {@link WorldState}, read only for its view-safe
 *   fields (never a {@link Truth}-branded one).
 * - `caseFile` — the player's {@link CaseFile}, for the `unk:` and brief-lead
 *   checks.
 * - `factLines` — the Fact Lines this turn surfaced, for `cover-suspicion-high`.
 * - `actions` — the action catalogue this turn ends on, for
 *   `first-arrest-available`.
 * - `briefLeadDocs` — the Document ids of the Starting-Brief Cable(s) whose
 *   Claims are the player's leads; a Case File Claim sourced from one of these
 *   with a near stated deadline fires `plot-deadline-near`. Omitting it (no
 *   brief seeded yet) simply never fires that trigger.
 * - `action` — the action the turn committed, when it was an action turn. Only
 *   `first-dead-drop` reads it (the player servicing their own drop); a dialogue
 *   or boundary turn omits it.
 */
export interface HintTriggerInput {
  readonly state: WorldState;
  readonly caseFile: CaseFile;
  readonly factLines: readonly string[];
  readonly actions: readonly ActionOption[];
  readonly briefLeadDocs?: ReadonlySet<string>;
  readonly action?: Action;
}

/** Whether an id is an Unidentified-Subject id (`unk:<n>`). */
function isUnkId(id: string): boolean {
  return id.startsWith('unk:');
}

/** The flat phase index of a {@link GameTime}, for ordering two times. */
function phaseIndex(t: GameTime): number {
  return t.day * 4 + t.phase;
}

/**
 * Whether `deadline` is near `now`: at or after `now` and no later than
 * {@link DEADLINE_NEAR_DAYS} day(s) ahead. A deadline already in the past is not
 * near — the window to act on it has closed.
 */
function deadlineIsNear(deadline: GameTime, now: GameTime): boolean {
  const nowIdx = phaseIndex(now);
  const dueIdx = phaseIndex(deadline);
  return dueIdx >= nowIdx && dueIdx <= nowIdx + DEADLINE_NEAR_DAYS * 4;
}

/** Whether the Case File holds any Claim referencing an Unidentified Subject. */
function hasUnidentifiedSubject(caseFile: CaseFile): boolean {
  for (const claim of caseFile.list()) {
    const { subject, object } = claim.prop;
    if (isUnkId(subject) || (typeof object === 'string' && isUnkId(object))) {
      return true;
    }
  }
  return false;
}

/**
 * Whether a Starting-Brief lead the player holds states a deadline within one
 * day. A lead is a Case File Claim sourced from a brief Cable Document
 * (`briefLeadDocs`); its stated deadline is its Proposition's window end
 * (`window.to`). This reads only the Case File and the current time, so it stays
 * truth-free — the design's redefinition of `plot-deadline-near`.
 */
function briefLeadDeadlineNear(input: HintTriggerInput): boolean {
  const docs = input.briefLeadDocs;
  if (docs === undefined || docs.size === 0) {
    return false;
  }
  const now = input.state.time;
  for (const claim of input.caseFile.list()) {
    if (claim.source.kind !== 'document' || !docs.has(claim.source.id)) {
      continue;
    }
    const to = claim.prop.window?.to;
    if (to !== undefined && deadlineIsNear(to, now)) {
      return true;
    }
  }
  return false;
}

/** Whether any open Directive comes due within one day (design, "Hints"). */
function openDirectiveNearDeadline(state: WorldState): boolean {
  const now = state.time;
  return state.station.directives.some(
    (d) => d.status === 'open' && deadlineIsNear(d.deadline, now),
  );
}

/** Whether the action catalogue offers an allowed `arrest`. */
function arrestAvailable(actions: readonly ActionOption[]): boolean {
  return actions.some((o) => o.action.kind === 'arrest' && o.quote.allowed);
}

/**
 * The view-side hint trigger definitions (slice-integration task 8.4; design,
 * "Hints"): the set of {@link HintTrigger}s whose situation holds in the given
 * player-visible snapshot. Pure — it reads only `input` and never the Truth
 * Store — and order-stable (the fixed {@link HINT_TRIGGER_ORDER}). The Turn
 * Pipeline `fire`s each returned trigger on the {@link HintStore}, which shows a
 * hint the first time its trigger occurs and suppresses every repeat.
 *
 * The returned list is the triggers that *currently* hold, not only the ones
 * that newly became true — the HintStore's seen flags make firing idempotent, so
 * the pipeline may safely raise a persistent trigger (a low Budget, a held
 * Unidentified Subject) every turn and the player still sees its hint once.
 */
export function hintTriggers(input: HintTriggerInput): HintTrigger[] {
  const { state, caseFile, factLines, actions } = input;
  const ledger = state.station.ledger;
  const recruited = Object.values(state.relationships).some((r) => r.recruited);

  const holds: Record<HintTrigger, boolean> = {
    'first-unidentified-subject': hasUnidentifiedSubject(caseFile),
    'first-intercept': Object.keys(state.intercepts).length > 0,
    'first-dead-drop': input.action?.kind === 'service-drop',
    'first-meeting': Object.keys(state.meetings).length > 0,
    'first-recruitment': recruited,
    'first-document': state.player.readDocuments.length > 0,
    'budget-low': balance(ledger) < BUDGET_LOW_FRACTION * ledger.start,
    'standing-low': state.station.standing < 0,
    'cover-suspicion-high': factLines.includes(MADE_FACT_LINE),
    'directive-near-deadline': openDirectiveNearDeadline(state),
    'plot-deadline-near': briefLeadDeadlineNear(input),
    'first-arrest-available': arrestAvailable(actions),
  };

  return HINT_TRIGGER_ORDER.filter((t) => holds[t]);
}

/**
 * The fixed order the trigger definitions report in, so a turn that newly
 * satisfies several triggers at once fires them deterministically. It is the
 * design's "Hints" listing order.
 */
export const HINT_TRIGGER_ORDER: readonly HintTrigger[] = [
  'first-unidentified-subject',
  'first-intercept',
  'first-dead-drop',
  'first-meeting',
  'first-recruitment',
  'first-document',
  'budget-low',
  'standing-low',
  'cover-suspicion-high',
  'directive-near-deadline',
  'plot-deadline-near',
  'first-arrest-available',
];
