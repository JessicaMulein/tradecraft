/**
 * The Prompt Builder — assembles an NPC's chat prompt from most static to most
 * dynamic (the design's Prompt Assembly table; Requirement 15.1), renders the
 * Told List through the predicate templates (Requirement 6.2), and trims
 * deterministically to a token budget (Requirement 15.2).
 *
 * The builder is pure and deterministic: it reads only its arguments, performs
 * no I/O and makes no model calls. Given the same inputs it produces a
 * byte-identical prompt. That is what lets the server reuse its prefix cache
 * across turns — the leading blocks are stable, so only the tail changes as the
 * conversation moves (Requirement 15.1), and it is what task 14.4's prefix
 * stability property test checks.
 *
 * ## Block order (design's Prompt Assembly table)
 *
 * The prompt is a sequence of blocks ordered from the block that changes least
 * often to the one that changes every turn:
 *
 * | # | Block             | Changes when                                  |
 * |---|-------------------|-----------------------------------------------|
 * | 1 | Global frame      | Never during a session                        |
 * | 2 | Persona           | Rarely (only on cover-state change)           |
 * | 3 | Knowledge Slice   | When the NPC learns something                 |
 * | 4 | Told List         | After each extraction                         |
 * | 5 | Recent turns      | Every turn                                    |
 * | 6 | Current turn      | Every turn                                    |
 *
 * The global frame (block 1) carries the in-character and known-entities-only
 * instructions (Requirements 4.5): speak only as the character, and name only
 * entities on the NPC's known-entity list. While the NPC's cover is intact the
 * frame also tells it to stay consistent with its Cover Story and Told List
 * (Requirement 6.3).
 *
 * The Knowledge Slice (block 3) and Told List (block 4) are rendered through the
 * predicates' second-person templates — the same compiled {@link
 * PredicateRegistry} the Knowledge Slicer uses — via {@link sliceKnowledge}, so
 * both are deterministic plain sentences and the known-entity list is the one
 * the slicer surfaces.
 *
 * ## Trimming (Requirement 15.2)
 *
 * When the assembled prompt exceeds the token budget (default 3,000), the
 * builder trims in a fixed order so the result is deterministic:
 *
 * 1. Recent turns (block 5) are dropped oldest-first until the prompt fits.
 * 2. If it still does not fit, the Told List (block 4) is compressed to one
 *    line per subject.
 *
 * Blocks 1–3 are never trimmed. If they alone exceed the budget the world
 * generator's knowledge assignment is buggy, so the builder throws a {@link
 * PromptBudgetError} rather than silently shipping an over-budget prompt.
 */

import type { Namer, PredicateRegistry } from '@tradecraft/content';
import type { EntityId } from '@tradecraft/engine';

import {
  sliceKnowledge,
  type KnowledgeView,
} from '../knowledge-slicer/knowledge-slicer.js';
import type { PromptInput } from './types.js';

export type {
  PromptInput,
  ToldEntry,
  RecentTurn,
  PromptPersona,
} from './types.js';

/** The default NPC prompt token budget (Requirement 15.2). */
export const DEFAULT_TOKEN_BUDGET = 3000;

/** How many ambient propositions block 3 will mention. */
export const AMBIENT_FACT_CAP = 8;

/** Token budget for the ambient sentences in blocks 3 and 4 together. */
export const AMBIENT_TOKEN_CAP = 400;

/**
 * Thrown when the static blocks (1–3) alone exceed the token budget. These
 * blocks are never trimmed, so there is nothing the builder can do — the fault
 * is upstream in the NPC's Knowledge Slice. The message names the budget and
 * the measured size so the caller can report it.
 */
export class PromptBudgetError extends Error {
  constructor(
    readonly budget: number,
    readonly staticTokens: number,
  ) {
    super(
      `NPC prompt exceeds the token budget before any trimmable block: ` +
        `the global frame, persona and knowledge blocks need ${staticTokens} ` +
        `tokens but the budget is ${budget}. The NPC's Knowledge Slice is too large.`,
    );
    this.name = 'PromptBudgetError';
  }
}

