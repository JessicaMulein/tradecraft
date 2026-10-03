/**
 * The Specifics Guard — a pure check over a single Flavour sentence.
 *
 * The Narrator writes descriptive prose (Flavour) that must never invent facts.
 * The Leak Guard stops it naming unknown *entities*; the Specifics Guard stops
 * it inventing *specifics* — a day of the week, a clock time, a date, a numeral
 * or a proper name that the Sim never supplied (Requirements 20.4, 20.5).
 *
 * The rule, from the design: a sentence is rejected if it contains a numeral or
 * number word (bar a small allowlist such as "one" in "no one"), a weekday or
 * month name, a clock pattern or "o'clock", a time-of-day word that contradicts
 * the current phase, or a capitalized non-sentence-initial token that is not in
 * the allowed-name set. Tokens that appear verbatim in the supplied Fact Lines
 * or scene descriptor are always allowed — that is the verbatim-token
 * allowance, and it is what lets the Narrator echo a "3" or a "Viktor" the Sim
 * itself put in front of it.
 *
 * The function is pure: it reads only its arguments, performs no I/O, and makes
 * no model calls, so it is trivially testable and safe to run inside the
 * streaming loop that releases one sentence at a time.
 */

/** The scene's actual time-of-day phase, supplied by the Sim. */
export type Phase = 'morning' | 'afternoon' | 'evening' | 'night';

/** Why a sentence was rejected. One class per offending token. */
export type ViolationClass =
  | 'numeral'
  | 'number-word'
  | 'weekday'
  | 'month'
  | 'clock'
  | 'time-of-day'
  | 'proper-name';

/** A single rejection: the class of problem and the token that caused it. */
export interface SpecificsViolation {
  readonly class: ViolationClass;
  /** The offending token, as it appeared in the candidate sentence. */
  readonly token: string;
}

/** Everything the guard needs besides the candidate sentence. */
export interface SpecificsContext {
  /** Deterministic Fact Lines the Sim produced for this scene. */
  readonly factLines: readonly string[];
  /**
   * The scene descriptor text: Location description, atmosphere tags, weather,
   * crowd level and visible persons. Any token here is allowed verbatim.
   */
  readonly sceneDescriptor: string;
  /** The scene's actual phase. A time-of-day word for any other phase trips. */
  readonly phase: Phase;
  /**
   * Extra words that are always allowed even when capitalized or numeric: the
   * pack's common-word allowlist, known-entity aliases and visible labels. Case
   * is ignored on the match, mirroring the verbatim allowance.
   */
  readonly allowedWords?: readonly string[];
}

export interface SpecificsResult {
  readonly ok: boolean;
  readonly violations: readonly SpecificsViolation[];
}

/**
 * Number words that name a quantity. "one" is handled separately: it is only a
 * violation when it is a genuine count, not in idioms like "no one" or
 * "someone", so it is deliberately absent from this set.
 */
const NUMBER_WORDS = new Set<string>([
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
  'twenty',
  'thirty',
  'forty',
  'fifty',
  'sixty',
  'seventy',
  'eighty',
  'ninety',
  'hundred',
  'thousand',
  'million',
  'billion',
  'dozen',
]);

/**
 * "one" counts as a numeral only outside these idioms, where the preceding word
 * turns it into a pronoun rather than a count. Checked on the token *before*
 * "one".
 */
const ONE_PRONOUN_PREFIXES = new Set<string>([
  'no',
  'some',
  'any',
  'every',
  'such',
  'that',
  'this',
  'which',
  'the',
]);

const WEEKDAYS = new Set<string>([
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]);

const MONTHS = new Set<string>([
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
]);

/** Time-of-day words mapped to the phase they name. */
const TIME_OF_DAY: ReadonlyMap<string, Phase> = new Map([
  ['morning', 'morning'],
  ['dawn', 'morning'],
  ['sunrise', 'morning'],
  ['daybreak', 'morning'],
  ['afternoon', 'afternoon'],
  ['midday', 'afternoon'],
  ['noon', 'afternoon'],
  ['evening', 'evening'],
  ['dusk', 'evening'],
  ['sunset', 'evening'],
  ['twilight', 'evening'],
  ['nightfall', 'evening'],
  ['night', 'night'],
  ['midnight', 'night'],
]);

