/**
 * The Journal projection (task 16.2; Requirements 33.1, 33.2; design, "Player
 * Aids").
 *
 * {@link journalView} turns a {@link Journal} store into the view-safe
 * {@link JournalView} the {@link EngineApi} exposes: the fact log grouped by day
 * and phase (Req 33.1), the same entries flat for a chronological read, and the
 * player's notes (Req 33.2). It is a pure read of the store — every value is an
 * already-rendered Fact Line, note text or a view-safe id, so the projection
 * cannot carry Flavour or a {@link Truth} field (Req 2.2).
 */

import type { JournalView } from '../api/types.js';
import type { Journal } from './journal.js';

/**
 * Build the {@link JournalView} from a {@link Journal} store. `days` is the fact
 * log grouped by day then phase; `entries` is the same entries flat, earliest
 * first; `notes` is the player's notes, earliest first. The store's own
 * accessors return fresh snapshots, so the returned view shares nothing mutable
 * with the store.
 */
export function journalView(journal: Journal): JournalView {
  return {
    days: journal.grouped(),
    entries: journal.entries(),
    notes: journal.notes(),
  };
}