/** One assembled block, kept apart so trimming can target blocks by role. */
interface Block {
  readonly kind:
    | 'global-frame'
    | 'persona'
    | 'knowledge'
    | 'told-list'
    | 'recent-turns'
    | 'current-turn';
  readonly text: string;
}

/** The builder's output: the assembled prompt and a little diagnostic detail. */
export interface BuiltPrompt {
  /** The full prompt text, blocks joined by a blank line, in block order. */
  readonly text: string;
  /** The estimated token count of {@link text}. */
  readonly tokens: number;
  /**
   * Whether trimming ran. `recentTurnsDropped` is how many recent turns were
   * dropped (oldest first); `toldListCompressed` is whether the Told List was
   * compressed to one line per subject.
   */
  readonly trim: {
    readonly recentTurnsDropped: number;
    readonly toldListCompressed: boolean;
  };
  /** The known-entity list the frame's "name only" rule refers to. */
  readonly knownEntities: readonly EntityId[];
}

// ---------------------------------------------------------------------------
// Token estimation
// ---------------------------------------------------------------------------

/**
 * A deterministic, model-agnostic token estimate. Real tokenizers vary by
 * model, but the budget only needs a stable, monotone proxy: the builder is
 * what decides when to trim, and the only requirement is that the same text
 * always estimates the same count and that more text never estimates fewer
 * tokens. We use a whitespace-and-punctuation word count scaled by a factor
 * close to the usual English chars-per-token ratio, taking the larger of the
 * word-based and character-based estimates so neither very long words nor very
 * short ones under-count.
 *
 * Pure and deterministic by construction.
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  const words = text.trim().length === 0 ? 0 : text.trim().split(/\s+/u).length;
  // ~4 characters per token is the common English rule of thumb.
  const byChars = Math.ceil(text.length / 4);
  // A word is rarely a single token; punctuation and sub-word splits push it up.
  const byWords = Math.ceil(words * 1.3);
  return Math.max(byChars, byWords);
}

// ---------------------------------------------------------------------------
// Block rendering
// ---------------------------------------------------------------------------

/**
 * The in-character and known-entities-only instructions, plus the fiction frame
 * and output style (block 1 of the design's Prompt Assembly table). This block
 * never changes during a session, so it is the stable prefix the server caches.
 *
 * `coverIntact` adds the Cover Story / Told List consistency instruction
 * (Requirement 6.3); it is dropped once the NPC's cover has cracked, since a
 * cracking NPC's Agenda has changed and it no longer defends its cover.
 */
function renderGlobalFrame(coverIntact: boolean): string {
  const lines = [
    'You are a character in a historical fiction. Stay in character at all times.',
    'Speak only as this character, in the first person. Never break character, never',
    'describe yourself in the third person, and never mention that you are an AI, a',
    'model or part of a game.',
    'Name only people, places and organisations that appear on your known-entity list',
    'below. Do not invent or name anyone or anywhere that is not on that list.',
  ];
  if (coverIntact) {
    lines.push(
      'Stay consistent with your cover story and with everything you have already told',
      'the player. Do not contradict yourself.',
    );
  }
  lines.push(
    'Reply with a short spoken line or two. Do not narrate actions or stage directions.',
  );
  return `# Instructions\n${lines.join('\n')}`;
}

/** The persona block (block 2): voice, mannerisms, background, Cover Story, Agenda. */
function renderPersona(input: PromptInput, namer: Namer): string {
  const { persona, coverStory, agenda } = input;
  const lines: string[] = [`You are ${persona.name}.`];
  if (persona.background.length > 0) {
    lines.push(persona.background);
  }
  if (persona.voiceTraits.length > 0) {
    lines.push(`Voice: ${persona.voiceTraits.join(', ')}.`);
  }
  if (persona.mannerisms.length > 0) {
    lines.push(`Mannerisms: ${persona.mannerisms.join(', ')}.`);
  }
  if (coverStory !== undefined && coverStory.presents.length > 0) {
    const cover = coverStory.presents.map(
      (p) => `- ${renderProposition(p, input.predicates, namer)}`,
    );
    lines.push('Your cover story — present these as true about yourself:', ...cover);
  }
  if (agenda !== undefined && agenda.goals.length > 0) {
    lines.push(
      'Your aims in this conversation:',
      ...agenda.goals.map((g) => `- ${g}`),
    );
  }
  return `# Who you are\n${lines.join('\n')}`;
}