/** A digit clock like `3:15`, `15:00` or `9:05pm`. */
const CLOCK_DIGITS = /^\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?m\.?)?$/i;

/** Any run of digits, so "3", "1945" and "12th" all trip the numeral class. */
const HAS_DIGIT = /\d/;

/**
 * Split text into word tokens, keeping the apostrophe (so "o'clock" and
 * "don't" survive) and the colon (so "3:15" survives as one token). Everything
 * else is a separator. Returned tokens keep their original case; callers
 * lower-case when they compare.
 */
function tokenize(text: string): string[] {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’:]*/gu);
  return matches ?? [];
}

/** Normalise a token for case- and apostrophe-insensitive comparison. */
function normalize(token: string): string {
  return token.toLowerCase().replace(/[’]/g, "'");
}

/**
 * Build the set of tokens that appear verbatim in the Fact Lines, the scene
 * descriptor and the explicit allowlist. Membership is case-insensitive, which
 * matches "Tuesday" in a Fact Line allowing a sentence-cased "Tuesday".
 */
function buildAllowed(context: SpecificsContext): ReadonlySet<string> {
  const allowed = new Set<string>();
  const add = (text: string): void => {
    for (const token of tokenize(text)) {
      allowed.add(normalize(token));
    }
  };
  for (const line of context.factLines) {
    add(line);
  }
  add(context.sceneDescriptor);
  for (const word of context.allowedWords ?? []) {
    add(normalize(word));
  }
  return allowed;
}

/** True when the raw token is capitalized the way a proper noun would be. */
function isCapitalized(token: string): boolean {
  const first = token[0];
  return first !== undefined && first !== first.toLowerCase();
}

/**
 * Inspect one Flavour sentence and report every specifics violation it
 * contains. An empty `violations` array (and `ok: true`) means the sentence may
 * be released.
 *
 * The checks run per token in reading order, so the returned violations are in
 * the order they occur in the sentence. A token allowed verbatim short-circuits
 * every check for that token, which is what gives the verbatim-token allowance
 * priority over the numeral, name and date classes alike.
 */
export function checkSpecifics(
  sentence: string,
  context: SpecificsContext,
): SpecificsResult {
  const allowed = buildAllowed(context);
  const tokens = tokenize(sentence);
  const violations: SpecificsViolation[] = [];

  tokens.forEach((raw, index) => {
    const token = normalize(raw);

    // The verbatim-token allowance: anything the Sim already put in front of
    // the Narrator is fair game, whatever class it would otherwise fall into.
    if (allowed.has(token)) {
      return;
    }

    const report = (cls: ViolationClass): void => {
      violations.push({ class: cls, token: raw });
    };

    // Numerals: any run of digits. A digit clock is reported as a clock, which
    // is the more specific class, so handle it before the bare-numeral check.
    if (HAS_DIGIT.test(token)) {
      if (CLOCK_DIGITS.test(token)) {
        report('clock');
      } else {
        report('numeral');
      }
      return;
    }

    if (WEEKDAYS.has(token)) {
      report('weekday');
      return;
    }

    if (MONTHS.has(token)) {
      report('month');
      return;
    }

    // "o'clock" is a clock pattern when a spelled-out hour precedes it.
    if (token === "o'clock") {
      report('clock');
      return;
    }

    const phaseOf = TIME_OF_DAY.get(token);
    if (phaseOf !== undefined && phaseOf !== context.phase) {
      report('time-of-day');
      return;
    }

    if (NUMBER_WORDS.has(token)) {
      report('number-word');
      return;
    }

    if (token === 'one') {
      // A genuine count ("one coat") trips; a pronoun ("no one") does not.
      const prev = index > 0 ? normalize(tokens[index - 1]) : undefined;
      if (prev === undefined || !ONE_PRONOUN_PREFIXES.has(prev)) {
        report('number-word');
      }
      return;
    }

    // A capitalized token that is not sentence-initial and not allowed is an
    // invented proper name. Sentence-initial capitalization is ordinary and is
    // never a name on its own.
    if (index > 0 && isCapitalized(raw)) {
      report('proper-name');
    }
  });

  return { ok: violations.length === 0, violations };
}
