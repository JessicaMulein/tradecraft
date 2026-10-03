/**
 * Property 12: Locale date round-trip (content-expansion task 2.7).
 *
 * > For any Locale, Start Date and GameTime, parsing `formatDate(t, start,
 * > locale)` with the Locale's long-date pattern yields the calendar date of
 * > `t`. The formatter uses the city Locale's fields where they are defined and
 * > the era Locale's fields otherwise.
 *
 * **Validates: Requirements 8.4**
 *
 * The example-based date formatting and the calendar-arithmetic seed round-trip
 * live in `format.spec.ts`; this file is the dedicated Property 12 test. It
 * drives the full `formatDate` path — the city-then-era fallback chain, both
 * long and short patterns, and arbitrary day offsets and Start Dates — and then
 * *parses the rendered string back* to the calendar date it names, asserting
 * that calendar date equals Start Date + GameTime.day.
 *
 * The round-trip is genuine: the test does not re-derive the expected string by
 * running the formatter again. It builds each Locale's date pattern from a known
 * slot order and unambiguous literal separators, so the rendered output can be
 * decomposed back into `{weekday}`, `{day}`, `{month}` and `{year}` and each
 * slot inverted — the month name looked up in the Locale's month list, the day
 * and year read as integers, the weekday cross-checked against the calendar —
 * recovering a {@link CalendarDate} that must match the arithmetic truth.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { LocaleSchema, type Locale } from '../kinds/locale.js';
import {
  addDays,
  parseIsoDate,
  toIsoDate,
  weekdayIndex,
  type CalendarDate,
} from './calendar.js';
import { formatDate } from './format.js';

/**
 * A distinct month-name set per Locale, so a parse that looks a rendered month
 * up in the wrong Locale's list would fail. Names avoid digits and the literal
 * separators the patterns use, so they never collide with the `{day}`/`{year}`
 * integers or the pattern delimiters.
 */
function monthNames(tag: string): string[] {
  return Array.from({ length: 12 }, (_, i) => `${tag}month${String.fromCharCode(65 + i)}`);
}

/** A distinct weekday-name set per Locale, Monday→Sunday (the `weekdayIndex` order). */
function weekdayNames(tag: string): string[] {
  return Array.from({ length: 7 }, (_, i) => `${tag}day${String.fromCharCode(65 + i)}`);
}

/**
 * The ordered slots a long pattern lays out, each with the literal separator
 * that follows it. Keeping the slot order fixed and the separators free of
 * digits and letters lets the parser split a rendered string back into its
 * slots unambiguously, whatever month and weekday names the Locale uses.
 */
interface LongShape {
  readonly pattern: string;
  readonly order: readonly ('weekday' | 'day' | 'month' | 'year')[];
  readonly seps: readonly string[]; // one trailing separator per slot (last may be '')
}

/** A handful of long-pattern shapes, each with a parser-friendly layout. */
const longShapes: readonly LongShape[] = [
  {
    pattern: '{weekday}, {day} {month} {year}',
    order: ['weekday', 'day', 'month', 'year'],
    seps: [', ', ' ', ' ', ''],
  },
  {
    pattern: '{day} {month} {year} ({weekday})',
    order: ['day', 'month', 'year', 'weekday'],
    seps: [' ', ' ', ' (', ')'],
  },
  {
    pattern: '{weekday} / {month} / {day} / {year}',
    order: ['weekday', 'month', 'day', 'year'],
    seps: [' / ', ' / ', ' / ', ''],
  },
];

/** A short-pattern shape mirroring the long one but without the weekday. */
interface ShortShape {
  readonly pattern: string;
  readonly order: readonly ('day' | 'month' | 'year')[];
  readonly seps: readonly string[];
}

const shortShapes: readonly ShortShape[] = [
  {
    pattern: '{day}|{month}|{year}',
    order: ['day', 'month', 'year'],
    seps: ['|', '|', ''],
  },
  {
    pattern: '{year}~{month}~{day}',
    order: ['year', 'month', 'day'],
    seps: ['~', '~', ''],
  },
];

/** Build a schema-valid Locale with the chosen scope, names and patterns. */
function makeLocale(
  scope: Locale['scope'],
  tag: string,
  long: LongShape,
  short: ShortShape,
): Locale {
  return LocaleSchema.parse({
    scope,
    date: {
      long: long.pattern,
      short: short.pattern,
      months: monthNames(tag),
      weekdays: weekdayNames(tag),
    },
    currency: { pattern: '{amount} {symbol}' },
    honorifics: { f: ['Ms'], m: ['Mr'] },
    address: '{street} {number}, {district}',
    terms: [],
    allowNames: [],
  });
}

/**
 * Split `rendered` into its ordered slot values using `seps`, the trailing
 * separator after each slot. Each slot value is the text up to the next
 * separator; the last slot runs to the end of the string.
 */
function splitBySeps(
  rendered: string,
  seps: readonly string[],
): string[] | undefined {
  const values: string[] = [];
  let rest = rendered;
  for (let i = 0; i < seps.length; i++) {
    const sep = seps[i];
    if (sep === '') {
      values.push(rest);
      rest = '';
      continue;
    }
    const at = rest.indexOf(sep);
    if (at < 0) return undefined;
    values.push(rest.slice(0, at));
    rest = rest.slice(at + sep.length);
  }
  return values;
}

/**
 * Parse a rendered long date back to the calendar date it names, inverting the
 * formatter against the Locale that supplied the date block. The month name is
 * looked up in `months`, the day and year are read as integers, and the weekday
 * name is cross-checked so the parse rejects a mislabelled day of the week.
 */
