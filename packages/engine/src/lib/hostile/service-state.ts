/**
 * The Hostile Service's running state and its initial draw (design, "Hostile
 * Service AI"; Requirements 12.1, 12.2).
 *
 * This is the data-only core of the Hostile Service: the {@link
 * HostileServiceState} that persists across days and the pure {@link
 * initialHostileServiceState} that draws it at world generation. It is kept in
 * its own module — importing only the doctrine and belief leaves (which import
 * only `../model/core.js`) — so `../model/state.ts` can import
 * {@link HostileServiceState} to replace its `Skeleton` placeholder without a
 * circular import. The event-emitting daily tick and the clock-hook adapter
 * live in `./hostile.ts`, which may import `../model/state.ts` freely because
 * nothing in `../model/state.ts` imports *it* back (the same split the Plot uses
 * between `../city/plot.ts` and `../clock/plot-execution.ts`).
 */

import type { Prng } from '../prng/prng.js';
import { drawDoctrine, type Doctrine, type DoctrineRanges } from './doctrine.js';
import { emptyHostileBeliefs, type HostileBeliefs } from './beliefs.js';

/**
 * The Hostile Service's running state (the design's `HostileService`, minus the
 * method — the engine favours pure functions threading state over stateful
 * objects, so the daily tick is a free function in `./hostile.ts`). It carries
 * the drawn {@link Doctrine} and the {@link HostileBeliefs} that persist across
 * days. This is the real type that replaces the `Skeleton<'HostileServiceState'>`
 * alias in `../model/state.ts`.
 */
export interface HostileServiceState {
  /** The doctrine drawn from the preset's ranges at generation (Req 12.1). */
  readonly doctrine: Doctrine;
  /** The belief model and Exposure tracking (Req 12.2). */
  readonly beliefs: HostileBeliefs;
}

/**
 * Build the initial {@link HostileServiceState} at world generation (Req 12.1):
 * the doctrine drawn from the preset's ranges on the passed {@link Prng}, and an
 * empty belief model. Pure with respect to its inputs; draws exactly the three
 * doctrine samples (see {@link drawDoctrine}), so a seed fixes the doctrine.
 */
export function initialHostileServiceState(
  rng: Prng,
  ranges: DoctrineRanges,
): HostileServiceState {
  return {
    doctrine: drawDoctrine(rng, ranges),
    beliefs: emptyHostileBeliefs(),
  };
}