/**
 * The Knowledge Slice block (block 3): the NPC's speakable facts as plain
 * second-person sentences, followed by the known-entity list the frame's "name
 * only" rule reads. Both come from the Knowledge Slicer, so this block is the
 * slicer's deterministic output verbatim.
 */
function renderKnowledge(view: KnowledgeView, namer: Namer, city?: string): string {
  const factLines =
    view.facts.length === 0
      ? ['(You know nothing in particular worth volunteering.)']
      : view.facts.map((f) => `- ${f.sentence}`);
  const names = view.knownEntities.map((id) => `- ${namer(id)}`);
  const entityLines =
    names.length === 0 ? ['(You know of no one in particular.)'] : names;
  const base =
    `# What you know\n${factLines.join('\n')}\n\n` +
    `# People, places and organisations you know of\n${entityLines.join('\n')}`;
  if (city === undefined || city.length === 0) {
    return base;
  }
  return `${base}\n\n${city}`;
}

/**
 * The Told List block (block 4): the Propositions the NPC has already asserted
 * to the player, rendered compactly through the predicates' second-person
 * templates (Requirement 6.2) rather than as full past transcripts.
 *
 * `compress` renders one line per subject — the design's Told List compression
 * step — joining each subject's sentences onto a single line, which trims
 * detail without dropping any subject the NPC has spoken about.
 */
function renderToldList(
  input: PromptInput,
  namer: Namer,
  compress: boolean,
): string {
  const told = input.toldList;
  if (told.length === 0) {
    return '# Already said\n(You have not told the player anything yet.)';
  }

  if (!compress) {
    const lines = told.map(
      (t) => `- ${renderProposition(t.proposition, input.predicates, namer)}`,
    );
    return `# Already said — do not contradict these\n${lines.join('\n')}`;
  }

  // Compressed: group by subject in first-seen order, one line per subject.
  const order: EntityId[] = [];
  const bySubject = new Map<EntityId, string[]>();
  for (const t of told) {
    const subject = t.proposition.subject as EntityId;
    const sentence = renderProposition(t.proposition, input.predicates, namer);
    const existing = bySubject.get(subject);
    if (existing === undefined) {
      order.push(subject);
      bySubject.set(subject, [sentence]);
    } else {
      existing.push(sentence);
    }
  }
  const lines = order.map((subject) => {
    const sentences = bySubject.get(subject) ?? [];
    return `- ${namer(subject)}: ${sentences.join(' ')}`;
  });
  return `# Already said — do not contradict these\n${lines.join('\n')}`;
}

/** The relationship summary, appended to the Told List block when present. */
function renderRelationship(input: PromptInput): string | undefined {
  const summary = input.relationshipSummary?.trim();
  if (summary === undefined || summary.length === 0) {
    return undefined;
  }
  return `# Where you stand with the player\n${summary}`;
}

/** The recent-turns block (block 5): the last N exchanges, oldest first. */
function renderRecentTurns(turns: PromptInput['recentTurns']): string {
  if (turns.length === 0) {
    return '# Recent conversation\n(This is the start of the conversation.)';
  }
  const lines = turns.map((t) => {
    const who = t.speaker === 'player' ? 'Player' : 'You';
    return `${who}: ${t.text}`;
  });
  return `# Recent conversation\n${lines.join('\n')}`;
}

/**
 * The current-turn block (block 6): the player's latest line plus the
 * classified Intent as a stage direction. The Intent is optional — the Intent
 * Classifier (task 14.5) is a separate later task — so when it is absent the
 * block carries just the player's line.
 */
function renderCurrentTurn(input: PromptInput): string {
  const lines = [`Player: ${input.playerLine}`];
  if (input.intent !== undefined && input.intent.length > 0) {
    lines.push(`(The player's intent reads as: ${input.intent}.)`);
  }
  lines.push('Reply in character.');
  return `# The player just said\n${lines.join('\n')}`;
}

