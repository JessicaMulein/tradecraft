/**
 * Field messages: the terse, predicate-keyed plaintext the Cipher Engine
 * enciphers.
 *
 * A Plot Stage (or Side Thread, or a piece of Noise Traffic) carries a handful
 * of {@link Proposition}s describing what is about to happen — who meets whom,
 * where, in what window. Before that goes on the wire it is turned into a
 * compact *field message*: a plaintext whose fields are keyed by each
 * predicate's FIELD CODE (the short upper-case code the compiled predicate
 * registry assigns, Requirement 32.2). The field message is then run through
 * one of the five hand ciphers in `cipher.ts` to produce the ciphertext of an
 * Intercept. This module owns only the encode/parse step; the ciphering and the
 * Intercept generation live in tasks 8.1 and 8.3.
 *
 * {@link encodePropositions} and {@link parseFieldMessage} are exact inverses
 * (Requirement 32.3, the predicate-derived round-trip, formalised as Property
 * 25 in task 8.7):
 *
 * ```ts
 * parseFieldMessage(encodePropositions(props, registry), registry)
 * // deep-equals `props`
 * ```
 *
 * Both are pure and deterministic: no clock, no randomness, no I/O. The only
 * state they consult is the predicate registry, read-only, for the field-code
 * mapping in each direction.
 *
 * ## Grammar
 *
 * One Proposition per line (lines joined by `\n`, no trailing newline). Each
 * line is a sequence of space-separated tokens:
 *
 * ```text
 * <FIELDCODE> <subject> <object> [@<place>] [~<window>]
 * ```
 *
 * - `<FIELDCODE>` is the predicate's field code (e.g. `MAT`). On parse it is
 *   looked up in a reverse field-code → predicate-id map built from the
 *   registry, so the message is read back against the same vocabulary that
 *   wrote it.
 * - `<subject>` is an {@link EntityId}. Entity ids contain no spaces and never
 *   begin with the literal sigil `=`, so they tokenise cleanly.
 * - `<object>` is either an {@link EntityId} or a {@link Literal}. A literal is
 *   written with a leading `=` and a one-letter kind tag, which is how the two
 *   are told apart on the wire:
 *     - `=T:<escaped text>` — a text literal; the text is escaped (below) so it
 *       holds no spaces or newlines and so round-trips byte-for-byte.
 *     - `=A:<number>` — an amount literal.
 *     - `=M:<day>.<phase>` — a time literal (a {@link GameTime} moment).
 * - `@<place>` is an optional Location id, present only when the Proposition
 *   carries a `place`.
 * - `~<window>` is an optional time window, present only when the Proposition
 *   carries a `window`. It is `~<from>` for an open-ended window or
 *   `~<from>..<to>` for a closed one, each endpoint a `<day>.<phase>`
 *   {@link GameTime}.
 *
 * The Proposition's `id` is **not** carried in the field message: a field
 * message is what the Hostile Service puts on the wire, and the Sim-internal
 * {@link PropId} is not part of that. The round-trip therefore reconstructs ids
 * deterministically from the message position (`fm:<line index>`); callers that
 * need to preserve original ids remap them. Everything else — subject,
 * predicate, object (entity or literal, including the exact text), place and
 * window — survives exactly.
 *
 * ## Text escaping
 *
 * A text literal may contain spaces, newlines or the sigils the grammar uses.
 * To keep every token whitespace-free and the line structure unambiguous, text
 * values are escaped with a small, reversible scheme: backslash first (so the
 * unescape is unambiguous), then the whitespace characters that would otherwise
 * break tokenising. See {@link escapeText} / {@link unescapeText}.
 */

import {
  isEntityId,
  type EntityId,
  type GameTime,
  type Literal,
  type LocId,
  type Phase,
  type Proposition,
  type TimeWindow,
} from '../model/core.js';

/**
 * The read-only slice of the compiled predicate registry a field message needs:
 * the predicate id → field code map, in both directions. A compiled
 * `PredicateRegistry` from `@tradecraft/content` exposes exactly this as its
 * `fieldCodes` member, so a caller passes `registry.fieldCodes` straight in (or
 * the whole registry — this is structurally a subset). Narrowing to this keeps
 * the field-message code free of the whole registry shape and trivially
 * testable with a hand-built map.
 */
export interface FieldCodeLookup {
  /** Predicate id (`MEETS_AT`) → field code (`MAT`). */
  readonly fieldCodes: ReadonlyMap<string, string>;
}

/** A registry-like value, or the bare `fieldCodes` map, either accepted. */
export type FieldCodeSource =
  | FieldCodeLookup
  | ReadonlyMap<string, string>;

