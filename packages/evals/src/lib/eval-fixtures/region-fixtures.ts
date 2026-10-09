/**
 * Regional eval fixtures (multi-city task 14.3; Req 18). Replay mode feeds
 * scripted replies through the slice Leak Guard, Specifics Guard and
 * MetricsCollector. No model is called.
 */

import { checkLeak, checkSpecifics, splitSentences, type Phase } from '@tradecraft/dialogue';
import { EntityRegistry, type EntityEntry, type EntityId } from '@tradecraft/engine';

import { METRIC_ROLES, MetricsCollector } from '../metrics/index.js';

export interface RegionReply {
  readonly role: 'voice' | 'narrator';
  readonly text: string;
}

export interface RegionEvalFixture {
  readonly id: 'border-inspection' | 'liaison-meeting' | 'carriage-conversation';
  readonly seed: string;
  readonly phase: Phase;
  readonly factLines: readonly string[];
  readonly sceneDescriptor: string;
  readonly allowed: readonly EntityId[];
  readonly replies: readonly RegionReply[];
}

const REGISTRY_ENTRIES: readonly EntityEntry[] = [
  { id: 'npc:viktor', canonicalName: 'Viktor', aliases: [{ text: 'Viktor', distinctive: true }] },
  { id: 'npc:mira', canonicalName: 'Mira', aliases: [{ text: 'Mira', distinctive: true }] },
  { id: 'npc:greta', canonicalName: 'Greta', aliases: [{ text: 'Greta', distinctive: true }] },
];

const registry = EntityRegistry.from([...REGISTRY_ENTRIES]);

export function regionEvalFixtures(): readonly RegionEvalFixture[] {
  return [
    {
      id: 'border-inspection',
      seed: 'region-border-inspection',
      phase: 'afternoon',
      factLines: ['The guard opens the suitcase.'],
      sceneDescriptor: 'A secondary inspection room at the frontier.',
      allowed: [],
      replies: [
        { role: 'voice', text: 'The guard opens the suitcase and waits.' },
        { role: 'voice', text: "Viktor asked after you at 3 o'clock." },
      ],
    },
    {
      id: 'liaison-meeting',
      seed: 'region-liaison-meeting',
      phase: 'afternoon',
      factLines: ['The liaison officer pours tea.'],
      sceneDescriptor: 'A meeting room at the liaison office.',
      allowed: [],
      replies: [
        { role: 'voice', text: 'The liaison officer pours tea.' },
        { role: 'voice', text: 'Mira asked after you at 9:15.' },
      ],
    },
    {
      id: 'carriage-conversation',
      seed: 'region-carriage-conversation',
      phase: 'night',
      factLines: ['The carriage rocks on the night train.'],
      sceneDescriptor: 'A compartment on the night train.',
      allowed: [],
      replies: [
        { role: 'narrator', text: 'The carriage rocks on the night train.' },
        { role: 'narrator', text: "Greta named the courier at 3 o'clock." },
      ],
    },
  ];
}

export interface RegionEvalMeasure {
  readonly id: RegionEvalFixture['id'];
  readonly leakGuardTrips: number;
  readonly specificsGuardTrips: number;
  readonly roles: readonly string[];
}

/** Score one fixture from its scripted replies. Replay mode: no gateway. */
export function measureRegionFixture(fixture: RegionEvalFixture): RegionEvalMeasure {
  const collector = new MetricsCollector();
  for (const reply of fixture.replies) {
    for (const sentence of splitSentences(reply.text)) {
      const leak = checkLeak(sentence, { registry, allowed: fixture.allowed });
      collector.recordLeakGuard({
        outcome: leak.ok ? 'clean' : 'deflected',
        regenerations: leak.ok ? 0 : 1,
        hits: leak.hits,
      });
      const specifics = checkSpecifics(sentence, {
        factLines: fixture.factLines,
        sceneDescriptor: fixture.sceneDescriptor,
        phase: fixture.phase,
      });
      collector.recordSpecificsGuard(specifics);
    }
    collector.recordReply(reply.role, { outcome: 'clean', breaks: [] });
  }
  const snapshot = collector.snapshot();
  return {
    id: fixture.id,
    leakGuardTrips: snapshot.leakGuardTrips,
    specificsGuardTrips: snapshot.specificsGuardTrips,
    roles: METRIC_ROLES,
  };
}