/**
 * Render one Proposition to a second-person sentence through the predicate
 * registry, reusing the Knowledge Slicer's renderer by wrapping the Proposition
 * in a one-fact slice. This keeps Told List and Cover Story rendering identical
 * to Knowledge Slice rendering — the same predicate templates, the same
 * fallback — so there is a single source of truth for how a Proposition reads.
 */
function renderProposition(
  proposition: PromptInput['toldList'][number]['proposition'],
  predicates: PredicateRegistry,
  namer: Namer,
): string {
  const view = sliceKnowledge(
    { known: [proposition], falseBeliefs: [], knownEntities: [] },
    predicates,
    namer,
  );
  return view.facts[0]?.sentence ?? '';
}

// ---------------------------------------------------------------------------
// Assembly and trimming
// ---------------------------------------------------------------------------

function propositionEntities(proposition: PromptInput['toldList'][number]['proposition']): EntityId[] {
  const ids: EntityId[] = [proposition.subject as EntityId];
  if (typeof proposition.object === 'string') {
    ids.push(proposition.object);
  }
  if (proposition.place !== undefined) {
    ids.push(proposition.place);
  }
  return ids;
}

function citySection(lines: readonly string[]): string {
  if (lines.length === 0) {
    return '';
  }
  return `# The city as you know it\n${lines.map((line) => `- ${line}`).join('\n')}`;
}

function memorySection(lines: readonly string[]): string {
  if (lines.length === 0) {
    return '';
  }
  return `# What you remember\n${lines.map((line) => `- ${line}`).join('\n')}`;
}

/**
 * Keep at most 8 ambient facts, then drop the lowest-salience facts and
 * recollections until the two sections fit in {@link AMBIENT_TOKEN_CAP}.
 * Fact selection does not depend on the recollections, so block 3 stays put
 * for the whole day.
 */
function fitAmbient(input: PromptInput): {
  readonly city: string;
  readonly memories: string;
  readonly entities: readonly EntityId[];
} {
  const ambient = input.ambient;
  if (ambient === undefined) {
    return { city: '', memories: '', entities: [] };
  }
  const facts = [...ambient.facts]
    .sort((a, b) => b.salience - a.salience || (a.proposition.id < b.proposition.id ? -1 : 1))
    .slice(0, AMBIENT_FACT_CAP);
  const factLines = facts.map((fact) =>
    renderProposition(fact.proposition, input.predicates, input.namer),
  );
  while (factLines.length > 0 && estimateTokens(citySection(factLines)) > AMBIENT_TOKEN_CAP) {
    factLines.pop();
    facts.pop();
  }
  const room = AMBIENT_TOKEN_CAP - estimateTokens(citySection(factLines));
  const memories = [...ambient.recollections].sort(
    (a, b) => b.salience - a.salience || (a.text < b.text ? -1 : 1),
  );
  const keptMemories: string[] = [];
  const keptMemoryEntities: EntityId[] = [];
  for (const memory of memories) {
    const next = [...keptMemories, memory.text];
    if (estimateTokens(memorySection(next)) > room) {
      continue;
    }
    keptMemories.push(memory.text);
    keptMemoryEntities.push(...(memory.entities ?? []));
  }
  const entities: EntityId[] = [];
  const seen = new Set<string>();
  for (const id of [
    ...facts.flatMap((fact) => propositionEntities(fact.proposition)),
    ...ambient.recollections.flatMap((memory) => memory.entities ?? []),
    ...keptMemoryEntities,
  ]) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    entities.push(id);
  }
  return {
    city: citySection(factLines),
    memories: memorySection(keptMemories),
    entities,
  };
}

/** Join blocks in order with a blank line between them. */
function joinBlocks(blocks: readonly Block[]): string {
  return blocks.map((b) => b.text).join('\n\n');
}

