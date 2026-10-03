/**
 * The pure Locale formatters (content-expansion task 1.7).
 *
 * This directory holds the date, currency, honorific and address formatters
 * (design, "Locale and Template Variants") and the small, time-zone-free
 * calendar the date formatter is built on. Everything here is pure and depends
 * only on the Locale schema and the plain input types declared alongside the
 * formatters, keeping `content` free of any workspace or extra npm dependency.
 */

export {
  formatAddress,
  formatDate,
  formatHonorific,
  formatMoney,
  LocaleFormatError,
  type AddressParts,
  type Currency,
  type GameTime,
} from './format.js';

export {
  addDays,
  dateFromEpoch,
  daysFromEpoch,
  daysInMonth,
  isLeapYear,
  parseIsoDate,
  toIsoDate,
  weekdayIndex,
  type CalendarDate,
} from './calendar.js';
