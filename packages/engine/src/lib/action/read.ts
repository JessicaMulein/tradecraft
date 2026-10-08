/**
 * The read action (design, "Action Resolver" → **Read**, and "Document
 * Generator"; Requirements 30.3, 30.4; Property 22).
 *
 * Reading a Document puts its fact-layer text in front of the player and, on the
 * **first** read, turns the Propositions the Document asserts into Case File
 * Claims sourced `document`. Two rules anchor the action:
 *
 * - **First-read seeds Claims (Requirement 30.3).** On the first read of a
 *   Document, its asserted Propositions become Observations the player
 *   perceived — one `proposition` Observation per asserted Proposition at the
 *   current time, each carrying the source `{ kind:'document', id }` — and
 *   `claimsAdded` names them so the player-view layer records one Case File
 *   Claim per Proposition under that source.
 * - **Reading is idempotent (Requirement 30.4, Property 22).** Reading the same
 *   Document again adds **no** new Claims: a repeat read returns the Document's
 *   text as a plain `message` Observation and an empty `claimsAdded`, and leaves
 *   `player.readDocuments` unchanged. The engine tracks which Documents have
 *   been read (in `player.readDocuments`), so idempotence is a Sim invariant
 *   rather than something the player-view layer must dedupe.
 *
 * ## Obtainable Locations (Requirement 30.3)
 *
 * A Document is only readable where it is **obtainable**. A Document with
 * `obtainableAt: LocId[]` (a public text at a kiosk, library or bookshop) can be
 * read only when the player is at one of those Locations; a Document with no
 * `obtainableAt` (the brief Cable, a Dossier, seized material) is "in hand" and
 * readable anywhere. `quoteRead` enforces this: it quotes `allowed: false` with
 * a reason naming the obtainable Locations when the player is not where the
 * Document can be obtained. (The shared Location gate in `./action.ts` does not
 * apply — `read` has no `actionLocation`, so obtainable-Location checking is
 * entirely `quoteRead`'s job.)
 *
 * ## Where the Propositions live
 *
 * `WorldState.documents` stores only the bare {@link Document} (its `asserts` is
 * a `PropId[]`). The full Propositions a composer threaded onto a Document
 * (`ComposedDocument.propositions`) are kept in `WorldState.documentPropositions`
 * keyed by PropId (populated at generation; later-minted Documents register
 * theirs when they enter the world). `resolveRead` looks each asserted PropId up
 * there; a PropId with no stored Proposition is skipped defensively rather than
 * crashing a turn.
 *
 * Both functions are pure: `quoteRead` draws nothing, and `resolveRead` makes no
 * PRNG draws (it is handed `rng` only to match the resolver signature), so the
 * same inputs always yield the same result.
 */

import type { Proposition } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import type { Prng } from '../prng/prng.js';
import type { ActionQuote, ActionResult, Observation } from './result.js';
import { learnAnnouncedStatus } from '../ambient/locations.js';
import { noticeStillPosted } from '../ambient/news.js';
import type { ObservationSource, ReadAction } from './types.js';

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

/**
 * The phase cost of reading a Document. Reading a file through costs one phase
 * — the design's `ActionQuote` carries a phase cost, and reading (whether a
 * Document held in hand or one obtained at a Location) is a time-consuming act
 * the Turn Pipeline turns into a clock advance. Reading has no money cost.
 */
export const READ_PHASE_COST = 1;

// ---------------------------------------------------------------------------
// quote
// ---------------------------------------------------------------------------

/**
 * Quote a {@link ReadAction} (pure, no draws). Allowed when the Document exists
 * and is obtainable where the player stands:
 *
 * - a Document with no `obtainableAt` is in hand and readable anywhere;
 * - a Document with `obtainableAt` is readable only when `player.loc` is one of
 *   those Locations.
 *
 * Otherwise the quote is `allowed: false` with a reason — naming the obtainable
 * Locations when the player is in the wrong place, or that no such Document
 * exists. The cost is {@link READ_PHASE_COST} phases and no money.
 */
export function quoteRead(state: WorldState, a: ReadAction): ActionQuote {
  const doc = state.documents[a.doc];
  if (doc === undefined) {
    return {
      allowed: false,
      reason: `no such Document ${a.doc}`,
      phases: 0,
      money: 0,
    };
  }

  if (!noticeStillPosted(state, a.doc)) {
    return {
      allowed: false,
      reason: `${doc.title} has been taken down`,
      phases: 0,
      money: 0,
    };
  }

  const obtainableAt = doc.obtainableAt;
  if (obtainableAt !== undefined && obtainableAt.length > 0) {
    if (!obtainableAt.includes(state.player.loc)) {
      return {
        allowed: false,
        reason: `${doc.title} can only be read where it is obtainable: ${obtainableAt.join(
          ', ',
        )}`,
        phases: READ_PHASE_COST,
        money: 0,
      };
    }
  }

  return { allowed: true, phases: READ_PHASE_COST, money: 0 };
}

