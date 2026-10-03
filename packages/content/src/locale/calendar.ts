/**
 * Proleptic-Gregorian calendar arithmetic for the Locale date formatter
 * (content-expansion task 1.7).
 *
 * The date formatter turns a {@link GameTime} — a whole number of days and a
 * within-day phase, counted from the game's Start Date — into a calendar date,
 * so it needs day-count ↔ `(year, month, day)` conversions that do not depend
 * on the host `Date` object or its time zone. `content` imports only `zod` and
 * `yaml`, so this module carries its own small, pure, time-zone-free calendar.
 *
 * Years, months (1–12) and days (1–31) are plain integers. A day number is the
 * count of days since 1970-01-01 (day 0), matching the usual epoch so the maths
 * is easy to check, but nothing here reads the clock.
 */

/** A calendar date in the proleptic Gregorian calendar. */
export interface CalendarDate {
  readonly year: number;
  /** Month of the year, 1 (January) – 12 (December). */
  readonly month: number;
  /** Day of the month, 1 – 31. */
  readonly day: number;
}

/** An ISO 8601 calendar date, `YYYY-MM-DD` (the Start Date form). */
export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `year` is a leap year in the Gregorian calendar. */
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** The number of days in `month` (1–12) of `year`. */
export function daysInMonth(year: number, month: number): number {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) return 29;
  return lengths[month - 1] ?? 0;
}

/**
 * Parse an ISO date string into a {@link CalendarDate}. Returns `undefined` on
 * a malformed string or an out-of-range month or day, so a bad Start Date is
 * caught rather than silently producing a wrong calendar.
 */
export function parseIsoDate(iso: IsoDate): CalendarDate | undefined {
  const m = ISO_DATE.exec(iso);
  if (m === null) return undefined;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return undefined;
  if (day < 1 || day > daysInMonth(year, month)) return undefined;
  return { year, month, day };
}

/** Format a {@link CalendarDate} back to an ISO `YYYY-MM-DD` string. */
export function toIsoDate(date: CalendarDate): IsoDate {
  const yyyy = String(date.year).padStart(4, '0');
  const mm = String(date.month).padStart(2, '0');
  const dd = String(date.day).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Days from 1970-01-01 to `date` (which is day 0). Uses Howard Hinnant's
 * civil-from/days algorithm, so it is correct across the proleptic Gregorian
 * calendar for any year and never touches the host clock.
 */
export function daysFromEpoch(date: CalendarDate): number {
  const y = date.month <= 2 ? date.year - 1 : date.year;
  const era = Math.floor((y >= 0 ? y : y - 399) / 400);
  const yoe = y - era * 400; // [0, 399]
  const doy =
    Math.floor((153 * (date.month > 2 ? date.month - 3 : date.month + 9) + 2) / 5) +
    date.day -
    1; // [0, 365]
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

/** The {@link CalendarDate} `days` days after 1970-01-01 (the inverse of {@link daysFromEpoch}). */
export function dateFromEpoch(days: number): CalendarDate {
  const z = days + 719468;
  const era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  const doe = z - era * 146097; // [0, 146096]
  const yoe = Math.floor(
    (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
  ); // [0, 399]
  const y = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  const month = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  return { year: month <= 2 ? y + 1 : y, month, day };
}

/** Add `days` days to a calendar date (negative to subtract). */
export function addDays(date: CalendarDate, days: number): CalendarDate {
  return dateFromEpoch(daysFromEpoch(date) + days);
}

/**
 * The day of the week of `date`, 0 (Monday) – 6 (Sunday). ISO 8601 numbers the
 * week from Monday; the index selects a name from a Locale's `weekdays` list,
 * which is in that order.
 */
export function weekdayIndex(date: CalendarDate): number {
  // 1970-01-01 was a Thursday (index 3 with Monday = 0).
  const raw = (daysFromEpoch(date) + 3) % 7;
  return raw < 0 ? raw + 7 : raw;
}
