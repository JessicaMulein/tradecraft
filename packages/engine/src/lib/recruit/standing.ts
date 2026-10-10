/**
 * A standing meeting with a recruited agent.
 *
 * The slot is fixed from the agent's id and the player's flat (or café, when
 * there is no flat). It does not draw on a random stream.
 */

import type { NpcId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import { habitsOf } from '../city/ordinary-life.js';
import type { Relationship } from './asset.js';

const WEEKDAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const;
const PHASES = [0, 1, 2] as const;

function mix(id: string): number {
  let n = 0;
  for (let i = 0; i < id.length; i += 1) {
    n = (n * 33 + id.charCodeAt(i)) % 10007;
  }
  return n;
}

/** The weekday, phase, and place a new agent will keep, when the city has one. */
export function standingAppointment(
  npc: NpcId,
  state: WorldState,
): Relationship['standing'] | undefined {
  const habits = state.player.habits ?? habitsOf(state.city);
  const at = habits.flat ?? habits.cafe;
  if (at === undefined) {
    return undefined;
  }
  const n = mix(npc);
  const weekday = WEEKDAYS[n % WEEKDAYS.length];
  const phase = PHASES[n % PHASES.length];
  return { weekday, phase, at };
}
