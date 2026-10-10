/**
 * Attach the street-ops slices without touching a world that does not ask.
 */

import type { WorldState } from '../model/state.js';

import { emptyStreetOpsState, migrateStreetOpsState, type StreetOpsState } from './state.js';
import { streetReplayHeader } from './stream.js';

/** The view-safe slice, migrated, or absent when the world has none. */
export function streetOpsOf(world: WorldState): StreetOpsState | undefined {
  const saved = world.ext?.streetOps;
  if (saved === undefined) return undefined;
  return migrateStreetOpsState(saved, streetReplayHeader());
}

/**
 * Write the empty slice when it is missing. Generation does not call this, so
 * a disabled game never grows an `ext` key.
 */
export function ensureStreetOps(world: WorldState): WorldState {
  if (world.ext?.streetOps !== undefined) return world;
  return {
    ...world,
    ext: { ...world.ext, streetOps: emptyStreetOpsState(streetReplayHeader()) },
  };
}
