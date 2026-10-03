import type { GameTime } from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import {
  buildNarratorPrompt,
  type NarratorPromptInput,
} from './prompt-builder.js';
import {
  sceneDescriptorFromView,
  type NarratorSceneKind,
  type SceneDescriptor,
  type SceneViewInput,
} from './scene-descriptor.js';

function sceneView(overrides: Partial<SceneViewInput> = {}): SceneViewInput {
  const time: GameTime = { day: 2, phase: 0 };
  return {
    location: {
      name: 'Café Mozart',
      description: 'A warm room of marble tables and old mirrors.',
      atmosphere: ['smoky', 'murmuring'],
    },
    time,
    weather: 'cold and clear',
    crowd: 'busy',
    visible: [{ label: 'Viktor' }, { label: 'a man in a grey overcoat' }],
    ...overrides,
  };
}

function scene(
  kind: NarratorSceneKind = 'arrival',
  over: Partial<SceneViewInput> = {},
): SceneDescriptor {
  return sceneDescriptorFromView(sceneView(over), kind);
}

function input(over: Partial<NarratorPromptInput> = {}): NarratorPromptInput {
  return {
    scene: scene(),
    factLines: ['You arrive at Café Mozart.'],
    style: { styleSheet: 'Vienna, 1950s. Terse, cold, four-power unease.' },
    ...over,
  };
}

describe('buildNarratorPrompt — assembly', () => {
  it('orders blocks static to dynamic: frame, style, place, then scene/facts', () => {
    const { text } = buildNarratorPrompt(input());
    const iFrame = text.indexOf('# Narration');
    const iStyle = text.indexOf('# Style');
    const iPlace = text.indexOf('# Place');
    const iScene = text.indexOf('# Scene');
    const iFacts = text.indexOf('# Facts');

    expect(iFrame).toBeGreaterThanOrEqual(0);
    expect(iStyle).toBeGreaterThan(iFrame);
    expect(iPlace).toBeGreaterThan(iStyle);
    expect(iScene).toBeGreaterThan(iPlace);
    expect(iFacts).toBeGreaterThan(iScene);
  });

  it('includes the Location name, description and atmosphere in the Place block', () => {
    const { text } = buildNarratorPrompt(input());
    expect(text).toContain('Café Mozart');
    expect(text).toContain('A warm room of marble tables and old mirrors.');
    expect(text).toContain('Atmosphere: smoky, murmuring.');
  });

  it('renders the dynamic block: time, weather, crowd, visible persons and facts', () => {
    const { text } = buildNarratorPrompt(input());
    expect(text).toContain('It is morning on day 2.');
    expect(text).toContain('The weather is cold and clear.');
    expect(text).toContain('The place is busy.');
    expect(text).toContain('In view: Viktor, a man in a grey overcoat.');
    expect(text).toContain('- You arrive at Café Mozart.');
  });

  it('frames each scene kind distinctly', () => {
    expect(buildNarratorPrompt(input({ scene: scene('arrival') })).text).toContain(
      'You have just arrived.',
    );
    expect(
      buildNarratorPrompt(input({ scene: scene('surveillance') })).text,
    ).toContain('You are watching the scene.');
    expect(buildNarratorPrompt(input({ scene: scene('arrest') })).text).toContain(
      'An arrest is unfolding.',
    );
  });

  it('states the no-numbers/days/times and name-only rules in the frame', () => {
    const { text } = buildNarratorPrompt(input());
    expect(text).toMatch(/no .*number|number.*day.*clock|Do not state any number/i);
    expect(text).toContain('Name only');
  });

  it('omits the Style block when no style sheet is given', () => {
    const { text } = buildNarratorPrompt(input({ style: undefined }));
    expect(text).not.toContain('# Style');
    // The frame still leads and the place still follows.
    expect(text.indexOf('# Narration')).toBeLessThan(text.indexOf('# Place'));
  });

  it('handles an empty visible list and empty fact lines gracefully', () => {
    const { text } = buildNarratorPrompt(
      input({
        scene: scene('wait', { visible: [] }),
        factLines: [],
      }),
    );
    expect(text).toContain('No one else is in view.');
    expect(text).toContain('(No facts to narrate.)');
  });
});

describe('buildNarratorPrompt — purity and prefix stability (Req 15.1)', () => {
  it('is deterministic: same input gives byte-identical output', () => {
    const a = buildNarratorPrompt(input());
    const b = buildNarratorPrompt(input());
    expect(a.text).toBe(b.text);
    expect(a.prefixLength).toBe(b.prefixLength);
  });

  it('keeps the prefix byte-identical when only the dynamic block changes', () => {
    const base = buildNarratorPrompt(input());
    // Same Location and style, but a later time, different crowd and facts.
    const moved = buildNarratorPrompt(
      input({
        scene: scene('surveillance', {
          time: { day: 5, phase: 2 },
          weather: 'a cold drizzle',
          crowd: 'sparse',
          visible: [{ label: 'a woman with a newspaper' }],
        }),
        factLines: ['You watch the entrance.'],
      }),
    );

    expect(moved.prefixLength).toBe(base.prefixLength);
    expect(moved.text.slice(0, moved.prefixLength)).toBe(
      base.text.slice(0, base.prefixLength),
    );
    // ...and the tails genuinely differ, so the prefix is doing real work.
    expect(moved.text.slice(moved.prefixLength)).not.toBe(
      base.text.slice(base.prefixLength),
    );
  });

  it('changes the prefix when the Location changes', () => {
    const atCafe = buildNarratorPrompt(input());
    const atPort = buildNarratorPrompt(
      input({
        scene: scene('arrival', {
          location: {
            name: 'Danube Port',
            description: 'Oil-black water and the groan of cranes.',
            atmosphere: ['damp', 'industrial'],
          },
        }),
      }),
    );
    expect(atPort.text.slice(0, atPort.prefixLength)).not.toBe(
      atCafe.text.slice(0, atCafe.prefixLength),
    );
  });

  it('the prefix is exactly the leading substring of the full prompt', () => {
    const { text, prefixLength } = buildNarratorPrompt(input());
    expect(text.startsWith(text.slice(0, prefixLength))).toBe(true);
    expect(prefixLength).toBeLessThan(text.length);
    // The dynamic block lives entirely after the prefix.
    expect(text.indexOf('# Scene')).toBeGreaterThanOrEqual(prefixLength);
  });
});
