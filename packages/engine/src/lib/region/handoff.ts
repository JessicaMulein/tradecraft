/**
 * Handoffs and courier seizures (multi-city task 9.2–9.3; Requirements 9, 10).
 *
 * A requirement that comes from another city is met only when its handoff is
 * delivered. Disruptions share one key per handoff, so each handoff adds one
 * to abort pressure. Reroutes try the same route, then another route or mode,
 * then another city.
 */

import { accruePressure } from '../clock/plot-abort.js';
import { timeToPhases, type GameTime } from '../model/core.js';
import type { CityId } from '../fidelity/types.js';
import type { PlotState } from '../model/state.js';
import type { Handoff, HandoffStatus } from './world.js';
import type { BorderOutcome } from '../border/check.js';

export function stageReady(requiresOtherCity: boolean, status: HandoffStatus | undefined): boolean {
  if (!requiresOtherCity) {
    return true;
  }
  return status === 'delivered';
}

export function handoffDeadline(producer: GameTime, shortestTransit: number): GameTime {
  const phases = timeToPhases(producer) + shortestTransit;
  return { day: Math.floor(phases / 4), phase: (phases % 4) as GameTime['phase'] };
}

export function deadlineHolds(producer: GameTime, shortestTransit: number, deadline: GameTime): boolean {
  return timeToPhases(deadline) >= timeToPhases(handoffDeadline(producer, shortestTransit));
}

/** Seizure, arrest and compromise of one handoff count once. */
export function recordHandoffDisruption(plot: PlotState, id: string): PlotState {
  return accruePressure(plot, `handoff:${id}`);
}

export type RerouteChoice = 'same-route' | 'other-route' | 'other-city' | 'no-reroute';

export function chooseReroute(options: {
  readonly sameRouteDeparture: boolean;
  readonly otherRouteOrMode: boolean;
  readonly otherCity: boolean;
}): RerouteChoice {
  if (options.sameRouteDeparture) {
    return 'same-route';
  }
  if (options.otherRouteOrMode) {
    return 'other-route';
  }
  if (options.otherCity) {
    return 'other-city';
  }
  return 'no-reroute';
}

export function handoffTraces(handoff: Pick<Handoff, 'from' | 'to'>): readonly {
  readonly site: 'origin' | 'carriage' | 'destination';
  readonly city: CityId;
}[] {
  return [
    { site: 'origin', city: handoff.from },
    { site: 'carriage', city: handoff.from },
    { site: 'destination', city: handoff.to },
  ];
}

/** Arresting the plot leader ends the game. Arresting a cell leader is a disruption. */
export function regionalArrest(
  who: string,
  plotLeader: string,
  cellLeaders: readonly string[],
): { readonly end: boolean; readonly pressureKey?: string } {
  if (who === plotLeader) {
    return { end: true };
  }
  if (cellLeaders.includes(who)) {
    return { end: false, pressureKey: `participant-arrested:${who}` };
  }
  return { end: false };
}

/** A border seizure of a courier's delivery is a seized delivery. */
export function courierSeized(outcome: BorderOutcome): boolean {
  return outcome === 'seizure';
}

export function boardHandoff(handoff: Handoff): Handoff {
  return { ...handoff, status: 'in-transit' };
}

export function arriveHandoff(handoff: Handoff, seized: boolean): Handoff {
  return { ...handoff, status: seized ? 'intercepted' : 'delivered' };
}
