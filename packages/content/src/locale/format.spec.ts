/**
 * Tests for the pure Locale formatters (content-expansion task 1.7).
 *
 * Cover `formatDate`, `formatMoney`, `formatHonorific` and `formatAddress`:
 * their output in a city Locale, the city-then-era fallback chain (Req 8.4),
 * rounding, and the error when the chain supplies no formatter. A property test
 * exercises the calendar arithmetic the date formatter is built on, so the
 * engine's Locale date round-trip (Property 12, task 2.7) starts from a sound
 * base.
 */

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { LocaleSchema, type Locale } from '../kinds/locale.js';
import {
  addDays,
  dateFromEpoch,
  daysFromEpoch,
  formatAddress,
  formatDate,
  formatHonorific,
  formatMoney,
  isLeapYear,
  LocaleFormatError,
  parseIsoDate,
  toIsoDate,
  weekdayIndex,
  type Currency,
} from './index.js';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/** A Vienna-flavoured city Locale that parses through the schema. */
const vienna: Locale = LocaleSchema.parse({
  scope: { city: 'city-vienna' },
  date: {
    long: '{weekday}, {day} {month} {year}',
    short: '{day}.{month}.{year}',
    months: MONTHS,
    weekdays: WEEKDAYS,
  },
  currency: { pattern: '{amount} {symbol}' },
  honorifics: { f: ['Frau'], m: ['Herr'] },
  address: '{street} {number}, {district}',
  terms: [{ term: 'Beisl', definition: 'a small neighbourhood pub' }],
  allowNames: ['Prater'],
});

/** An era Locale with a different voice, used to probe the fallback chain. */
const era: Locale = LocaleSchema.parse({
  scope: { era: 'era-cold-war-early' },
  date: {
    long: '{day} {month} {year}',
    short: '{day}/{month}/{year}',
    months: MONTHS,
    weekdays: WEEKDAYS,
  },
  currency: { pattern: '{symbol}{amount}' },
  honorifics: { f: ['Madam'], m: ['Sir'] },
  address: '{number} {street}',
  terms: [],
  allowNames: [],
});

const schilling: Currency = {
  name: 'Schilling',
  symbol: 'öS',
  subunit: 'Groschen',
  format: '{whole}',
  rounding: 5,
  budgetScale: 1,
};

describe('formatDate', () => {
  it('renders the Start Date itself at day 0 with the city long pattern', () => {
    // 1953-06-14 was a Sunday.
    expect(formatDate({ day: 0 }, '1953-06-14', [vienna])).toBe(
      'Sunday, 14 June 1953',
    );
  });

  it('advances the calendar date by GameTime.day', () => {
    // 20 days after 1953-06-14 is 1953-07-04 (a Saturday).
    expect(formatDate({ day: 20 }, '1953-06-14', [vienna])).toBe(
      'Saturday, 4 July 1953',
    );
  });

  it('crosses a month and year boundary correctly', () => {
    // 1953-12-29 + 5 days = 1954-01-03.
    expect(formatDate({ day: 5 }, '1953-12-29', [vienna, era])).toBe(
      'Sunday, 3 January 1954',
    );
  });

  it('uses the short pattern when asked', () => {
    expect(formatDate({ day: 0 }, '1953-06-14', [vienna], 'short')).toBe(
      '14.June.1953',
    );
  });

  it('falls back to the era Locale when no city Locale is present', () => {
    expect(formatDate({ day: 0 }, '1953-06-14', [era])).toBe('14 June 1953');
  });

  it('throws when no Locale supplies a date format', () => {
    expect(() => formatDate({ day: 0 }, '1953-06-14', [])).toThrow(
      LocaleFormatError,
    );
  });

  it('throws on a malformed Start Date', () => {
    expect(() => formatDate({ day: 0 }, 'not-a-date', [vienna])).toThrow(
      LocaleFormatError,
    );
  });
});

describe('formatMoney', () => {
  it('rounds to the currency unit and lays it out through the city pattern', () => {
    expect(formatMoney(123, schilling, [vienna])).toBe('125 öS');
  });

  it('rounds down when nearer the lower unit', () => {
    expect(formatMoney(122, schilling, [vienna])).toBe('120 öS');
  });

  it('leaves the amount unrounded when rounding is zero', () => {
    const noRound: Currency = { ...schilling, rounding: 0 };
    expect(formatMoney(123, noRound, [vienna])).toBe('123 öS');
  });

  it('uses the era currency pattern down the fallback chain', () => {
    expect(formatMoney(120, schilling, [era])).toBe('öS120');
  });

  it('throws when no Locale supplies a currency format', () => {
    expect(() => formatMoney(100, schilling, [])).toThrow(LocaleFormatError);
  });
});

describe('formatHonorific', () => {
  it('returns the city honorific for each gender', () => {
    expect(formatHonorific('f', [vienna])).toBe('Frau');
    expect(formatHonorific('m', [vienna])).toBe('Herr');
  });

  it('falls back to the era honorific', () => {
    expect(formatHonorific('f', [era])).toBe('Madam');
  });

  it('throws when no Locale supplies honorifics', () => {
    expect(() => formatHonorific('m', [])).toThrow(LocaleFormatError);
  });
});

describe('formatAddress', () => {
  it('renders the address through the city pattern', () => {
    expect(
      formatAddress(
        { street: 'Kärntner Straße', number: '12', district: 'Innere Stadt' },
        [vienna],
      ),
    ).toBe('Kärntner Straße 12, Innere Stadt');
  });

  it('uses the era address pattern down the fallback chain', () => {
    expect(
      formatAddress(
        { street: 'Kärntner Straße', number: '12', district: 'Innere Stadt' },
        [era],
      ),
    ).toBe('12 Kärntner Straße');
  });

  it('throws when no Locale supplies an address format', () => {
    expect(() =>
      formatAddress({ street: 's', number: '1', district: 'd' }, []),
    ).toThrow(LocaleFormatError);
  });
});

describe('calendar arithmetic', () => {
  it('agrees with a known leap-year count', () => {
    expect(isLeapYear(1952)).toBe(true);
    expect(isLeapYear(1953)).toBe(false);
    expect(isLeapYear(1900)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
  });

  it('round-trips a date through the epoch day count', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -200000, max: 200000 }),
        (days) => {
          expect(daysFromEpoch(dateFromEpoch(days))).toBe(days);
        },
      ),
    );
  });

  it('round-trips an ISO date through parse and format', () => {
    expect(toIsoDate(parseIsoDate('1953-06-14')!)).toBe('1953-06-14');
  });

  it('advancing then parsing the long date recovers the calendar date', () => {
    // The core of Property 12: formatDate's calendar date equals start + day.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20000 }),
        (dayOffset) => {
          const start = parseIsoDate('1945-01-01')!;
          const expected = addDays(start, dayOffset);
          const rendered = formatDate({ day: dayOffset }, '1945-01-01', [
            vienna,
          ]);
          const name = WEEKDAYS[weekdayIndex(expected)];
          expect(rendered).toBe(
            `${name}, ${expected.day} ${MONTHS[expected.month - 1]} ${expected.year}`,
          );
        },
      ),
    );
  });
});
