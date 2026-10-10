/**
 * A Claim as a sentence. The same words the Fact Line uses when a predicate
 * template cannot be filled, with the names the player already knows.
 */

import { describeProposition, type Proposition } from '@tradecraft/engine';

import { lookupName, type KnownNames } from '../aids/action-label.js';

export function claimSentence(
  prop: Pick<Proposition, 'subject' | 'predicate' | 'object' | 'place'>,
  names: KnownNames,
): string {
  return describeProposition(prop, (id) => lookupName(names, id));
}
