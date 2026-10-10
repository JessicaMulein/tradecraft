/**
 * The real calendar a game day maps onto.
 *
 * Game day 0 is the setting's start date. Weekdays, public holidays and the
 * month the weather tables read all follow that date, so a Sunday is a Sunday
 * and December is winter. When a caller has no start date, the older Monday
 * count in `time-mapping` still applies.
 *
 * The fixed holidays are the ones occupied Austria kept: New Year, Epiphany,
 * Labour Day, Assumption, All Saints, the Immaculate Conception, Christmas and
 * St Stephen's Day. Easter Monday, Ascension, Whit Monday and Corpus Christi
 * move with Easter.
 */

import { addDays, parseIsoDate, type CalendarDate } from '@tradecraft/content';

import { CONTENT_WEEKDAYS, weekdayForDay } from './time-mapping.js';

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
] as const;

/** A fixed public holiday, named for the paper's closed-day notice. */
const FIXED_HOLIDAYS: readonly { readonly month: number; readonly day: number; readonly name: string }[] = [
  { month: 1, day: 1, name: "New Year's Day" },
  { month: 1, day: 6, name: 'Epiphany' },
  { month: 5, day: 1, name: 'Labour Day' },
  { month: 8, day: 15, name: 'Assumption' },
  { month: 11, day: 1, name: "All Saints' Day" },
  { month: 12, day: 8, name: 'the Immaculate Conception' },
  { month: 12, day: 25, name: 'Christmas' },
  { month: 12, day: 26, name: "St Stephen's Day" },
];

export interface DatedDay {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/** Why the paper stays closed and the office keeps Sunday hours. */
export type DayOff =
  | { readonly kind: 'sunday' }
  | { readonly kind: 'holiday'; readonly name: string };

/** The calendar date `day` days after `startDate`, or undefined when the date does not parse. */
export function datedDay(startDate: string, day: number): DatedDay | undefined {
  const start = parseIsoDate(startDate);
  if (start === undefined || !Number.isInteger(day) || day < 0) {
    return undefined;
  }
  const date = addDays(start, day);
  return { year: date.year, month: date.month, day: date.day };
}

/** The calendar month (1–12) of a game day, or undefined when the start date does not parse. */
export function calendarMonth(startDate: string, day: number): number | undefined {
  return datedDay(startDate, day)?.month;
}

/** A date a player can read, such as `1 December 1952`. */
export function calendarLabel(startDate: string, day: number): string {
  const date = datedDay(startDate, day);
  if (date === undefined) {
    return `day ${day}`;
  }
  const month = MONTHS[date.month - 1] ?? String(date.month);
  return `${date.day} ${month} ${date.year}`;
}

/** The public holiday on that game day, when there is one. */
export function publicHoliday(startDate: string, day: number): string | undefined {
  const date = datedDay(startDate, day);
  if (date === undefined) {
    return undefined;
  }
  const fixed = FIXED_HOLIDAYS.find((holiday) => holiday.month === date.month && holiday.day === date.day);
  if (fixed !== undefined) {
    return fixed.name;
  }
  const movable = movableHolidays(date.year);
  const hit = movable.find((holiday) => holiday.month === date.month && holiday.day === date.day);
  return hit?.name;
}

/**
 * Sunday, or a public holiday. A holiday that falls on Sunday is named as the
 * holiday. Undefined on an ordinary weekday.
 */
export function dayOffReason(startDate: string, day: number): DayOff | undefined {
  const holiday = publicHoliday(startDate, day);
  if (holiday !== undefined) {
    return { kind: 'holiday', name: holiday };
  }
  if (weekdayForDay(day, startDate) === 'sunday') {
    return { kind: 'sunday' };
  }
  return undefined;
}

/**
 * The schedule column for a game day: the real weekday, except a public holiday
 * uses the Sunday column so offices and shops stay shut. With no start date the
 * column is the Monday-based count.
 */
export function scheduleWeekdayIndex(day: number, startDate?: string): number {
  if (startDate !== undefined && publicHoliday(startDate, day) !== undefined) {
    return CONTENT_WEEKDAYS.indexOf('sunday');
  }
  return CONTENT_WEEKDAYS.indexOf(weekdayForDay(day, startDate));
}

/** Easter Sunday for `year`, by the Anonymous Gregorian computus. */
function easterSunday(year: number): CalendarDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

function movableHolidays(year: number): { month: number; day: number; name: string }[] {
  const easter = easterSunday(year);
  return [
    { ...shift(easter, 1), name: 'Easter Monday' },
    { ...shift(easter, 39), name: 'Ascension' },
    { ...shift(easter, 50), name: 'Whit Monday' },
    { ...shift(easter, 60), name: 'Corpus Christi' },
  ];
}

function shift(date: CalendarDate, days: number): { month: number; day: number } {
  const next = addDays(date, days);
  return { month: next.month, day: next.day };
}