/**
 * Build the NPC prompt from `input`, ordered static-to-dynamic and trimmed to
 * `budget` tokens (default {@link DEFAULT_TOKEN_BUDGET}).
 *
 * The function is pure: it reads only `input`, renders every block
 * deterministically, and trims in the fixed order recent-turns-then-Told-List.
 * Blocks 1–3 are never trimmed; if they alone exceed the budget it throws a
 * {@link PromptBudgetError}.
 *
 * @param input every piece the prompt is assembled from (persona, Agenda, Cover
 *   Story, Knowledge Slice, Told List, relationship summary, recent turns, the
 *   player's line and the optional classified Intent), plus the compiled
 *   predicate registry and the namer.
 * @param budget the token budget; defaults to the design's 3,000.
 */
export function buildPrompt(
  input: PromptInput,
  budget: number = DEFAULT_TOKEN_BUDGET,
): BuiltPrompt {
  const namer = input.namer;
  const ambient = fitAmbient(input);
  const view = sliceKnowledge(input.knowledge, input.predicates, namer, {
    conceal: input.agenda?.conceal,
    extraEntities: ambient.entities,
  });

  const coverIntact = input.coverIntact ?? true;

  // The static blocks (1–3) are built once; they are never trimmed.
  const globalFrame: Block = {
    kind: 'global-frame',
    text: renderGlobalFrame(coverIntact),
  };
  const persona: Block = {
    kind: 'persona',
    text: renderPersona(input, namer),
  };
  const knowledge: Block = {
    kind: 'knowledge',
    text: renderKnowledge(view, namer, ambient.city),
  };
  const staticBlocks: Block[] = [globalFrame, persona, knowledge];

  // The current-turn block (6) is dynamic but never trimmed — the NPC must see
  // what the player just said.
  const currentTurn: Block = {
    kind: 'current-turn',
    text: renderCurrentTurn(input),
  };

  const relationship = renderRelationship(input);

  // Guard the static floor first: if blocks 1–3 plus the always-present
  // current-turn block already blow the budget, trimming cannot help.
  const flooredText = joinBlocks([...staticBlocks, currentTurn]);
  const flooredTokens = estimateTokens(flooredText);
  if (flooredTokens > budget) {
    throw new PromptBudgetError(budget, flooredTokens);
  }

  // Build the trimmable blocks at their fullest, then trim in order.
  const makeToldBlock = (compress: boolean, includeMemories: boolean): Block[] => {
    const toldText = renderToldList(input, namer, compress);
    const parts = [toldText];
    if (relationship !== undefined) {
      parts.push(relationship);
    }
    if (includeMemories && ambient.memories.length > 0) {
      parts.push(ambient.memories);
    }
    return [{ kind: 'told-list', text: parts.join('\n\n') }];
  };

  const makeRecentBlock = (dropOldest: number): Block[] => {
    const kept = input.recentTurns.slice(dropOldest);
    return [{ kind: 'recent-turns', text: renderRecentTurns(kept) }];
  };

  const assemble = (
    told: Block[],
    recent: Block[],
  ): { text: string; tokens: number } => {
    const text = joinBlocks([
      ...staticBlocks,
      ...told,
      ...recent,
      currentTurn,
    ]);
    return { text, tokens: estimateTokens(text) };
  };

  let toldCompressed = false;
  let recentTurnsDropped = 0;

  let told = makeToldBlock(false, true);
  let recent = makeRecentBlock(0);
  let current = assemble(told, recent);

  // Step 1: trim recent turns, oldest first, until it fits or none remain.
  while (
    current.tokens > budget &&
    recentTurnsDropped < input.recentTurns.length
  ) {
    recentTurnsDropped += 1;
    recent = makeRecentBlock(recentTurnsDropped);
    current = assemble(told, recent);
  }

  // Step 2: still over budget — compress the Told List to one line per subject.
  if (current.tokens > budget) {
    toldCompressed = true;
    told = makeToldBlock(true, true);
    current = assemble(told, recent);
  }

  // Recollections travel with the Told List. Drop them only after that list
  // has already been compressed, so a long memory cannot change block 3.
  if (current.tokens > budget && ambient.memories.length > 0) {
    told = makeToldBlock(toldCompressed, false);
    current = assemble(told, recent);
  }

  return {
    text: current.text,
    tokens: current.tokens,
    trim: {
      recentTurnsDropped,
      toldListCompressed: toldCompressed,
    },
    knownEntities: view.knownEntities,
  };
}
