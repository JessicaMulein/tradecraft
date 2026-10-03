import { describe, expect, it } from 'vitest';

import type { Role } from '../../config/models-config.js';
import { CallPriority, PRIORITY_ORDER, rolePriority } from './priority.js';

describe('CallPriority', () => {
  it('orders the bands intent → voice → narrator → extraction', () => {
    expect(PRIORITY_ORDER).toEqual([
      CallPriority.Intent,
      CallPriority.Voice,
      CallPriority.Narrator,
      CallPriority.Extraction,
    ]);
  });

  it('uses ascending ranks so a smaller rank is higher priority', () => {
    expect(CallPriority.Intent).toBeLessThan(CallPriority.Voice);
    expect(CallPriority.Voice).toBeLessThan(CallPriority.Narrator);
    expect(CallPriority.Narrator).toBeLessThan(CallPriority.Extraction);
  });
});

describe('rolePriority', () => {
  it.each<[Role, CallPriority]>([
    ['fast', CallPriority.Intent],
    ['voice', CallPriority.Voice],
    ['judge', CallPriority.Voice],
    ['narrator', CallPriority.Narrator],
    ['bookkeeping', CallPriority.Extraction],
  ])('maps the %s role to its pipeline band', (role, expected) => {
    expect(rolePriority(role)).toBe(expected);
  });
});
