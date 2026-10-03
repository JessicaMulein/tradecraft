/**
 * The Knowledge Slicer — a pure projection of an NPC's {@link KnowledgeSlice}
 * into the view the Prompt Builder (task 14.2) renders as block 3 of the NPC
 * prompt (the design's Prompt Assembly table).
 *
 * The Sim decides what every NPC knows (Requirement 4.1): an NPC's prompt is
 * built only from that NPC's persona, Agenda, Cover Story, Knowledge Slice,
 * Told List, relationship summary and recent turns. This module owns the
 * Knowledge Slice piece of that: it turns the slice's Propositions into the
 * plain second-person sentences the character would say ("You meet Viktor at
 * the Pier on Tuesday evenings"), and surfaces the known-entity list the
 * "name only entities from your list" rule reads.
 *
 * Secret containment (Requirement 5.1) falls out of the shape of the input: a
 * {@link KnowledgeSlice} holds only what the party knows or sincerely believes,
 * so a Proposition the NPC does not know is simply absent and can never reach
 * the prompt. On top of that, the slicer honours the NPC's Agenda `conceal`
 * list — the ids of the NPC's own Propositions they must not give away (their
 * real allegiance, the operation's target) — by dropping those facts from the
 * rendered view while leaving the entities they name in the known-entity list
 * (the NPC still knows those people exist, they just will not volunteer the
 * secret fact). The result is the exact set of facts the NPC may speak.
 *
 * The function is pure and deterministic: it reads only its arguments, performs
 * no I/O and makes no model calls. Given the same slice, the same predicate
 * registry and the same {@link Namer}, it produces byte-identical output, which
 * is what lets the Prompt Builder treat block 3 as a stable prefix that only
 * changes when the NPC learns something (the design's Prompt Assembly table).
 */

import type {
  CompiledPredicate,
  Namer,
  PredicateRegistry,
  RenderBindings,
} from '@tradecraft/content';
import {
  formatDate,
  type EntityId,
  type KnowledgeSlice,
  type Literal,
  type Proposition,
} from '@tradecraft/engine';

/**
 * One fact the NPC may speak, as rendered for the prompt. `propId` is the id of
 * the source Proposition, kept so the Prompt Builder (and tests) can trace a
 * line back to the slice entry it came from without re-deriving it.
 */
export interface RenderedFact {
  /** The id of the Proposition this sentence was rendered from. */
  readonly propId: string;
  /** The second-person sentence the NPC would say. */
  readonly sentence: string;
}

/**
 * The Knowledge Slicer's output: the NPC's speakable facts as plain sentences
 * and the entities the NPC knows of. This is the view the Prompt Builder
 * renders as block 3; it carries no `Truth` brand and no Proposition the NPC
 * does not know.
 */
export interface KnowledgeView {
  /**
   * The facts the NPC may speak, each a second-person sentence, in a stable
   * order (slice order, concealed facts removed). `known` and `falseBeliefs`
   * are both rendered: an NPC speaks its sincere mistakes as readily as its
   * truths, and the Claim Extractor (task 14.10) is what later tells one from
   * the other.
   */
  readonly facts: readonly RenderedFact[];
  /**
   * The entities the NPC knows of — every id on the slice's `knownEntities`,
   * de-duplicated and in a stable order. The prompt's "name only entities from
   * your list" instruction (Requirement 4.5) reads exactly this set, and the
   * Leak Guard (task 14.7) gates NPC output against it.
   */
  readonly knownEntities: readonly EntityId[];
}

/** Inputs to {@link sliceKnowledge} beyond the slice itself. */
export interface SliceOptions {
  /**
   * The ids of Propositions the NPC must not reveal (the Agenda's `conceal`
   * list). A fact whose id is in this set is dropped from {@link
   * KnowledgeView.facts}; the entities it names stay in `knownEntities`.
   * Defaults to concealing nothing.
   */
  readonly conceal?: Iterable<string>;
}

