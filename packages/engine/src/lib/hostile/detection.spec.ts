/**
 * Tests for the Hostile Service daily detection check and the arrest/double/feed
 * response selection (task 19.1; Requirements 12.2, 12.3).
 *
 * These pin:
 *
 * - the detection probability formula and its monotonicity in Exposure and
 *   security consciousness, and that a zero-Exposure Asset is never detected;
 * - the doctrine-driven response selection — arrest / double / feed chosen by
 *   doctrine and the Asset's turned/suspicion state (Requirement 12.3);
 * - that a blown double (turned by the player, now distrusted) is arrested;
 * - that a turned Asset is never doubled again;
 * - determinism of the daily pass and that an already-suspected Asset is
 *   skipped (no re-detection, no extra draw).
 */

import { describe, expect, it } from 'vitest';

import type { NpcId } from '../model/core.js';
import { createPrng } from '../prng/prng.js';
import type { Doctrine } from './doctrine.js';
import {
  emptyHostileBeliefs,
  accrueExposure,
  raiseAgentSuspicion,
  markSuspected,
} from './beliefs.js';
import {
  detectionProbability,
  chooseResponse,
  runDetection,
  BLOWN_AGENT_SUSPICION,
  type DetectionBase,
} from './detection.js';

const BASE: DetectionBase = { surveil: 0.1, meeting: 0.06, drop: 0.04 };
const NPC = 'npc:asset-1' as NpcId;

function doctrine(overrides: Partial<Doctrine> = {}): Doctrine {
  return {
    riskTolerance: 0.5,
    securityConsciousness: 0.5,
    deceptionAppetite: 0.5,
    ...overrides,
  };
}

describe('detectionProbability', () => {
  it('is zero for a zero-Exposure, un-suspected Asset', () => {
    const p = detectionProbability(emptyHostileBeliefs(), NPC, doctrine(), BASE);
    expect(p).toBe(0);
  });

  it('rises with Exposure', () => {
    const low = detectionProbability(
      accrueExposure(emptyHostileBeliefs(), NPC, 0.2),
      NPC,
      doctrine(),
      BASE,
    );
    const high = detectionProbability(
      accrueExposure(emptyHostileBeliefs(), NPC, 0.8),
      NPC,
      doctrine(),
      BASE,
    );
    expect(high).toBeGreaterThan(low);
  });

  it('rises with security consciousness', () => {
    const beliefs = accrueExposure(emptyHostileBeliefs(), NPC, 0.5);
    const lax = detectionProbability(beliefs, NPC, doctrine({ securityConsciousness: 0 }), BASE);
    const sharp = detectionProbability(beliefs, NPC, doctrine({ securityConsciousness: 1 }), BASE);
    expect(sharp).toBeGreaterThan(lax);
  });

  it('clamps to [0, 1]', () => {
    const beliefs = accrueExposure(emptyHostileBeliefs(), NPC, 1);
    const p = detectionProbability(beliefs, NPC, doctrine({ securityConsciousness: 1 }), {
      ...BASE,
      meeting: 1,
    });
    expect(p).toBeLessThanOrEqual(1);
    expect(p).toBeGreaterThanOrEqual(0);
  });

  it('reads agent suspicion as well as Exposure', () => {
    const beliefs = raiseAgentSuspicion(emptyHostileBeliefs(), NPC, 0.9);
    expect(detectionProbability(beliefs, NPC, doctrine(), BASE)).toBeGreaterThan(0);
  });
});

describe('chooseResponse', () => {
  it('arrests when deception appetite is low', () => {
    const d = doctrine({ deceptionAppetite: 0.05, riskTolerance: 0.2 });
    expect(chooseResponse(d, { turnedByPlayer: false, agentSuspicion: 0 })).toBe('arrest');
  });

  it('doubles when risk tolerance is high and deception appetite is modest', () => {
    const d = doctrine({ deceptionAppetite: 0.2, riskTolerance: 0.95 });
    expect(chooseResponse(d, { turnedByPlayer: false, agentSuspicion: 0 })).toBe('double');
  });

  it('feeds when deception appetite is high', () => {
    const d = doctrine({ deceptionAppetite: 0.95, riskTolerance: 0.5 });
    expect(chooseResponse(d, { turnedByPlayer: false, agentSuspicion: 0 })).toBe('feed');
  });

  it('never doubles an Asset the player already turned', () => {
    const d = doctrine({ deceptionAppetite: 0.1, riskTolerance: 0.95 });
    // High riskTolerance would pick double, but a player-turned Asset cannot be
    // doubled; it falls to arrest or feed.
    expect(chooseResponse(d, { turnedByPlayer: true, agentSuspicion: 0 })).not.toBe('double');
  });

  it('arrests a blown double (turned, now distrusted)', () => {
    const d = doctrine({ deceptionAppetite: 0.95, riskTolerance: 0.95 });
    // deception/risk would normally keep it in play, but a distrusted double is
    // arrested regardless.
    expect(
      chooseResponse(d, { turnedByPlayer: true, agentSuspicion: BLOWN_AGENT_SUSPICION }),
    ).toBe('arrest');
  });
});

describe('runDetection', () => {
  it('is deterministic for the same seed', () => {
    const beliefs = accrueExposure(emptyHostileBeliefs(), NPC, 0.9);
    const a = runDetection(
      createPrng('d'),
      [{ npc: NPC, turnedByPlayer: false }],
      beliefs,
      doctrine(),
      { ...BASE, meeting: 0.5 },
    );
    const b = runDetection(
      createPrng('d'),
      [{ npc: NPC, turnedByPlayer: false }],
      beliefs,
      doctrine(),
      { ...BASE, meeting: 0.5 },
    );
    expect(a).toEqual(b);
  });

  it('never detects a zero-Exposure Asset', () => {
    const result = runDetection(
      createPrng('x'),
      [{ npc: NPC, turnedByPlayer: false }],
      emptyHostileBeliefs(),
      doctrine(),
      BASE,
    );
    expect(result.detections).toHaveLength(0);
  });

  it('skips an already-suspected Asset without drawing', () => {
    // Mark suspected, then a certain-detection base: a skipped Asset yields no
    // detection, and the stream is untouched (the following draw matches a run
    // with no candidates).
    const beliefs = markSuspected(accrueExposure(emptyHostileBeliefs(), NPC, 1), NPC);
    const rng = createPrng('s');
    const result = runDetection(
      rng,
      [{ npc: NPC, turnedByPlayer: false }],
      beliefs,
      doctrine(),
      { ...BASE, meeting: 1 },
    );
    expect(result.detections).toHaveLength(0);
    const afterSkip = rng.next();

    const rng2 = createPrng('s');
    runDetection(rng2, [], beliefs, doctrine(), { ...BASE, meeting: 1 });
    const afterEmpty = rng2.next();
    expect(afterSkip).toBe(afterEmpty);
  });

  it('detects and chooses a response for a highly-exposed Asset', () => {
    const beliefs = accrueExposure(emptyHostileBeliefs(), NPC, 1);
    // meeting:1 and max security forces p=1 (clamped), so detection is certain.
    const result = runDetection(
      createPrng('hit'),
      [{ npc: NPC, turnedByPlayer: false }],
      beliefs,
      doctrine({ deceptionAppetite: 0.05, riskTolerance: 0.1 }),
      { ...BASE, meeting: 1 },
    );
    expect(result.detections).toHaveLength(1);
    expect(result.detections[0]).toEqual({ npc: NPC, response: 'arrest' });
  });
});
