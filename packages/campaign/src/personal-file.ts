/**
 * Personal File (design, "Carried knowledge"; Requirements 7.6, 13.1, 17.5).
 *
 * Built only from Player Carry. Identified persons are listed most recent
 * posting first, once each, and the list stops at `personalFileMax`. Carried
 * `MEMBER_OF`, `WORKS_FOR` and `IS_ALIAS_OF` claims about those persons are
 * rendered through the predicate third-person templates. The epoch's
 * background events are appended from fictional templates. `placements` is
 * accepted and not read, so the file cannot show who is in the city.
 * `persons` repeats the listed ids so a posting can register them as known.
 */

import type { EntityBinding, Namer, PredicateRegistry } from '@tradecraft/content';
import type { Proposition } from '@tradecraft/engine';

import { epochAt } from './era.js';
import type { CampaignText, Epoch } from './content/schemas.js';
import { renderTemplate } from './review.js';
import type { CarryClaim, PersonalFileSpec, PlayerCarry } from './state.js';

/** How many identified persons a Personal File lists. The design's default. */
export const PERSONAL_FILE_MAX = 24;

const CARRIED_PREDICATES = new Set(['MEMBER_OF', 'WORKS_FOR', 'IS_ALIAS_OF']);

export interface PersonalFileSources {
  readonly texts: readonly CampaignText[];
  readonly epochs: readonly Epoch[];
  readonly predicates: PredicateRegistry;
  readonly year: number;
  /** Overrides {@link PERSONAL_FILE_MAX} when a posting wants a shorter file. */
  readonly personalFileMax?: number;
}

interface ListedPerson {
  readonly key: string;
  readonly name: string;
  readonly aliases: readonly string[];
  readonly apparentAffiliation?: string;
}

/**
 * The Personal File for one posting year. Pure. `placements` does not change
 * the list, the cap, or the propositions the file asserts.
 */
export function personalFile(
  carries: readonly PlayerCarry[],
  placements: readonly unknown[],
  content: PersonalFileSources,
): PersonalFileSpec {
  void placements;
  const template = content.texts.find((text) => text.use === 'personal-file');
  if (template === undefined) {
    throw new Error('personalFile(): no personal-file template');
  }
  const cap = Math.max(0, content.personalFileMax ?? PERSONAL_FILE_MAX);
  const listed = listPeople(carries, cap);
  const names = namesOf(carries);
  const claims = claimsFor(carries, listed);
  const events = backgroundEvents(content);
  const rendered = renderTemplate(template, { year: content.year });
  const asserts = listed.flatMap((person) => (claims.get(person.key) ?? []).map((claim) => claim.prop));
  return {
    title: rendered.title,
    body: renderBody(rendered.body, listed, claims, names, content.predicates, events),
    asserts,
    persons: listed.map((person) => person.key),
  };
}

function listPeople(carries: readonly PlayerCarry[], cap: number): ListedPerson[] {
  const seen = new Set<string>();
  const listed: ListedPerson[] = [];
  for (let index = carries.length - 1; index >= 0 && listed.length < cap; index -= 1) {
    const carry = carries[index];
    if (carry === undefined) {
      continue;
    }
    for (const person of carry.identified) {
      if (listed.length >= cap) {
        break;
      }
      const key = personKey(person.person);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      listed.push({
        key,
        name: person.name,
        aliases: person.aliases,
        ...(person.apparentAffiliation === undefined
          ? {}
          : { apparentAffiliation: person.apparentAffiliation }),
      });
    }
  }
  return listed;
}

/** Most recent name wins. Keys are the bare id and the `npc:` form. */
function namesOf(carries: readonly PlayerCarry[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const carry of carries) {
    for (const person of carry.identified) {
      const key = personKey(person.person);
      names.set(key, person.name);
      names.set(`npc:${key}`, person.name);
    }
    for (const entry of carry.unidentified) {
      names.set(entry.person, entry.descriptor);
    }
  }
  return names;
}

function claimsFor(
  carries: readonly PlayerCarry[],
  listed: readonly ListedPerson[],
): Map<string, CarryClaim[]> {
  const keys = new Set(listed.map((person) => person.key));
  const used = new Set<string>();
  const byPerson = new Map<string, CarryClaim[]>(listed.map((person) => [person.key, []]));
  for (let index = carries.length - 1; index >= 0; index -= 1) {
    const carry = carries[index];
    if (carry === undefined) {
      continue;
    }
    for (const claim of carry.heldClaims) {
      if (used.has(claim.id) || !CARRIED_PREDICATES.has(claim.prop.predicate)) {
        continue;
      }
      const owner = ownerKey(claim, keys);
      if (owner === undefined) {
        continue;
      }
      used.add(claim.id);
      byPerson.get(owner)?.push(claim);
    }
  }
  return byPerson;
}