function parseLongDate(
  rendered: string,
  shape: LongShape,
  months: readonly string[],
  weekdays: readonly string[],
): CalendarDate | undefined {
  const parts = splitBySeps(rendered, shape.seps);
  if (parts === undefined) return undefined;
  const slots: Partial<Record<'weekday' | 'day' | 'month' | 'year', string>> = {};
  shape.order.forEach((slot, i) => {
    slots[slot] = parts[i];
  });

  const monthIndex = months.indexOf(slots.month ?? '');
  if (monthIndex < 0) return undefined;
  const day = Number(slots.day);
  const year = Number(slots.year);
  if (!Number.isInteger(day) || !Number.isInteger(year)) return undefined;

  const date: CalendarDate = { year, month: monthIndex + 1, day };
  // The weekday name must match the calendar's own weekday for the parsed date.
  if (weekdays[weekdayIndex(date)] !== slots.weekday) return undefined;
  return date;
}

/** Parse a rendered short date (no weekday) back to its calendar date. */
function parseShortDate(
  rendered: string,
  shape: ShortShape,
  months: readonly string[],
): CalendarDate | undefined {
  const parts = splitBySeps(rendered, shape.seps);
  if (parts === undefined) return undefined;
  const slots: Partial<Record<'day' | 'month' | 'year', string>> = {};
  shape.order.forEach((slot, i) => {
    slots[slot] = parts[i];
  });
  const monthIndex = months.indexOf(slots.month ?? '');
  if (monthIndex < 0) return undefined;
  const day = Number(slots.day);
  const year = Number(slots.year);
  if (!Number.isInteger(day) || !Number.isInteger(year)) return undefined;
  return { year, month: monthIndex + 1, day };
}

/** A Start Date arbitrary spanning the slice's eras and well beyond, as an ISO string. */
const startDateArb = fc
  .date({
    min: new Date(Date.UTC(1900, 0, 1)),
    max: new Date(Date.UTC(2100, 11, 31)),
    noInvalidDate: true,
  })
  .map((d) => toIsoDate({
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  }));

const longShapeArb = fc.constantFrom(...longShapes);
const shortShapeArb = fc.constantFrom(...shortShapes);

describe('Property 12: Locale date round-trip', () => {
  // Feature: content-expansion, Property 12
  it('recovers Start Date + GameTime.day from a long-date render, city Locale', () => {
    fc.assert(
      fc.property(
        startDateArb,
        fc.integer({ min: -200000, max: 200000 }),
        longShapeArb,
        shortShapeArb,
        (start, dayOffset, long, short) => {
          const city = makeLocale({ city: 'city-x' }, 'c', long, short);
          const rendered = formatDate({ day: dayOffset }, start, [city], 'long');
          const parsed = parseLongDate(
            rendered,
            long,
            city.date.months,
            city.date.weekdays,
          );
          const expected = addDays(parseIsoDate(start)!, dayOffset);
          expect(parsed).toEqual(expected);
        },
      ),
    );
  });

  // Feature: content-expansion, Property 12
  it('recovers the calendar date from a short-date render too', () => {
    fc.assert(
      fc.property(
        startDateArb,
        fc.integer({ min: -200000, max: 200000 }),
        longShapeArb,
        shortShapeArb,
        (start, dayOffset, long, short) => {
          const city = makeLocale({ city: 'city-x' }, 'c', long, short);
          const rendered = formatDate({ day: dayOffset }, start, [city], 'short');
          const parsed = parseShortDate(rendered, short, city.date.months);
          const expected = addDays(parseIsoDate(start)!, dayOffset);
          expect(parsed).toEqual(expected);
        },
      ),
    );
  });

  // Feature: content-expansion, Property 12
  it('takes the city date block when the city Locale defines one, down the chain', () => {
    fc.assert(
      fc.property(
        startDateArb,
        fc.integer({ min: -200000, max: 200000 }),
        longShapeArb,
        shortShapeArb,
        longShapeArb,
        shortShapeArb,
        (start, dayOffset, cityLong, cityShort, eraLong, eraShort) => {
          // Both Locales define a date block; the chain must use the city one,
          // so the render must parse under the *city* pattern and names, and
          // (unless the shapes/names coincide) not under the era's.
          const city = makeLocale({ city: 'city-x' }, 'c', cityLong, cityShort);
          const era = makeLocale({ era: 'era-y' }, 'e', eraLong, eraShort);
          const rendered = formatDate({ day: dayOffset }, start, [city, era], 'long');
          const parsed = parseLongDate(
            rendered,
            cityLong,
            city.date.months,
            city.date.weekdays,
          );
          const expected = addDays(parseIsoDate(start)!, dayOffset);
          expect(parsed).toEqual(expected);
        },
      ),
    );
  });

  // Feature: content-expansion, Property 12
  it('falls back to the era date block when the city Locale has none', () => {
    fc.assert(
      fc.property(
        startDateArb,
        fc.integer({ min: -200000, max: 200000 }),
        longShapeArb,
        shortShapeArb,
        (start, dayOffset, long, short) => {
          // Only an era Locale is present: the formatter must use its date
          // block (Req 8.4), so the render parses under the era pattern/names.
          const era = makeLocale({ era: 'era-y' }, 'e', long, short);
          const rendered = formatDate({ day: dayOffset }, start, [era], 'long');
          const parsed = parseLongDate(
            rendered,
            long,
            era.date.months,
            era.date.weekdays,
          );
          const expected = addDays(parseIsoDate(start)!, dayOffset);
          expect(parsed).toEqual(expected);
        },
      ),
    );
  });
});