function fieldCodesOf(source: FieldCodeSource): ReadonlyMap<string, string> {
  return source instanceof Map
    ? source
    : (source as FieldCodeLookup).fieldCodes;
}

/** The literal-kind tags used on the wire. */
const LITERAL_TAG = {
  text: 'T',
  amount: 'A',
  time: 'M',
} as const satisfies Record<Literal['kind'], string>;

const TAG_TO_LITERAL_KIND: Record<string, Literal['kind']> = {
  T: 'text',
  A: 'amount',
  M: 'time',
};

const PLACE_SIGIL = '@';
const WINDOW_SIGIL = '~';
/** A predicate instrument, written `^<entityId>` (plot-library Req 11.4). */
const INSTRUMENT_SIGIL = '^';
const LITERAL_SIGIL = '=';
const WINDOW_RANGE = '..';

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/**
 * Encode a list of Propositions into a field-message plaintext, keying each on
 * its predicate's field code.
 *
 * One Proposition per line, in the given order. Throws, naming the predicate,
 * if a Proposition's predicate has no field code in the registry — that is a
 * content or world-generation bug (an un-encodable predicate reached the wire),
 * not a normal gameplay outcome.
 *
 * @param props the Propositions to encode.
 * @param registry the compiled predicate registry (or its `fieldCodes` map).
 */
export function encodePropositions(
  props: readonly Proposition[],
  registry: FieldCodeSource,
): string {
  const fieldCodes = fieldCodesOf(registry);
  return props.map((p) => encodeOne(p, fieldCodes)).join('\n');
}

function encodeOne(
  prop: Proposition,
  fieldCodes: ReadonlyMap<string, string>,
): string {
  const code = fieldCodes.get(prop.predicate);
  if (code === undefined) {
    throw new Error(
      `encodePropositions: predicate "${prop.predicate}" has no field code in the registry`,
    );
  }

  const tokens: string[] = [code, prop.subject, encodeObject(prop.object)];
  if (prop.place !== undefined) {
    tokens.push(`${PLACE_SIGIL}${prop.place}`);
  }
  if (prop.window !== undefined) {
    tokens.push(`${WINDOW_SIGIL}${encodeWindow(prop.window)}`);
  }
  if (prop.instrument !== undefined) {
    tokens.push(`${INSTRUMENT_SIGIL}${prop.instrument}`);
  }
  return tokens.join(' ');
}

/** Encode a Proposition object: an entity id passes through, a literal is tagged. */
function encodeObject(object: EntityId | Literal): string {
  if (typeof object === 'string') {
    return object;
  }
  switch (object.kind) {
    case 'text':
      return `${LITERAL_SIGIL}${LITERAL_TAG.text}:${escapeText(object.value)}`;
    case 'amount':
      return `${LITERAL_SIGIL}${LITERAL_TAG.amount}:${encodeAmount(object.value)}`;
    case 'time':
      return `${LITERAL_SIGIL}${LITERAL_TAG.time}:${encodeTime(object.value)}`;
  }
}

/** Encode a time window: `<from>` open-ended, or `<from>..<to>` closed. */
function encodeWindow(window: TimeWindow): string {
  const from = encodeTime(window.from);
  if (window.to === undefined) {
    return from;
  }
  return `${from}${WINDOW_RANGE}${encodeTime(window.to)}`;
}

/** Encode a {@link GameTime} as `<day>.<phase>`. */
function encodeTime(time: GameTime): string {
  return `${time.day}.${time.phase}`;
}

/**
 * Encode an amount. Finite numbers are written with `String(n)`, which
 * round-trips exactly through `Number(...)` for every IEEE-754 double. Non-finite
 * amounts (`NaN`, `±Infinity`) have no faithful wire form and are rejected, so a
 * malformed amount is caught at encode time rather than silently corrupting the
 * message.
 */
function encodeAmount(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(
      `encodePropositions: amount literal must be a finite number, got ${value}`,
    );
  }
  return String(value);
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/**
 * Parse a field-message plaintext back into Propositions, looking each line's
 * leading field code up in a reverse (field code → predicate id) map built from
 * the registry.
 *
 * The inverse of {@link encodePropositions}: for any `props`,
 * `parseFieldMessage(encodePropositions(props, r), r)` deep-equals `props` with
 * each Proposition's `id` reconstructed as `fm:<line index>` (field messages do
 * not carry the Sim-internal id — see the module comment).
 *
 * Throws a descriptive error, naming the offending line, on any malformed
 * input: an unknown field code, too few or too many tokens, a bad entity id, a
 * malformed literal, place or window. A field message that this engine wrote is
 * always well-formed; a throw means corrupted or foreign input.
 *
 * @param text the field-message plaintext.
 * @param registry the compiled predicate registry (or its `fieldCodes` map).
 */
