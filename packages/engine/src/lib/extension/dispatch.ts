/**
 * Dispatch a namespaced action through the Extension Registry.
 * An unregistered kind is refused. Built-in kinds never reach this.
 */

import type { ExtensionAction } from '../action/types.js';
import type { ActionQuote, ResolveResult, ResolverContext } from '../action/result.js';
import type { WorldState } from '../model/state.js';
import type { Prng } from '../prng/prng.js';

const UNAVAILABLE: ActionQuote = {
  allowed: false,
  reason: 'unavailable',
  phases: 0,
  money: 0,
};

export function quoteExtension(
  state: WorldState,
  action: ExtensionAction,
  ctx: ResolverContext,
): ActionQuote {
  const found = ctx.extensions?.action(action.kind);
  if (found === undefined) return UNAVAILABLE;
  const parsed = found.schema.safeParse(action);
  if (!parsed.success) return UNAVAILABLE;
  return found.quote(state, parsed.data, ctx);
}

export function resolveExtension(
  state: WorldState,
  action: ExtensionAction,
  rng: Prng,
  ctx: ResolverContext,
): ResolveResult {
  const found = ctx.extensions?.action(action.kind);
  if (found === undefined) return { next: state, result: empty(state) };
  const parsed = found.schema.safeParse(action);
  if (!parsed.success) return { next: state, result: empty(state) };
  return found.resolve(state, parsed.data, rng, ctx);
}

function empty(state: WorldState): ResolveResult['result'] {
  return {
    observations: [],
    factLines: [],
    scene: { loc: state.player.loc, description: '', atmosphere: [], risk: 0, visible: [] },
    events: [],
    claimsAdded: [],
  };
}
