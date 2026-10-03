/**
 * The feed-validation {@link FeedView} projection (slice-integration task 9.8;
 * design, "Facade: `validateFeed`"; Requirements 14.1, 14.2, 14.3).
 *
 * The engine's shared `validateFeedItems` (task 2.5,
 * `engine/src/lib/action/feed-validation.ts`) is the one pure function that
 * decides whether a feed is valid, so the `feed` action's quote and the facade's
 * `validateFeed` cannot disagree (Req 14.4). It reads only a truth-free
 * {@link FeedView}: the current game time, the player's known set, and the held
 * Case File Claims (with the held `IS_ALIAS_OF` Claims among them).
 *
 * {@link feedView} builds that view from Player-View and Case File data alone —
 * the live {@link WorldState}'s clock and `player.known`, plus the held Claims
 * projected the same way `projectResolverContext` projects them (a
 * `Record<ClaimId, Proposition>`). It reveals no ground truth and reads no Truth
 * Store, so the facade's `validateFeed` stays truth-independent (Req 14.3).
 */

import {
  feedViewOf,
  type ClaimId,
  type FeedView,
  type Proposition,
  type WorldState,
} from '@tradecraft/engine';

import type { CaseFile } from '../casefile/casefile.js';

/**
 * The Player-View and Case File inputs {@link feedView} reads: the live world
 * state (for the clock and the known set) and the Case File (for the held
 * Claims). The shape is structural so the facade can hand it the pieces of its
 * live game without this module depending on the facade type.
 */
export interface FeedViewInput {
  /** The live world state, for the current time and the player's known set. */
  readonly state: WorldState;
  /** The player's Case File, for the held Claims and the held aliases among them. */
  readonly caseFile: CaseFile;
}

/**
 * Build the engine {@link FeedView} for the current turn from Player-View and
 * Case File data. The held Claims are projected as the bare {@link Proposition}
 * each asserts, keyed by Claim id — the same projection
 * `projectResolverContext` builds for `ResolverContext.claims` — and
 * {@link feedViewOf} picks the held `IS_ALIAS_OF` Claims out of them. Reads no
 * Truth Store (Req 14.3).
 */
export function feedView(input: FeedViewInput): FeedView {
  const { state, caseFile } = input;
  const claims: Record<ClaimId, Proposition> = {};
  for (const claim of caseFile.list()) {
    claims[claim.id] = claim.prop;
  }
  return feedViewOf(state, claims);
}
