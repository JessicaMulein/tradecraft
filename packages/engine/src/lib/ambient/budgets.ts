/**
 * Density caps from the ambient-world design table. `rich` is the 1.0 column.
 * Caps that the table holds constant stay constant.
 */

import type { Density } from './state.js';

export interface AmbientBudgets {
  readonly fullTier: number;
  readonly townsfolk: number;
  readonly eventStarts: number;
  readonly activeEvents: number;
  readonly incidentsPerDay: number;
  readonly lifeEventsPerDay: number;
  readonly gossipPerDay: number;
  readonly promotionsPerDay: number;
  readonly slowGatePerDay: number;
  readonly activeStories: number;
  readonly emergentThreads: number;
}

const TABLE: Record<Density, AmbientBudgets> = {
  rich: {
    fullTier: 48,
    townsfolk: 160,
    eventStarts: 2,
    activeEvents: 6,
    incidentsPerDay: 12,
    lifeEventsPerDay: 6,
    gossipPerDay: 40,
    promotionsPerDay: 3,
    slowGatePerDay: 6,
    activeStories: 12,
    emergentThreads: 3,
  },
  standard: {
    fullTier: 48,
    townsfolk: 120,
    eventStarts: 1,
    activeEvents: 4,
    incidentsPerDay: 9,
    lifeEventsPerDay: 4,
    gossipPerDay: 30,
    promotionsPerDay: 3,
    slowGatePerDay: 6,
    activeStories: 12,
    emergentThreads: 3,
  },
  sparse: {
    fullTier: 48,
    townsfolk: 80,
    eventStarts: 1,
    activeEvents: 3,
    incidentsPerDay: 6,
    lifeEventsPerDay: 3,
    gossipPerDay: 20,
    promotionsPerDay: 3,
    slowGatePerDay: 6,
    activeStories: 12,
    emergentThreads: 3,
  },
};

export function ambientBudgets(density: Density): AmbientBudgets {
  return TABLE[density];
}
