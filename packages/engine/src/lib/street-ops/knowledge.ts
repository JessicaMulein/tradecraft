/**
 * Street knowledge (street-ops task 12).
 *
 * What the player has learned lives on the view slice. Driving and seeing
 * replace a map's name. A quieter source never overwrites a stronger one.
 */

import type { StreetGraph } from './graph.js';
import type { KnowledgeSource, StreetPosition } from './state.js';

export interface KnowledgeBooks {
  readonly knowledge: Readonly<Record<string, KnowledgeSource>>;
  readonly mapNames: Readonly<Record<string, string>>;
}

export interface MapSheet {
  readonly segments: readonly string[];
  readonly aliases: readonly { readonly segment: string; readonly street: string }[];
}

const RANK: Readonly<Record<KnowledgeSource, number>> = {
  aid: 1,
  map: 2,
  local: 3,
  seen: 4,
  driven: 5,
};

function rankOf(source: KnowledgeSource | undefined): number {
  if (source === undefined) return 0;
  return RANK[source];
}

export function learnPlace(
  books: KnowledgeBooks,
  id: string,
  source: KnowledgeSource,
  trueStreet?: string,
): { readonly books: KnowledgeBooks; readonly correction?: string } {
  if (rankOf(source) < rankOf(books.knowledge[id])) return { books };
  const knowledge = { ...books.knowledge, [id]: source };
  if (source !== 'driven' && source !== 'seen') return { books: { knowledge, mapNames: books.mapNames } };
  const shown = books.mapNames[id];
  if (shown === undefined) return { books: { knowledge, mapNames: books.mapNames } };
  const mapNames: Record<string, string> = {};
  for (const [key, value] of Object.entries(books.mapNames)) {
    if (key !== id) mapNames[key] = value;
  }
  const correction = trueStreet !== undefined && shown !== trueStreet ? `The map called this street ${shown}.` : undefined;
  return { books: { knowledge, mapNames }, ...(correction === undefined ? {} : { correction }) };
}

function learnEnds(graph: StreetGraph, books: KnowledgeBooks, segmentId: string, source: KnowledgeSource): KnowledgeBooks {
  const segment = graph.segments.get(segmentId);
  if (segment === undefined) return books;
  const from = learnPlace(books, segment.from, source).books;
  return learnPlace(from, segment.to, source).books;
}

/** The street under the car, and the exits once a junction is reached. */
export function learnTravel(
  graph: StreetGraph,
  books: KnowledgeBooks,
  position: StreetPosition,
  reachedJunction: boolean,
): { readonly books: KnowledgeBooks; readonly correction?: string } {
  const segment = graph.segments.get(position.segment);
  if (segment === undefined) return { books };
  const driven = learnPlace(books, position.segment, 'driven', segment.street);
  if (!reachedJunction) return driven;
  const headId = position.dir === 'fwd' ? segment.to : segment.from;
  let current = learnPlace(driven.books, headId, 'seen').books;
  let correction = driven.correction;
  for (const edge of graph.out.get(headId) ?? []) {
    if (edge.segment === position.segment) continue;
    const other = graph.segments.get(edge.segment);
    const seen = learnPlace(current, edge.segment, 'seen', other?.street);
    current = seen.books;
    if (correction === undefined && seen.correction !== undefined) correction = seen.correction;
  }
  return { books: current, ...(correction === undefined ? {} : { correction }) };
}

/** Segments a sheet prints, under the names it prints, until the street is seen. */
export function learnDocument(graph: StreetGraph | undefined, books: KnowledgeBooks, sheet: MapSheet): KnowledgeBooks {
  let current = books;
  for (const id of sheet.segments) {
    const segment = graph?.segments.get(id);
    current = learnPlace(current, id, 'map', segment?.street).books;
    if (current.knowledge[id] === 'map') {
      const alias = sheet.aliases.find((item) => item.segment === id);
      if (alias !== undefined) current = { knowledge: current.knowledge, mapNames: { ...current.mapNames, [id]: alias.street } };
      if (graph !== undefined) current = learnEnds(graph, current, id, 'map');
    }
  }
  return current;
}

/** Residence, posting, or a briefing. */
export function learnLocal(graph: StreetGraph | undefined, books: KnowledgeBooks, ids: readonly string[]): KnowledgeBooks {
  let current = books;
  for (const id of ids) {
    const segment = graph?.segments.get(id);
    current = learnPlace(current, id, 'local', segment?.street).books;
    if (graph !== undefined && current.knowledge[id] === 'local') current = learnEnds(graph, current, id, 'local');
  }
  return current;
}

/** The whole graph, as a navigation aid. */
export function learnAid(graph: StreetGraph, books: KnowledgeBooks): KnowledgeBooks {
  let current = books;
  for (const [id, segment] of graph.segments) {
    current = learnPlace(current, id, 'aid', segment.street).books;
  }
  for (const id of graph.junctions.keys()) {
    current = learnPlace(current, id, 'aid').books;
  }
  return current;
}
