/**
 * The Extension Registry (street-ops design, `engine/extension`).
 *
 * An add-on registers namespaced action kinds, state slices, truth slices,
 * objective kinds and hooks. The engine never imports a view-side enumerator.
 * With nothing registered, quote and resolve of every built-in kind are the
 * slice path.
 */

import type { ZodType } from 'zod';

import type { ExtensionAction } from '../action/types.js';
import type { ActionQuote, ResolveResult, ResolverContext } from '../action/result.js';
import type { LocId } from '../model/core.js';
import type { WorldState } from '../model/state.js';
import type { Prng } from '../prng/prng.js';

export interface ActionExtension<A extends ExtensionAction = ExtensionAction> {
  readonly kind: `${string}.${string}`;
  readonly schema: ZodType<A>;
  readonly phaseAccounting: 'standard' | 'sub-phase';
  readonly requiresSession?: string;
  quote(state: WorldState, action: A, ctx: ResolverContext): ActionQuote;
  resolve(state: WorldState, action: A, rng: Prng, ctx: ResolverContext): ResolveResult;
  location?(action: A): LocId | undefined;
}

export interface StateSliceExtension<S> {
  readonly key: string;
  readonly version: number;
  readonly schema: ZodType<S>;
  initial(world: WorldState, ctx: ResolverContext): S;
  migrate?(old: unknown, from: number): S;
}

export interface TruthSliceExtension<T> {
  readonly key: string;
  readonly schema: ZodType<T>;
  initial(): T;
}

export interface ObjectiveKindExtension {
  readonly kind: string;
}

export interface HookExtension {
  readonly id: string;
}

/** Engine half of an add-on. Enumerators and phrasebook stay in player-view. */
export interface AddOn {
  readonly id: string;
  readonly version: string;
  readonly actions: readonly ActionExtension[];
  readonly state: readonly StateSliceExtension<unknown>[];
  readonly truth: readonly TruthSliceExtension<unknown>[];
  readonly objectives: readonly ObjectiveKindExtension[];
  readonly hooks: readonly HookExtension[];
}

export interface ExtensionRegistry {
  register(addon: AddOn): void;
  action(kind: string): ActionExtension | undefined;
  readonly addons: readonly AddOn[];
}

export function createExtensionRegistry(): ExtensionRegistry {
  const actions = new Map<string, ActionExtension>();
  const addons: AddOn[] = [];
  return {
    get addons() {
      return addons;
    },
    register(addon) {
      addons.push(addon);
      for (const action of addon.actions) {
        actions.set(action.kind, action);
      }
    },
    action(kind) {
      return actions.get(kind);
    },
  };
}

/** A namespaced kind belongs to an add-on. Built-in kinds have no dot. */
export function isExtensionKind(kind: string): kind is `${string}.${string}` {
  return kind.includes('.');
}