/** The namespace raw kind the predicate renderer expects for an entity binding. */
function entityKind(id: string): 'npc' | 'unk' | 'org' {
  if (id.startsWith('org:')) {
    return 'org';
  }
  if (id.startsWith('unk:')) {
    return 'unk';
  }
  return 'npc';
}

/** Format a Proposition's literal object as display text for a sentence. */
function literalText(object: Literal): string {
  switch (object.kind) {
    case 'text':
      return object.value;
    case 'amount':
      return String(object.value);
    case 'time':
      return formatDate(object.value);
  }
}

/**
 * Render one {@link Proposition} as a second-person sentence through the
 * predicate registry and the supplied {@link Namer}. The object is passed as an
 * entity binding (namer-resolved) or a pre-formatted literal, and `place` /
 * `when` are rendered from the Proposition when present.
 *
 * A Proposition citing a predicate the pack does not define — or one whose
 * slots do not satisfy the predicate's second-person template — still renders
 * to something readable rather than throwing, mirroring the engine's Fact Line
 * renderer, so a single malformed slice entry cannot blow up a whole prompt.
 */
function renderSecondPerson(
  prop: Proposition,
  predicates: PredicateRegistry,
  namer: Namer,
): string {
  const predicate: CompiledPredicate | undefined = predicates.get(prop.predicate);

  const objectBinding: RenderBindings['object'] =
    typeof prop.object === 'string'
      ? { kind: entityKind(prop.object), id: prop.object }
      : { literal: literalText(prop.object) };
  const place = prop.place !== undefined ? namer(prop.place) : undefined;
  const when = prop.window !== undefined ? formatDate(prop.window.from) : undefined;

  const fallback = (): string => {
    const subject = namer(prop.subject);
    const object =
      typeof prop.object === 'string' ? namer(prop.object) : literalText(prop.object);
    return `${subject} ${prop.predicate} ${object}`.trim();
  };

  if (predicate === undefined) {
    return fallback();
  }

  try {
    return predicate.render(
      'second',
      {
        subject: { kind: entityKind(prop.subject), id: prop.subject },
        object: objectBinding,
        place,
        when,
      },
      namer,
    );
  } catch {
    return fallback();
  }
}

/**
 * Produce the {@link KnowledgeView} for an NPC from its {@link KnowledgeSlice}.
 *
 * The slice's `known` and `falseBeliefs` are rendered, in that order and in
 * slice order within each, to second-person sentences. Any Proposition whose id
 * is in `options.conceal` is dropped. The known-entity list is the slice's
 * `knownEntities`, de-duplicated with first-seen order preserved.
 *
 * The result contains no Proposition the NPC does not know (secret containment,
 * Requirement 5.1) and no concealed fact the NPC must not reveal, so it is safe
 * to render straight into the prompt.
 *
 * @param slice the NPC's Knowledge Slice (true knowledge plus sincere false
 *   beliefs plus the entities it knows of).
 * @param predicates the compiled predicate registry whose second-person
 *   templates render the sentences.
 * @param namer resolves entity ids and places to view-safe display text; the
 *   caller builds it over the world records (the player/NPC-perspective namer).
 * @param options concealment and other knobs; concealing nothing by default.
 */
export function sliceKnowledge(
  slice: KnowledgeSlice,
  predicates: PredicateRegistry,
  namer: Namer,
  options: SliceOptions = {},
): KnowledgeView {
  const concealed = new Set<string>(options.conceal ?? []);

  const facts: RenderedFact[] = [];
  for (const prop of [...slice.known, ...slice.falseBeliefs]) {
    if (concealed.has(prop.id)) {
      continue;
    }
    facts.push({
      propId: prop.id,
      sentence: renderSecondPerson(prop, predicates, namer),
    });
  }

  const seen = new Set<EntityId>();
  const knownEntities: EntityId[] = [];
  for (const id of slice.knownEntities) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    knownEntities.push(id);
  }

  return { facts, knownEntities };
}
