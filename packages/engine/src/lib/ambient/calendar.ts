/**
 * Calendar dates from the setting start date (ambient-world Req 7). Day 0 is
 * that date. Seasons follow the northern months the city's weather tables use.
 */

import { addDays, daysFromEpoch, parseIsoDate } from '@tradecraft/content';

export type SeasonName = 'spring' | 'summer' | 'autumn' | 'winter';

export interface HolidayDef {
  readonly id: string;
  readonly month: number;
  readonly day: number;
}

export interface CalendarDay {
  readonly date: string;
  readonly season: SeasonName;
  readonly holidays: readonly string[];
}

export function seasonForMonth(month: number): SeasonName {
  if (month === 12 || month <= 2) {
    return 'winter';
  }
  if (month <= 5) {
    return 'spring';
  }
  if (month <= 8) {
    return 'summer';
  }
  return 'autumn';
}

/** The calendar date `day` days after `startDate` (`YYYY-MM-DD`). */
export function calendarDate(startDate: string, day: number): string {
  const parsed = parseIsoDate(startDate as `${number}-${number}-${number}`);
  if (parsed === undefined) {
    return startDate;
  }
  const next = addDays(parsed, day);
  const month = String(next.month).padStart(2, '0');
  const date = String(next.day).padStart(2, '0');
  return `${next.year}-${month}-${date}`;
}

export function holidayIds(holidays: readonly HolidayDef[], date: string): string[] {
  const parsed = parseIsoDate(date as `${number}-${number}-${number}`);
  if (parsed === undefined) {
    return [];
  }
  return holidays
    .filter((holiday) => holiday.month === parsed.month && holiday.day === parsed.day)
    .map((holiday) => holiday.id);
}

export function calendarDay(
  startDate: string,
  day: number,
  holidays: readonly HolidayDef[],
): CalendarDay {
  const date = calendarDate(startDate, day);
  return {
    date,
    season: seasonForMonth(Number(date.slice(5, 7))),
    holidays: holidayIds(holidays, date),
  };
}

/** Day offset of a holiday in the start year, or undefined when the date does not parse. */
export function holidayDay(startDate: string, holiday: HolidayDef): number | undefined {
  const start = parseIsoDate(startDate as `${number}-${number}-${number}`);
  if (start === undefined) {
    return undefined;
  }
  const target = parseIsoDate(
    `${start.year}-${String(holiday.month).padStart(2, '0')}-${String(holiday.day).padStart(2, '0')}` as `${number}-${number}-${number}`,
  );
  if (target === undefined) {
    return undefined;
  }
  const offset = daysFromEpoch(target) - daysFromEpoch(start);
  return offset >= 0 ? offset : undefined;
}
