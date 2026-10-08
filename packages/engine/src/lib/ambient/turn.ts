import type { WorldState } from '../model/state.js';

import { noticeTurn, type NoticeAction } from './memory.js';

/** Notice checks and regard for the action inside the turn draft. */
export function ambientTurnNotices(world: WorldState, action?: NoticeAction): WorldState {
  return noticeTurn(world, action);
}
