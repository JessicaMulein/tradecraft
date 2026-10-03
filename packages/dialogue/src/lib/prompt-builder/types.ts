/**
 * The input shapes the {@link buildPrompt} Prompt Builder reads. They are
 * defined here, in the dialogue package, because the pieces they carry come
 * from several places and from tasks that have not landed yet:
 *
 * - the persona, Cover Story, Agenda and Knowledge Slice come from the engine's
 *   world generation (reused as-is);
 * - the Told List, the relationship summary and recent turns are maintained by
 *   the Claim Extractor and the Dialogue Loop (tasks 14.10, 16.8), which are
 *   later tasks;
 * - the classified Intent comes from the Intent Classifier (task 14.5), also a
 *   later task.
 *
 * Rather than wait on those, the Prompt Builder names the minimal view it needs
 * of each. The later tasks pass their richer structures in; the extra fields
 * are simply ignored.
 */

import type { Namer, PredicateRegistry } from '@tradecraft/content';
import type {
  Agenda,
  CoverStory,
  EntityId,
  KnowledgeSlice,
  Persona,
  Proposition,
} from '@tradecraft/engine';

/**
 * The slice of {@link Persona} the prompt renders. The engine's `Persona` is a
 * superset; the builder reads only the view-safe surface it speaks the NPC
 * with.
 */
export type PromptPersona = Pick<
  Persona,
  'name' | 'background' | 'voiceTraits' | 'mannerisms'
>;

/**
 * One entry on the Told List: a Proposition the NPC has already asserted to the
 * player (Requirement 6.2). The builder renders `proposition` through the
 * predicate templates; `turn` lets a caller order the list, though the builder
 * keeps the given order.
 */
export interface ToldEntry {
  readonly proposition: Proposition;
  /** The turn index at which the NPC said it, for the caller's own ordering. */
  readonly turn?: number;
}

/** One exchange in the recent-turns window: who spoke and what they said. */
export interface RecentTurn {
  readonly speaker: 'player' | 'npc';
  readonly text: string;
}

/**
 * Everything {@link buildPrompt} assembles an NPC prompt from. Ordered here for
 * readers roughly as the blocks appear in the prompt (static to dynamic).
 */
export interface PromptInput {
  // --- rendering dependencies ---------------------------------------------
  /** The compiled predicate registry whose second-person templates render facts. */
  readonly predicates: PredicateRegistry;
  /** Resolves entity ids and places to view-safe display text. */
  readonly namer: Namer;

  // --- block 1: global frame ----------------------------------------------
  /**
   * Whether the NPC's cover is still intact. When `true` (the default) the
   * global frame adds the "stay consistent with your cover story and Told List"
   * instruction (Requirement 6.3). A cracking NPC passes `false`.
   */
  readonly coverIntact?: boolean;

  // --- block 2: persona ----------------------------------------------------
  readonly persona: PromptPersona;
  /** The NPC's Cover Story, if it has one; its Propositions are rendered. */
  readonly coverStory?: CoverStory;
  /** The NPC's Agenda: `conceal` drops facts from block 3, `goals` frame block 2. */
  readonly agenda?: Agenda;

  // --- block 3: Knowledge Slice --------------------------------------------
  /** The NPC's Knowledge Slice, rendered to sentences and a known-entity list. */
  readonly knowledge: KnowledgeSlice;

  // --- block 4: Told List + relationship -----------------------------------
  /** The Told List, in the order it should appear (newest-last is conventional). */
  readonly toldList: readonly ToldEntry[];
  /** A short free-text relationship summary, appended after the Told List. */
  readonly relationshipSummary?: string;

  // --- block 5: recent turns -----------------------------------------------
  /** The last N exchanges, oldest first; trimmed oldest-first when over budget. */
  readonly recentTurns: readonly RecentTurn[];

  // --- block 6: current turn -----------------------------------------------
  /** The player's latest line. */
  readonly playerLine: string;
  /** The classified Intent as a stage direction, if one has been computed. */
  readonly intent?: string;
}

/** Re-export the known-entity id type callers thread through. */
export type { EntityId };
