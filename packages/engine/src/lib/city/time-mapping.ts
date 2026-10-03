/**
 * The bridge between the Sim's four-phase game clock and the content model's
 * eight-phase, named-weekday vocabulary.
 *
 * The engine's {@link GameTime} divides a day into four phases
 * (`0 morning … 3 night`, see `../model/core.ts`) because that is the grain the
 * player acts at. Content — opening hours, crowd curves, schedule templates —
 * is authored against the finer eight-phase day (`early-morning …
 * dead-of-night`) and the seven named weekdays (`PHASES`/`WEEKDAYS` in
 * `@tradecraft/content`). The city generator and the pure {@link
 * import('./city.js').crowdLevel} have to read authored curves at a concrete
 * engine time, so they need a fixed, total mapping in both directions.
 *
 * This module owns that mapping and nothing else. It is pure data plus pure
 * functions:
 *
 * - Each engine phase covers a contiguous run of content phases
 *   ({@link CONTENT_PHASES_BY_ENGINE_PHASE}). Morning absorbs the pre-dawn and
 *   morning content phases, afternoon the midday/afternoon ones, evening its
 *   own, and night the late and small hours. The partition is total and
 *   non-overlapping, so every content phase belongs to exactly one engine
 *   phase.
 * - A day counter maps to a weekday by `day mod 7`, with day 0 a Monday
 *   ({@link weekdayForDay}). The slice has no calendar start, so this is a fixed
 *   convention the whole engine shares; a later spec that introduces a real
 *   Start Date can offset it.
 * - A day maps to a calendar month, and a month to the season whose table the
 *   weather draw reads ({@link monthForDay}, {@link seasonMonths}). Months are a
 *   fixed 30 days for the slice, again a convention a Start Date spec refines.
 *
 * Every function here is deterministic and side-effect free, which is what lets
 * `crowdLevel` and the weather draw stay pure (design, "Locations and
 * Movement").
 */

import { PHASES, WEEKDAYS } from '@tradecraft/content';

import { type GameTime, type Phase } from '../model/core.js';

/**
 * A content phase name (the eight-phase day). Derived from the `PHASES` const
 * array `@tradecraft/content` exports, so it stays in lockstep with the content
 * vocabulary without the content package needing to export a type alias.
 */
export type ContentPhase = (typeof PHASES)[number];

/** A content weekday name. Derived from the exported `WEEKDAYS` const array. */
export type Weekday = (typeof WEEKDAYS)[number];

/**
 * The content phase names, re-exported from `@tradecraft/content` so callers in
 * this module read against one list. The eight-phase day, in order.
 */
export const CONTENT_PHASES = PHASES;

/** The seven weekday names, in order, Monday first. */
export const CONTENT_WEEKDAYS = WEEKDAYS;

/**
 * The content phases each engine phase covers, in content-phase order. The four
 * runs partition the eight content phases with no gap and no overlap:
 *
 * - `0` morning   → `early-morning`, `morning`
 * - `1` afternoon → `midday`, `afternoon`
 * - `2` evening   → `evening`
 * - `3` night     → `night`, `late-night`, `dead-of-night`
 *
 * Opening hours and crowd curves authored at the fine grain are folded onto the
 * engine phase by reading every content phase in the matching run (the
 * aggregation rule is the reader's: hours OR together, crowd takes the max).
 */
export const CONTENT_PHASES_BY_ENGINE_PHASE: Readonly<
  Record<Phase, readonly ContentPhase[]>
> = {
  0: ['early-morning', 'morning'],
  1: ['midday', 'afternoon'],
  2: ['evening'],
  3: ['night', 'late-night', 'dead-of-night'],
};

/**
 * The reverse map: the engine phase each content phase folds into. Built from
 * {@link CONTENT_PHASES_BY_ENGINE_PHASE} so the two can never drift.
 */
export const ENGINE_PHASE_BY_CONTENT_PHASE: Readonly<
  Record<ContentPhase, Phase>
> = (() => {
  const out = {} as Record<ContentPhase, Phase>;
  for (const enginePhase of [0, 1, 2, 3] as const) {
    for (const contentPhase of CONTENT_PHASES_BY_ENGINE_PHASE[enginePhase]) {
      out[contentPhase] = enginePhase;
    }
  }
  return out;
})();

/** The engine phase a content phase folds into. */
export function enginePhaseOf(contentPhase: ContentPhase): Phase {
  return ENGINE_PHASE_BY_CONTENT_PHASE[contentPhase];
}

/** The content phases an engine phase covers, in content-phase order. */
export function contentPhasesOf(phase: Phase): readonly ContentPhase[] {
  return CONTENT_PHASES_BY_ENGINE_PHASE[phase];
}

/** The number of days in the slice's fixed-length month. */
export const DAYS_PER_MONTH = 30;

/** The number of months in a year. */
export const MONTHS_PER_YEAR = 12;

/**
 * The weekday a day counter lands on. Day 0 is Monday, so `day mod 7` indexes
 * {@link CONTENT_WEEKDAYS}. A negative `day` is rejected: the clock never runs
 * before day 0.
 */
export function weekdayForDay(day: number): Weekday {
  if (!Number.isInteger(day) || day < 0) {
    throw new RangeError(
      `weekdayForDay(): day must be a non-negative integer, received ${String(day)}`,
    );
  }
  return CONTENT_WEEKDAYS[day % CONTENT_WEEKDAYS.length];
}

/**
 * The calendar month (1–12) a day lands on, given the month the game starts in.
 *
 * Months are a fixed {@link DAYS_PER_MONTH} days for the slice. `startMonth` is
 * 1-based (1 = January); day 0 is the first day of `startMonth`, and the month
 * rolls over every {@link DAYS_PER_MONTH} days, wrapping December → January.
 */
export function monthForDay(day: number, startMonth: number): number {
  if (!Number.isInteger(day) || day < 0) {
    throw new RangeError(
      `monthForDay(): day must be a non-negative integer, received ${String(day)}`,
    );
  }
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > MONTHS_PER_YEAR) {
    throw new RangeError(
      `monthForDay(): startMonth must be an integer in [1, 12], received ${String(startMonth)}`,
    );
  }
  const monthsElapsed = Math.floor(day / DAYS_PER_MONTH);
  // Shift to 0-based, add elapsed months, wrap, shift back to 1-based.
  return ((startMonth - 1 + monthsElapsed) % MONTHS_PER_YEAR) + 1;
}

/** The weekday of a whole {@link GameTime}. */
export function weekdayOf(t: GameTime): Weekday {
  return weekdayForDay(t.day);
}