// ---------------------------------------------------------------------------
// First-read tracking
// ---------------------------------------------------------------------------

/** True when the player has already read the Document (Requirement 30.4). */
export function hasReadDocument(state: WorldState, doc: ReadAction['doc']): boolean {
  return state.player.readDocuments.includes(doc);
}

/**
 * Mark a Document read in a copy of the {@link WorldState}, appending its id to
 * `player.readDocuments` (idempotent: a Document already marked read is left as
 * is, so the set never carries a duplicate).
 */
export function markDocumentRead(state: WorldState, doc: ReadAction['doc']): WorldState {
  if (hasReadDocument(state, doc)) {
    return state;
  }
  return {
    ...state,
    player: {
      ...state.player,
      readDocuments: [...state.player.readDocuments, doc],
    },
  };
}

// ---------------------------------------------------------------------------
// resolve
// ---------------------------------------------------------------------------

/**
 * Resolve a {@link ReadAction} (design `resolve`; pure, draws nothing). The
 * caller (`resolve`) has already confirmed the action is allowed.
 *
 * On the **first** read, the result's `observations` are the Document's asserted
 * Propositions (one `proposition` Observation each, stamped at the current time
 * and sourced `{ kind:'document', id }`), `claimsAdded` names those Propositions
 * by id (the player-view layer records one `document`-sourced Claim per
 * Proposition), and the next state marks the Document read. On a **repeat**
 * read, the result is a single `message` Observation carrying the Document's
 * text, no `claimsAdded`, and the state is unchanged (Requirement 30.4,
 * Property 22).
 *
 * `factLines` is left to the caller to render (so this module does not import
 * `./action.ts` and form a cycle): `render` turns the result's Observations into
 * Fact Lines through the predicate templates and the player namer.
 */
export function resolveRead(
  state: WorldState,
  a: ReadAction,
  _rng: Prng,
  render: (observations: readonly Observation[]) => string[],
): { next: WorldState; result: ActionResult } {
  const doc = state.documents[a.doc];
  const scene = sceneDescriptorAt(state, state.player.loc);

  // A disallowed read should have been rejected by `quote`; if the Document is
  // somehow missing here, return an empty result rather than throwing.
  if (doc === undefined) {
    return {
      next: state,
      result: { observations: [], factLines: [], scene, events: [], claimsAdded: [] },
    };
  }

  // Repeat read: idempotent. Re-reading the text asserts no new Claims.
  if (hasReadDocument(state, a.doc)) {
    const observations: Observation[] = [
      { kind: 'message', line: `You read ${doc.title} again.` },
    ];
    return {
      next: state,
      result: {
        observations,
        factLines: render(observations),
        scene,
        events: [],
        claimsAdded: [],
      },
    };
  }

  // First read: the Document's asserted Propositions become Observations the
  // player perceived, each sourced to the Document, and `claimsAdded` names
  // them. A PropId with no stored Proposition is skipped defensively (a composer
  // bug would be the only cause).
  const source: ObservationSource = { kind: 'document', id: a.doc };
  const observations: Observation[] = [];
  const claimsAdded: string[] = [];
  for (const propId of doc.asserts) {
    const prop: Proposition | undefined = state.documentPropositions[propId];
    if (prop === undefined) {
      continue;
    }
    observations.push({ kind: 'proposition', prop, at: state.time, source });
    claimsAdded.push(propId);
  }

  const next = learnAnnouncedStatus(markDocumentRead(state, a.doc), `${doc.title}\n${doc.body}`);
  return {
    next,
    result: {
      observations,
      factLines: render(observations),
      scene,
      events: [],
      claimsAdded,
    },
  };
}

/**
 * Build the read scene descriptor. Kept local (rather than importing `sceneAt`
 * from `./action.js`) to avoid a circular import at module load: `action.ts`
 * imports this module for the read resolver, so this module builds its own scene
 * from the same `WorldState` fields — the same pattern `./travel.ts` uses.
 */
function sceneDescriptorAt(state: WorldState, loc: WorldState['player']['loc']): ActionResult['scene'] {
  const place = state.city.locations[loc];
  if (place === undefined) {
    return { loc, description: '', atmosphere: [], risk: 0, visible: [] };
  }
  return {
    loc,
    description: place.description,
    atmosphere: [...place.atmosphere],
    risk: place.risk,
    visible: [],
  };
}
