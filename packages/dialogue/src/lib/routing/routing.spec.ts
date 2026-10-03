/**
 * Unit tests for turn routing by scene stakes (Requirement 4.4): a dialogue
 * turn is voiced by the `voice` role when the scene is high-stakes
 * (interrogation, recruitment pitch, confronting a suspected Double Agent) and
 * by the `fast` role otherwise.
 *
 * These pin the rule on each named high-stakes scene kind, each escalating
 * Intent, the routine fallback, and the purity/determinism contract the Turn
 * Pipeline relies on for retry and replay.
 */

import { INTENTS, type Intent } from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import {
  isHighStakes,
  routeTurnRole,
  type SceneKind,
  type SceneStakesInput,
} from './routing.js';

const HIGH_STAKES_SCENES: SceneKind[] = [
  'interrogation',
  'recruitment-pitch',
  'confront-double-agent',
];
const HIGH_STAKES_INTENTS: Intent[] = [
  'pitch-money',
  'pitch-ideology',
  'pitch-coercion',
  'pitch-ego',
  'confront',
];

describe('routeTurnRole — high-stakes by scene kind (Req 4.4)', () => {
  it('routes each named high-stakes scene to the voice role', () => {
    for (const sceneKind of HIGH_STAKES_SCENES) {
      expect(routeTurnRole({ sceneKind })).toBe('voice');
      expect(isHighStakes({ sceneKind })).toBe(true);
    }
  });

  it('keeps a high-stakes scene on voice regardless of a routine Intent', () => {
    for (const sceneKind of HIGH_STAKES_SCENES) {
      expect(routeTurnRole({ sceneKind, intent: 'small-talk' })).toBe('voice');
    }
  });
});

describe('routeTurnRole — routine scenes route to fast (Req 4.4)', () => {
  it('routes a routine scene with a routine Intent to fast', () => {
    expect(routeTurnRole({ sceneKind: 'routine', intent: 'ask' })).toBe('fast');
    expect(isHighStakes({ sceneKind: 'routine', intent: 'ask' })).toBe(false);
  });

  it('routes to fast when nothing is known about the turn', () => {
    expect(routeTurnRole({})).toBe('fast');
  });

  it('routes routine, non-escalating Intents to fast with no scene', () => {
    const routine: Intent[] = [
      'ask',
      'reassure',
      'threaten',
      'probe',
      'task',
      'small-talk',
      'end',
    ];
    for (const intent of routine) {
      expect(routeTurnRole({ intent })).toBe('fast');
    }
  });
});

describe('routeTurnRole — escalation by Intent (Req 4.4)', () => {
  it('escalates a routine scene to voice on a pitch or confront', () => {
    for (const intent of HIGH_STAKES_INTENTS) {
      expect(routeTurnRole({ sceneKind: 'routine', intent })).toBe('voice');
      expect(isHighStakes({ sceneKind: 'routine', intent })).toBe(true);
    }
  });

  it('escalates to voice on a pitch or confront even with no open scene', () => {
    for (const intent of HIGH_STAKES_INTENTS) {
      expect(routeTurnRole({ intent })).toBe('voice');
    }
  });
});

describe('routeTurnRole — contract', () => {
  it('always returns one of exactly voice or fast for every Intent', () => {
    for (const intent of INTENTS as readonly Intent[]) {
      expect(['voice', 'fast']).toContain(routeTurnRole({ intent }));
    }
  });

  it('is deterministic: the same input gives the same role', () => {
    const inputs: SceneStakesInput[] = [
      {},
      { sceneKind: 'routine' },
      { sceneKind: 'interrogation' },
      { intent: 'pitch-ego' },
      { sceneKind: 'routine', intent: 'confront' },
    ];
    for (const input of inputs) {
      expect(routeTurnRole(input)).toBe(routeTurnRole(input));
      expect(isHighStakes(input)).toBe(isHighStakes(input));
    }
  });

  it('does not mutate its input', () => {
    const input: SceneStakesInput = { sceneKind: 'routine', intent: 'ask' };
    const snapshot = { ...input };
    routeTurnRole(input);
    isHighStakes(input);
    expect(input).toEqual(snapshot);
  });
});