function ownerKey(claim: CarryClaim, keys: ReadonlySet<string>): string | undefined {
  const subject = personKey(claim.prop.subject);
  if (keys.has(subject)) {
    return subject;
  }
  const object = claim.prop.object;
  if (typeof object === 'string' && keys.has(personKey(object))) {
    return personKey(object);
  }
  return undefined;
}

function backgroundEvents(
  content: PersonalFileSources,
): readonly { readonly title: string; readonly body: string }[] {
  const epoch = epochAt(content.year, content.epochs);
  if (!epoch.ok) {
    return [];
  }
  const events: { title: string; body: string }[] = [];
  for (const id of epoch.value.events) {
    const text = content.texts.find((entry) => entry.id === id && entry.use === 'background-event');
    if (text !== undefined) {
      events.push({ title: text.title, body: text.body });
    }
  }
  return events;
}

function renderBody(
  header: string,
  listed: readonly ListedPerson[],
  claims: ReadonlyMap<string, readonly CarryClaim[]>,
  names: ReadonlyMap<string, string>,
  predicates: PredicateRegistry,
  events: readonly { readonly title: string; readonly body: string }[],
): string {
  const sections = [header];
  if (listed.length > 0) {
    sections.push(
      listed
        .map((person) => personBlock(person, claims.get(person.key) ?? [], names, predicates))
        .join('\n\n'),
    );
  }
  if (events.length > 0) {
    const lines = ['World situation'];
    for (const event of events) {
      lines.push(event.title, event.body);
    }
    sections.push(lines.join('\n'));
  }
  return sections.join('\n\n');
}

function personBlock(
  person: ListedPerson,
  claims: readonly CarryClaim[],
  names: ReadonlyMap<string, string>,
  predicates: PredicateRegistry,
): string {
  const lines = [person.name];
  if (person.aliases.length > 0) {
    lines.push(`Aliases: ${person.aliases.join(', ')}`);
  }
  if (person.apparentAffiliation !== undefined) {
    lines.push(`Apparent affiliation: ${person.apparentAffiliation}`);
  }
  for (const claim of claims) {
    lines.push(renderClaim(claim.prop, names, predicates));
  }
  return lines.join('\n');
}

function renderClaim(
  prop: Proposition,
  names: ReadonlyMap<string, string>,
  predicates: PredicateRegistry,
): string {
  const namer = carryNamer(names);
  const predicate = predicates.get(prop.predicate);
  const bindings = {
    subject: { kind: entityKind(prop.subject), id: prop.subject },
    object: objectBinding(prop.object),
  };
  if (predicate === undefined) {
    return plainClaim(prop, namer);
  }
  try {
    return predicate.render('third', bindings, namer);
  } catch {
    return plainClaim(prop, namer);
  }
}

function plainClaim(prop: Proposition, namer: Namer): string {
  const subject = namer({ kind: entityKind(prop.subject), id: prop.subject });
  const object =
    typeof prop.object === 'string'
      ? namer({ kind: entityKind(prop.object), id: prop.object })
      : literalText(prop.object);
  return `${subject} ${prop.predicate} ${object}`;
}

function objectBinding(object: Proposition['object']): EntityBinding | { readonly literal: string } {
  if (typeof object !== 'string') {
    return { literal: literalText(object) };
  }
  return { kind: entityKind(object), id: object };
}

function literalText(object: Exclude<Proposition['object'], string>): string {
  switch (object.kind) {
    case 'text':
      return object.value;
    case 'amount':
      return String(object.value);
    case 'time':
      return String(object.value.day);
  }
}

function carryNamer(names: ReadonlyMap<string, string>): Namer {
  return (value: unknown): string => {
    if (typeof value === 'string') {
      return names.get(value) ?? localName(value);
    }
    if (typeof value === 'object' && value !== null && 'id' in value) {
      const id = (value as { id: unknown }).id;
      if (typeof id === 'string') {
        return names.get(id) ?? names.get(personKey(id)) ?? localName(id);
      }
    }
    return String(value);
  };
}

function entityKind(id: string): EntityBinding['kind'] {
  if (id.startsWith('org:')) {
    return 'org';
  }
  if (id.startsWith('unk:')) {
    return 'unk';
  }
  if (id.startsWith('item:')) {
    return 'item';
  }
  return 'npc';
}

function personKey(id: string): string {
  return id.startsWith('npc:') ? id.slice('npc:'.length) : id;
}

function localName(id: string): string {
  const colon = id.indexOf(':');
  return colon === -1 ? id : id.slice(colon + 1);
}
