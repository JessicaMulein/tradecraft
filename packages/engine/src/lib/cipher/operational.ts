/**
 * The text a cipher actually carries.
 *
 * The engine still keeps a private field message ({@link encodePropositions})
 * so a correct break recovers the same Propositions that were sent. That
 * grammar is not what goes on the wire. The ciphertext is a short German
 * cable, one fact a line. No `npc:` or `loc:` ids. Names
 * come from the supplied glossary when the caller has one, and otherwise from
 * the id itself (`npc:friedrich-pichler-0` → "Friedrich Pichler").
 */

import { isEntityId, type GameTime, type Literal, type Proposition, type TimeWindow } from '../model/core.js';

/**
 * Short German telegraphese. The words are ordinary enough for a hand break
 * (letter counts, a crib), and they are not the engine's private field codes.
 * ASCII only: a cipher alphabet is A–Z.
 */
const VERBS: Readonly<Record<string, string>> = {
  MEMBER_OF: 'GEHOERT',
  WORKS_FOR: 'ARBEITET FUER',
  REPORTS_TO: 'MELDET AN',
  MEETS_AT: 'TRIFFT',
  LOCATED_AT: 'GESEHEN',
  TRAVELS_TO: 'REIST NACH',
  SCHEDULED_FOR: 'ERWARTET',
  PLANS: 'PLANT',
  TARGETS: 'ZIEL',
  CARRIES: 'TRAEGT',
  SUPPLIES: 'LIEFERT',
  USES_CHANNEL: 'KANAL',
  KNOWS: 'KENNT',
  SUSPECTS: 'VERMUTET',
  IS_ALIAS_OF: 'ALIAS',
};

const PLACE_VERBS = new Set(['GESEHEN', 'REIST NACH']);

const PHASES = ['MORGENS', 'NACHMITTAGS', 'ABENDS', 'NACHTS'] as const;

/** `npc:friedrich-pichler-0` → `Friedrich Pichler`. `chan:a/signal` → `Signal`. */
export function tidyWireName(id: string): string {
  const afterColon = id.slice(id.lastIndexOf(':') + 1);
  const tail = afterColon.split('/').pop() ?? afterColon;
  const words = tail.replace(/-\d+$/, '').replace(/-/g, ' ').trim();
  if (words.length === 0) return 'someone';
  return words
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The plaintext {@link generateIntercepts} enciphers. One cable line per fact,
 * in proposition order. Pure: the same facts and glossary always yield the
 * same note.
 */
export function operationalPlaintext(
  props: readonly Proposition[],
  names?: ReadonlyMap<string, string>,
): string {
  const name = (id: string): string => {
    const known = names?.get(id);
    if (known !== undefined && known.trim().length > 0) return known.trim();
    return tidyWireName(id);
  };
  return props.map((prop) => sentence(prop, name)).join('\n');
}

function sentence(prop: Proposition, name: (id: string) => string): string {
  const verb = spoken(prop.predicate);
  const subject = cable(name(prop.subject));
  const placeOnly = PLACE_VERBS.has(verb);
  let where = cable(objectPhrase(prop.object, name));
  if (placeOnly && prop.place !== undefined) where = cable(name(prop.place));
  let line = `${subject} ${verb} ${where}`;
  if (!placeOnly && prop.place !== undefined) line = `${line} BEI ${cable(name(prop.place))}`;
  if (prop.instrument !== undefined) line = `${line} MIT ${cable(name(prop.instrument))}`;
  if (prop.window !== undefined) line = `${line} ${windowPhrase(prop.window)}`;
  return line;
}

/** Uppercase ASCII, so the cable alphabet matches a hand cipher. */
function cable(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function spoken(predicate: string): string {
  const local = predicate.slice(predicate.lastIndexOf('/') + 1).toUpperCase();
  return VERBS[local] ?? local.replace(/_/g, ' ').toLowerCase();
}

function objectPhrase(object: Proposition['object'], name: (id: string) => string): string {
  if (typeof object === 'string') return name(object);
  return literalPhrase(object, name);
}

function literalPhrase(literal: Literal, name: (id: string) => string): string {
  if (literal.kind === 'text') {
    if (isEntityId(literal.value) || /^[a-z]+:/.test(literal.value)) return name(literal.value);
    return literal.value;
  }
  if (literal.kind === 'amount') return String(literal.value);
  return moment(literal.value);
}

function windowPhrase(window: TimeWindow): string {
  const from = moment(window.from);
  if (window.to === undefined) return from;
  return `${from} to ${moment(window.to)}`;
}

function moment(time: GameTime): string {
  const phase = PHASES[time.phase] ?? String(time.phase);
  return `TAG ${time.day} ${phase}`;
}
