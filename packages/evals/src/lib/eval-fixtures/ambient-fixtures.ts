/**
 * Ambient eval fixtures (ambient-world Req 24.4). Replay mode feeds the
 * scripted replies through the Leak Guard and the Specifics Guard. No model
 * is called. Each fixture also counts recollection phrases the speaker does
 * not hold.
 */

import { EntityRegistry, type EntityEntry, type EntityId } from '@tradecraft/engine';
import { checkLeak, splitSentences } from '@tradecraft/dialogue';
import { checkSpecifics, type Phase } from '@tradecraft/dialogue';

export interface AmbientReply {
  readonly role: 'voice' | 'narrator';
  readonly text: string;
}

export interface AmbientEvalFixture {
  readonly id: 'gossiping-waiter' | 'festival-arrival';
  readonly seed: string;
  readonly phase: Phase;
  readonly factLines: readonly string[];
  readonly sceneDescriptor: string;
  readonly allowed: readonly EntityId[];
  /** Phrases that count as a recollection reference when a reply contains them. */
  readonly recollections: readonly { readonly phrase: string; readonly held: boolean }[];
  readonly replies: readonly AmbientReply[];
}

const REGISTRY_ENTRIES: readonly EntityEntry[] = [
  { id: 'npc:viktor', canonicalName: 'Viktor', aliases: [{ text: 'Viktor', distinctive: true }] },
  { id: 'npc:mira', canonicalName: 'Mira', aliases: [{ text: 'Mira', distinctive: true }] },
  { id: 'evt:fair', canonicalName: 'Harvest fair', aliases: [{ text: 'Harvest fair', distinctive: true }] },
];

const registry = EntityRegistry.from([...REGISTRY_ENTRIES]);

export function ambientEvalFixtures(): readonly AmbientEvalFixture[] {
  return [
    {
      id: 'gossiping-waiter',
      seed: 'ambient-gossiping-waiter',
      phase: 'afternoon',
      factLines: ['The cafe is busy.'],
      sceneDescriptor: 'A waiter at the cafe.',
      allowed: [],
      recollections: [
        { phrase: 'seeing you at the cafe', held: true },
        { phrase: "the minister's papers", held: false },
      ],
      replies: [
        { role: 'voice', text: 'I remember seeing you at the cafe.' },
        { role: 'voice', text: "I remember the minister's papers." },
        { role: 'voice', text: 'Viktor asked after you at 3 o\'clock.' },
      ],
    },
    {
      id: 'festival-arrival',
      seed: 'ambient-festival-arrival',
      phase: 'afternoon',
      factLines: ['The harvest fair fills the square.'],
      sceneDescriptor: 'The square during the harvest fair.',
      allowed: ['evt:fair'],
      recollections: [{ phrase: 'paying the porter', held: false }],
      replies: [
        { role: 'narrator', text: 'The harvest fair fills the square as you arrive.' },
        { role: 'narrator', text: 'You remember paying the porter.' },
        { role: 'narrator', text: 'Mira watches from the doorway at 9:15.' },
      ],
    },
  ];
}

export interface AmbientEvalMeasure {
  readonly id: AmbientEvalFixture['id'];
  readonly leakTrips: number;
  readonly specificsTrips: number;
  readonly unheldRecollections: number;
}

/** Score one fixture from its scripted replies. Replay mode: no gateway. */
export function measureAmbientFixture(fixture: AmbientEvalFixture): AmbientEvalMeasure {
  let leakTrips = 0;
  let specificsTrips = 0;
  let unheldRecollections = 0;
  for (const reply of fixture.replies) {
    for (const sentence of splitSentences(reply.text)) {
      const leak = checkLeak(sentence, { registry, allowed: fixture.allowed });
      if (!leak.ok) {
        leakTrips += 1;
      }
      const specifics = checkSpecifics(sentence, {
        factLines: fixture.factLines,
        sceneDescriptor: fixture.sceneDescriptor,
        phase: fixture.phase,
      });
      if (!specifics.ok) {
        specificsTrips += 1;
      }
    }
    for (const recollection of fixture.recollections) {
      if (!recollection.held && reply.text.toLowerCase().includes(recollection.phrase.toLowerCase())) {
        unheldRecollections += 1;
      }
    }
  }
  return { id: fixture.id, leakTrips, specificsTrips, unheldRecollections };
}
