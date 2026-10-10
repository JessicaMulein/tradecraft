/**
 * The {@link Directive} data model and its objective enum (design, "Station,
 * Directives and Budget"; Requirement 27.2).
 *
 * This module is deliberately *dependency-light*: it imports only the core model
 * ids and nothing from `../model/state.ts`. That is what lets `../model/state.ts`
 * re-export {@link Directive} from here (so `WorldState.station.directives`
 * carries it) without forming an import cycle — the same split the design uses
 * for `docs/document.ts` (the interface, a leaf) versus `docs/newspaper.ts` (the
 * behaviour, which imports the state module). The per-phase check that settles a
 * Directive and moves Standing — which needs the state module's `SimEvent` —
 * lives in `./directives.ts`, which state.ts does *not* re-export.
 */

import type { ChannelId, EntityId, GameTime, LocId } from '../model/core.js';

/**
 * A Directive id. The design leaves it a plain string ("may stay a plain
 * string"); it is declared *here* (the leaf) rather than in state.ts so this
 * module names it without importing state.ts, which would re-form the cycle the
 * leaf split exists to break. `../model/state.ts` re-exports it under the same
 * name, so every importer is unaffected.
 */
export type DirectiveId = string;

/**
 * A Directive objective (design: "objective: DirectiveObjective; // e.g.
 * identify(role), recruit(n), arrest(role), intercept(channel)"). The four
 * kinds are a closed union so the Sim can check each one; a new kind of
 * objective needs a code change here and in the Pipeline's evaluator, exactly as
 * the design intends ("Directive objectives come from a fixed enum").
 *
 * - `identify` — identify the entity (by role; carried as the entity the role
 *   resolves to, an `npc:`/`unk:` id). Met when the player has identified it.
 * - `recruit`  — recruit at least `count` Assets. Met by the recruit tally.
 * - `arrest`   — arrest the entity (a role, carried as its entity id). Met when
 *   that arrest has landed.
 * - `intercept`— collect an Intercept off `channel`. Met by the intercept log.
 * - `smuggle` — deliver a named person to a Location. Met from the street-ops
 *   delivery record. Plot stages do not emit this kind; the add-on registers it.
 *
 * Every kind is a player-PROGRESS objective: whether it is met is read from the
 * Player View / Case File side by the injected objective evaluator (see
 * `./directives.ts`), never from the Truth Store.
 */
export type DirectiveObjective =
  | { readonly kind: 'identify'; readonly entity: EntityId }
  | { readonly kind: 'recruit'; readonly count: number }
  | { readonly kind: 'arrest'; readonly entity: EntityId }
  | { readonly kind: 'intercept'; readonly channel: ChannelId }
  | { readonly kind: 'smuggle'; readonly npc: EntityId; readonly to: LocId };

/** The station Directive objective kinds. `smuggle` is registered by street-ops and is not in this list. */
export const DIRECTIVE_OBJECTIVE_KINDS = [
  'identify',
  'recruit',
  'arrest',
  'intercept',
] as const;

/** One Directive objective kind. */
export type DirectiveObjectiveKind = (typeof DIRECTIVE_OBJECTIVE_KINDS)[number];

/** A Directive's running status (design's `'open' | 'met' | 'failed'`). */
export type DirectiveStatus = 'open' | 'met' | 'failed';

/** The three Directive statuses, as a value. */
export const DIRECTIVE_STATUSES = ['open', 'met', 'failed'] as const;

/**
 * A Station Directive (design's `Directive`). An objective the Chief issues with
 * a deadline and a Standing `reward`: the reward is added to Standing when the
 * objective is met, and subtracted when the deadline passes unmet (Requirement
 * 27.3). `text` is the player-facing wording; `status` tracks the lifecycle.
 *
 * This is the real interface that replaces the task-4.6 skeleton `Directive` in
 * `../model/state.ts`; `WorldState.station.directives` is `readonly Directive[]`.
 */
export interface Directive {
  readonly id: DirectiveId;
  /** The player-facing wording of the objective. */
  readonly text: string;
  /** The objective the Sim checks each phase. */
  readonly objective: DirectiveObjective;
  /** When the Directive comes due. */
  readonly deadline: GameTime;
  /** The Standing moved on success (+) or failure (−). */
  readonly reward: number;
  /** The city the objective names, when the Chief assigns it outside the hub. */
  readonly city?: `city:${string}`;
  /** The lifecycle status. */
  readonly status: DirectiveStatus;
}
