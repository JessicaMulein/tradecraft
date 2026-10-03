/**
 * The Intent vocabulary, `applyIntent` and the scene-kind vocabulary moved to
 * the engine (`recruit/intent.ts`; Requirement 15.5). The dialogue barrel
 * re-exports them unchanged, so its public API keeps the same names bound to
 * the engine's values. The behaviour itself is tested in the engine.
 */

import * as engine from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import * as dialogue from '../../index.js';

describe('dialogue re-exports the engine Intent vocabulary unchanged', () => {
  it('binds every moved value to the engine export', () => {
    expect(dialogue.INTENTS).toBe(engine.INTENTS);
    expect(dialogue.INTENT_DELTAS).toBe(engine.INTENT_DELTAS);
    expect(dialogue.applyIntent).toBe(engine.applyIntent);
    expect(dialogue.isIntent).toBe(engine.isIntent);
    expect(dialogue.SCENE_KINDS).toBe(engine.SCENE_KINDS);
  });

  it('exposes the same Intent and SceneKind types', () => {
    const intent: dialogue.Intent = 'probe' satisfies engine.Intent;
    const kind: dialogue.SceneKind = 'routine' satisfies engine.SceneKind;
    const back: [engine.Intent, engine.SceneKind] = [intent, kind];
    expect(back).toEqual(['probe', 'routine']);
  });
});