export function parseFieldMessage(
  text: string,
  registry: FieldCodeSource,
): Proposition[] {
  const reverse = reverseFieldCodes(fieldCodesOf(registry));

  // An empty message encodes an empty proposition list. Splitting "" on "\n"
  // would otherwise yield one empty line, so handle it explicitly.
  if (text.length === 0) {
    return [];
  }

  return text
    .split('\n')
    .map((line, index) => parseLine(line, index, reverse));
}

/**
 * Build the reverse field-code → predicate-id lookup. The registry guarantees
 * field codes are unique across predicates (Requirement 32.4, enforced at
 * compile time), so this is an unambiguous bijection; a surprise duplicate is
 * reported rather than silently dropping a predicate.
 */
function reverseFieldCodes(
  fieldCodes: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> {
  const reverse = new Map<string, string>();
  for (const [predicateId, code] of fieldCodes) {
    const existing = reverse.get(code);
    if (existing !== undefined && existing !== predicateId) {
      throw new Error(
        `parseFieldMessage: field code "${code}" maps to both "${existing}" and "${predicateId}"`,
      );
    }
    reverse.set(code, predicateId);
  }
  return reverse;
}

function parseLine(
  line: string,
  index: number,
  reverse: ReadonlyMap<string, string>,
): Proposition {
  const where = `line ${index + 1}`;
  const tokens = line.split(' ');
  if (tokens.length < 3) {
    throw new Error(
      `parseFieldMessage: ${where} has too few fields (need at least code, subject, object)`,
    );
  }

  const [code, subjectToken, objectToken, ...rest] = tokens;

  const predicate = reverse.get(code);
  if (predicate === undefined) {
    throw new Error(`parseFieldMessage: ${where} has unknown field code "${code}"`);
  }

  const subject = parseEntityId(subjectToken, `${where} subject`);
  const object = parseObject(objectToken, where);

  let place: LocId | undefined;
  let window: TimeWindow | undefined;
  let instrument: EntityId | undefined;
  for (const token of rest) {
    if (token.startsWith(INSTRUMENT_SIGIL)) {
      if (instrument !== undefined) {
        throw new Error(`parseFieldMessage: ${where} has more than one instrument`);
      }
      instrument = parseEntityId(token.slice(INSTRUMENT_SIGIL.length), `${where} instrument`);
    } else if (token.startsWith(PLACE_SIGIL)) {
      if (place !== undefined) {
        throw new Error(`parseFieldMessage: ${where} has more than one place`);
      }
      place = parsePlace(token.slice(PLACE_SIGIL.length), where);
    } else if (token.startsWith(WINDOW_SIGIL)) {
      if (window !== undefined) {
        throw new Error(`parseFieldMessage: ${where} has more than one window`);
      }
      window = parseWindow(token.slice(WINDOW_SIGIL.length), where);
    } else {
      throw new Error(
        `parseFieldMessage: ${where} has an unexpected field "${token}"`,
      );
    }
  }

  const proposition: Proposition = {
    id: `fm:${index}`,
    subject,
    predicate,
    object,
    ...(place !== undefined ? { place } : {}),
    ...(window !== undefined ? { window } : {}),
    ...(instrument !== undefined ? { instrument } : {}),
  };
  return proposition;
}

/** Parse a Proposition object token: a literal if `=`-tagged, else an entity id. */
function parseObject(token: string, where: string): EntityId | Literal {
  if (token.startsWith(LITERAL_SIGIL)) {
    return parseLiteral(token.slice(LITERAL_SIGIL.length), where);
  }
  return parseEntityId(token, `${where} object`);
}

/** Parse a `<tag>:<body>` literal token. */
function parseLiteral(body: string, where: string): Literal {
  const colon = body.indexOf(':');
  if (colon === -1) {
    throw new Error(
      `parseFieldMessage: ${where} has a malformed literal (missing ":")`,
    );
  }
  const tag = body.slice(0, colon);
  const value = body.slice(colon + 1);
  const kind = TAG_TO_LITERAL_KIND[tag];
  if (kind === undefined) {
    throw new Error(
      `parseFieldMessage: ${where} has an unknown literal tag "${tag}"`,
    );
  }
  switch (kind) {
    case 'text':
      return { kind: 'text', value: unescapeText(value) };
    case 'amount':
      return { kind: 'amount', value: parseAmount(value, where) };
    case 'time':
      return { kind: 'time', value: parseTime(value, `${where} literal`) };
  }
}

function parseAmount(value: string, where: string): number {
  // Reject empties and anything `Number` would coerce loosely (e.g. "" → 0).
  if (value.length === 0) {
    throw new Error(`parseFieldMessage: ${where} has an empty amount literal`);
  }
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(
      `parseFieldMessage: ${where} has a non-numeric amount literal "${value}"`,
    );
  }
  return n;
}

