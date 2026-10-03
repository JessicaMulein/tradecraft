/**
 * The pure Locale formatters (content-expansion task 1.7; design, "Locale and
 * Template Variants").
 *
 * `formatDate`, `formatMoney`, `formatHonorific` and `formatAddress` turn a
 * game date, a money amount, an NPC's gender and an address into the voice of
 * the selected city. Each takes the game's ordered Locale list and follows the
 * city-then-era fallback chain (Req 8.4): it reads the city Locale's field
 * where it is defined and the era Locale's otherwise. The list is ordered most
 * specific first — the city Locale, then the era Locale — so the formatters
 * walk it and take the first Locale that supplies the field they need.
 *
 * Every function here is pure: it reads only its arguments, never the host
 * clock, locale or time zone, so the same inputs always render the same string
 * (the determinism the slice requires of generation, and Property 12 requires
 * of the date round-trip). `content` depends only on `zod` and `yaml`, so the
 * input types a running game would pass — the `GameTime` and the city currency
 * — are declared here as the minimal shapes these formatters read rather than
 * imported from the engine.
 */

import type { Locale } from '../kinds/locale.js';
import {
  addDays,
  parseIsoDate,
  weekdayIndex,
  type IsoDate,
} from './calendar.js';

export type { IsoDate } from './calendar.js';

/**
 * The minimal game-time shape the date formatter reads: a whole number of
 * `day`s since the game's Start Date (the engine's `GameTime.day`). The
 * within-day `phase` does not change the calendar date, so it is accepted but
 * not read here. Declared locally because `content` may not import the engine.
 */
export interface GameTime {
  readonly day: number;
}

/**
 * The city currency shape the money formatter reads (the City Definition's
 * `currency`; design). `symbol` and `subunit` name the units, `format` is the
 * amount's own number format and `rounding` is the unit money is rounded to.
 * Declared locally for the same reason as {@link GameTime}.
 */
export interface Currency {
  readonly name: string;
  readonly symbol: string;
  readonly subunit: string;
  /** The amount's number format, e.g. `"{whole}"` or `"{whole}.{sub}"`. */
  readonly format: string;
  /** The unit amounts are rounded to, e.g. `1` or `5`. */
  readonly rounding: number;
  /** The preset money scale factor (applied at preset resolution, not here). */
  readonly budgetScale: number;
}

/** Replace every `{slot}` in `pattern` from `values`, leaving unknown slots as-is. */
function fillPattern(
  pattern: string,
  values: Readonly<Record<string, string>>,
): string {
  return pattern.replace(/\{([a-z]+)\}/g, (whole, slot: string) =>
    Object.prototype.hasOwnProperty.call(values, slot) ? values[slot] : whole,
  );
}

/**
 * Resolve one Locale field down the city-then-era fallback chain: return the
 * first Locale in `locales` for which `pick` yields a defined, non-empty value
 * (Req 8.4). Returns `undefined` only when no Locale supplies the field.
 */
function resolveField<T>(
  locales: readonly Locale[],
  pick: (loc: Locale) => T | undefined,
): T | undefined {
  for (const loc of locales) {
    const value = pick(loc);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** The error a formatter throws when no Locale in the chain supplies a needed field. */
export class LocaleFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocaleFormatError';
  }
}

/**
 * Format the calendar date of `t` — the Start Date plus `t.day` days — in the
 * Locale's voice, using its long pattern by default or its short pattern when
 * asked (design; Property 12). The pattern's `{weekday}`, `{day}`, `{month}`
 * and `{year}` slots are filled from the Locale's `date` fields; `{day}` is the
 * day of the month and `{year}` the full year, both as plain integers.
 *
 * The date part follows the fallback chain as a unit: the first Locale with a
 * `date` block supplies the pattern and the month and weekday names together,
 * so a city Locale and the era Locale never disagree on, say, the pattern while
 * sharing a month list.
 */
export function formatDate(
  t: GameTime,
  start: IsoDate,
  loc: readonly Locale[],
  style: 'long' | 'short' = 'long',
): string {
  const date = resolveField(loc, (l) => l.date);
  if (date === undefined) {
    throw new LocaleFormatError('no Locale in the chain defines a date format');
  }
  const startDate = parseIsoDate(start);
  if (startDate === undefined) {
    throw new LocaleFormatError(`Start Date is not an ISO date: ${start}`);
  }
  const calendar = addDays(startDate, t.day);
  const monthName = date.months[calendar.month - 1] ?? String(calendar.month);
  const weekdayName = date.weekdays[weekdayIndex(calendar)] ?? '';
  const pattern = style === 'short' ? date.short : date.long;
  return fillPattern(pattern, {
    weekday: weekdayName,
    day: String(calendar.day),
    month: monthName,
    year: String(calendar.year),
  });
}

/**
 * Round `amount` to the currency's `rounding` unit, nearest, ties away from
 * zero. A `rounding` of `0` or less leaves the amount unrounded.
 */
function roundToUnit(amount: number, rounding: number): number {
  if (rounding <= 0) return amount;
  const units = amount / rounding;
  const nearest = units < 0 ? -Math.round(-units) : Math.round(units);
  return nearest * rounding;
}

/**
 * Format a money `amount` in the city currency's voice (design, `formatMoney`).
 * The amount is rounded to the currency's `rounding` unit and laid out through
 * the first Locale currency `pattern` down the fallback chain, whose `{amount}`
 * slot takes the rounded number and `{symbol}` and `{subunit}` slots take the
 * currency's symbol and subunit. The scenario's `budgetScale` is applied at
 * preset resolution (design, Currency), not here.
 */
export function formatMoney(
  amount: number,
  cur: Currency,
  loc: readonly Locale[],
): string {
  const pattern = resolveField(loc, (l) => l.currency?.pattern);
  if (pattern === undefined) {
    throw new LocaleFormatError(
      'no Locale in the chain defines a currency format',
    );
  }
  const rounded = roundToUnit(amount, cur.rounding);
  return fillPattern(pattern, {
    amount: String(rounded),
    symbol: cur.symbol,
    subunit: cur.subunit,
  });
}

/**
 * The honorific for `gender` from the first Locale down the fallback chain that
 * defines one (design: "Frau"/"Herr", "Senhora"/"Senhor"). A Naming Rule's
 * `formal` form fills its `{honorific}` slot from here; the first honorific in
 * the gender's list is the default title.
 */
export function formatHonorific(
  gender: 'f' | 'm',
  loc: readonly Locale[],
): string {
  const honorific = resolveField(loc, (l) => l.honorifics?.[gender]?.[0]);
  if (honorific === undefined) {
    throw new LocaleFormatError(
      `no Locale in the chain defines a ${gender === 'f' ? 'female' : 'male'} honorific`,
    );
  }
  return honorific;
}

/** The parts an address is built from: a street, a building number and a district. */
export interface AddressParts {
  readonly street: string;
  readonly number: string;
  readonly district: string;
}

/**
 * Format an address in the Locale's voice (design: `"{street} {number},
 * {district}"`). The first Locale down the fallback chain with an `address`
 * pattern supplies it; its `{street}`, `{number}` and `{district}` slots take
 * the matching parts, and an omitted part renders as the empty string so a
 * pattern that names it does not leave a literal `{slot}` behind.
 */
export function formatAddress(
  parts: AddressParts,
  loc: readonly Locale[],
): string {
  const pattern = resolveField(loc, (l) => l.address);
  if (pattern === undefined) {
    throw new LocaleFormatError('no Locale in the chain defines an address format');
  }
  return fillPattern(pattern, {
    street: parts.street,
    number: parts.number,
    district: parts.district,
  });
}
