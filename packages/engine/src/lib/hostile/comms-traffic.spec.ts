/**
 * Tests for the Hostile Service's daily comms traffic for the Cipher Engine
 * (task 19.4; Requirement 29.4).
 *
 * These pin:
 *
 * - production is deterministic for the same channels and day;
 * - a channel with a real payload emits a source carrying those Propositions; a
 *   channel without one emits a single decoy `USES_CHANNEL` source;
 * - every source is tagged `origin: 'deception'` and the channel's owner
 *   category, with a stable `hostile-tx:` id scoped to channel + firing time;
 * - firings land on the tick's day at the channel's phases;
 * - the producer no-ops cleanly when there are no channels or none fire today.
 */

import { describe, expect, it } from 'vitest';

import type {
  ChannelId,
  GameTime,
  OrgId,
  PropId,
  Proposition,
} from '../model/core.js';
import {
  produceCommsTraffic,
  decoyProposition,
  hostileTransmissionId,
  type HostileChannel,
  type HostileChannelProjection,
} from './comms-traffic.js';

const AT: GameTime = { day: 9, phase: 0 };
const LINK: ChannelId = 'chan:hostile/link';
const DECOY: ChannelId = 'chan:noise/decoy';
const OWNER = 'org:hostile' as OrgId;

function payloadProp(): Proposition {
  return {
    id: 'prop:real/1' as PropId,
    subject: OWNER,
    predicate: 'MEETS_WITH',
    object: 'npc:cell-leader' as Proposition['object'],
  };
}

function channel(partial: Partial<HostileChannel> & Pick<HostileChannel, 'channel'>): HostileChannel {
  return {
    owner: OWNER,
    ownerKind: 'hostile',
    firings: [AT.phase],
    ...partial,
  };
}

function projection(...channels: HostileChannel[]): HostileChannelProjection {
  const out: Record<string, HostileChannel> = {};
  for (const c of channels) {
    out[c.channel] = c;
  }
  return out;
}

describe('hostileTransmissionId', () => {
  it('is scoped to the channel and firing time', () => {
    expect(hostileTransmissionId(LINK, AT)).toBe(`hostile-tx:${LINK}@${AT.day}.${AT.phase}`);
  });
});

describe('decoyProposition', () => {
  it('is a routine USES_CHANNEL fact about the channel owner', () => {
    const prop = decoyProposition(channel({ channel: DECOY, owner: OWNER }), AT);
    expect(prop.subject).toBe(OWNER);
    expect(prop.predicate).toBe('USES_CHANNEL');
    expect(prop.object).toEqual({ kind: 'text', value: DECOY });
  });
});

describe('produceCommsTraffic', () => {
  it('carries a real payload when one is projected', () => {
    const real = payloadProp();
    const sources = produceCommsTraffic(
      projection(channel({ channel: LINK, payload: [real] })),
      AT,
    );
    expect(sources).toHaveLength(1);
    expect(sources[0].id).toBe(hostileTransmissionId(LINK, AT));
    expect(sources[0].channel).toBe(LINK);
    expect(sources[0].ownerKind).toBe('hostile');
    expect(sources[0].origin).toBe('deception');
    expect(sources[0].propositions).toEqual([real]);
    expect(sources[0].at).toEqual({ day: AT.day, phase: AT.phase });
  });

  it('emits a single decoy source when a channel has no payload', () => {
    const sources = produceCommsTraffic(
      projection(channel({ channel: DECOY, ownerKind: 'noise' })),
      AT,
    );
    expect(sources).toHaveLength(1);
    expect(sources[0].ownerKind).toBe('noise');
    expect(sources[0].origin).toBe('deception');
    expect(sources[0].propositions).toHaveLength(1);
    expect(sources[0].propositions[0].predicate).toBe('USES_CHANNEL');
  });

  it('mints one source per firing phase, on the tick day', () => {
    const sources = produceCommsTraffic(
      projection(channel({ channel: LINK, firings: [2, 0] })),
      AT,
    );
    // Phases are stably sorted ⇒ [0, 2].
    expect(sources.map((s) => s.at.phase)).toEqual([0, 2]);
    expect(sources.every((s) => s.at.day === AT.day)).toBe(true);
  });

  it('is deterministic and record-order independent (id-sorted channels)', () => {
    const a = produceCommsTraffic(
      projection(channel({ channel: LINK }), channel({ channel: DECOY, ownerKind: 'noise' })),
      AT,
    );
    const b = produceCommsTraffic(
      projection(channel({ channel: DECOY, ownerKind: 'noise' }), channel({ channel: LINK })),
      AT,
    );
    expect(b).toEqual(a);
    // Channels processed in id order: chan:hostile/link before chan:noise/decoy.
    expect(a.map((s) => s.channel)).toEqual([LINK, DECOY]);
  });

  it('no-ops cleanly when there are no channels', () => {
    expect(produceCommsTraffic({}, AT)).toEqual([]);
  });

  it('no-ops cleanly when a channel has no firings today', () => {
    expect(produceCommsTraffic(projection(channel({ channel: LINK, firings: [] })), AT)).toEqual([]);
  });
});