/** Parse a place token (the text after `@`) as a Location id. */
function parsePlace(value: string, where: string): LocId {
  const id = parseEntityId(value, `${where} place`);
  if (!id.startsWith('loc:')) {
    throw new Error(
      `parseFieldMessage: ${where} place "${value}" is not a loc: id`,
    );
  }
  return id as LocId;
}

/** Parse a window token (the text after `~`): `<from>` or `<from>..<to>`. */
function parseWindow(value: string, where: string): TimeWindow {
  const parts = value.split(WINDOW_RANGE);
  if (parts.length === 1) {
    return { from: parseTime(parts[0], `${where} window from`) };
  }
  if (parts.length === 2) {
    return {
      from: parseTime(parts[0], `${where} window from`),
      to: parseTime(parts[1], `${where} window to`),
    };
  }
  throw new Error(`parseFieldMessage: ${where} has a malformed window "${value}"`);
}

/** Parse a `<day>.<phase>` {@link GameTime}. */
function parseTime(value: string, where: string): GameTime {
  const dot = value.indexOf('.');
  if (dot === -1) {
    throw new Error(
      `parseFieldMessage: ${where} time "${value}" is not "<day>.<phase>"`,
    );
  }
  const dayText = value.slice(0, dot);
  const phaseText = value.slice(dot + 1);

  if (!/^(?:0|[1-9][0-9]*)$/.test(dayText)) {
    throw new Error(
      `parseFieldMessage: ${where} time has a bad day "${dayText}"`,
    );
  }
  const day = Number(dayText);

  const phase = phaseOrdinalFromText(phaseText);
  if (phase === undefined) {
    throw new Error(
      `parseFieldMessage: ${where} time has a bad phase "${phaseText}"`,
    );
  }
  return { day, phase };
}

/** The phase ordinal written by {@link encodeTime}: a single digit 0–3. */
function phaseOrdinalFromText(text: string): Phase | undefined {
  if (!/^[0-3]$/.test(text)) {
    return undefined;
  }
  // `phaseOrdinal` works on phase *names*; here the wire form is the numeric
  // ordinal, so validate the digit directly and cast through the known range.
  return Number(text) as Phase;
}

/** Validate and brand an entity-id token. */
function parseEntityId(token: string, where: string): EntityId {
  if (!isEntityId(token)) {
    throw new Error(
      `parseFieldMessage: ${where} is not a valid entity id ("${token}")`,
    );
  }
  return token;
}

// ---------------------------------------------------------------------------
// Text escaping
// ---------------------------------------------------------------------------

/**
 * Escape a text-literal value so it holds no whitespace and no newline, keeping
 * every token on one line and space-separable. Backslash is escaped first so
 * the inverse is unambiguous; then the whitespace characters that would break
 * tokenising. Any other character — including the grammar sigils `@ ~ =`, which
 * are only significant in token-leading position — is left as-is.
 */
function escapeText(value: string): string {
  let out = '';
  for (const ch of value) {
    switch (ch) {
      case '\\':
        out += '\\\\';
        break;
      case ' ':
        out += '\\s';
        break;
      case '\n':
        out += '\\n';
        break;
      case '\r':
        out += '\\r';
        break;
      case '\t':
        out += '\\t';
        break;
      default:
        out += ch;
    }
  }
  return out;
}

/** Invert {@link escapeText}. Throws on a dangling or unknown escape. */
function unescapeText(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i += 1) {
    const ch = value[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    i += 1;
    if (i >= value.length) {
      throw new Error('parseFieldMessage: dangling escape in text literal');
    }
    const next = value[i];
    switch (next) {
      case '\\':
        out += '\\';
        break;
      case 's':
        out += ' ';
        break;
      case 'n':
        out += '\n';
        break;
      case 'r':
        out += '\r';
        break;
      case 't':
        out += '\t';
        break;
      default:
        throw new Error(
          `parseFieldMessage: unknown escape "\\${next}" in text literal`,
        );
    }
  }
  return out;
}
