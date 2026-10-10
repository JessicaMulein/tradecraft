import { describe, expect, it } from 'vitest';

import {
  calendarLabel,
  calendarMonth,
  dayOffReason,
  publicHoliday,
  scheduleWeekdayIndex,
} from './calendar.js';
import { monthForDay, weekdayForDay } from './time-mapping.js';

const START = '1952-12-01';

describe('the late-1952 calendar', () => {
  it('starts on Monday 1 December 1952', () => {
    expect(weekdayForDay(0, START)).toBe('monday');
    expect(calendarLabel(START, 0)).toBe('1 December 1952');
    expect(calendarMonth(START, 0)).toBe(12);
    expect(dayOffReason(START, 0)).toBeUndefined();
  });

  it('keeps Sunday and Christmas closed, and names Easter Monday', () => {
    expect(weekdayForDay(6, START)).toBe('sunday');
    expect(dayOffReason(START, 6)).toEqual({ kind: 'sunday' });
    expect(publicHoliday(START, 24)).toBe('Christmas');
    expect(weekdayForDay(24, START)).toBe('thursday');
    expect(scheduleWeekdayIndex(24, START)).toBe(6);
    expect(publicHoliday(START, 126)).toBe('Easter Monday');
  });

  it('keeps 31 December in December when the 30-day count has already rolled', () => {
    expect(calendarMonth(START, 30)).toBe(12);
    expect(monthForDay(30, 12)).toBe(1);
  });
});
