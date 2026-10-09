import type { CrowdLevel, GameTime } from '@tradecraft/engine';
import { describe, expect, it } from 'vitest';

import {
  sceneDescriptorFromView,
  type SceneViewInput,
} from './scene-descriptor.js';

/**
 * A representative Player-View `SceneView`-shaped input. It deliberately carries
 * the extra `location.id` and `location.risk` fields the real `SceneView` has,
 * to prove the projection drops them rather than copying them through. The
 * return type stays `SceneViewInput` (a structural subset), which the richer
 * object satisfies; the extra fields ride along at runtime.
 */
function view(overrides: Partial<SceneViewInput> = {}): SceneViewInput {
  const time: GameTime = { day: 3, phase: 1 };
  const crowd: CrowdLevel = 'busy';
  const base: SceneViewInput = {
    location: {
      id: 'loc:kaffeehaus',
      name: 'Café Mozart',
      description: 'A warm room of marble tables and old mirrors.',
      atmosphere: ['smoky', 'murmuring'],
      risk: 2,
    } as SceneViewInput['location'] & { id: string; risk: number },
    time,
    weather: 'cold and clear',
    crowd,
    visible: [{ label: 'a man in a grey overcoat' }, { label: 'Viktor' }],
  };
  return { ...base, ...overrides };
}

describe('sceneDescriptorFromView — the Player-View projection', () => {
  it('copies only the view-safe fields the Narrator may see', () => {
    const descriptor = sceneDescriptorFromView(view(), 'arrival');

    expect(descriptor).toEqual({
      location: {
        name: 'Café Mozart',
        description: 'A warm room of marble tables and old mirrors.',
        atmosphere: ['smoky', 'murmuring'],
      },
      time: { day: 3, phase: 1 },
      weather: 'cold and clear',
      crowd: 'busy',
      visible: [{ label: 'a man in a grey overcoat' }, { label: 'Viktor' }],
      kind: 'arrival',
    });
  });

  it('drops the Location id and risk band the SceneView also carries', () => {
    const descriptor = sceneDescriptorFromView(view());
    expect(descriptor.location).not.toHaveProperty('id');
    expect(descriptor.location).not.toHaveProperty('risk');
  });

  it('keeps the city name and style sheet on a regional scene', () => {
    const descriptor = sceneDescriptorFromView(
      view({ city: { name: 'Northport', styleSheet: 'Salt and coal smoke.' } }),
    );
    expect(descriptor.city).toEqual({ name: 'Northport', styleSheet: 'Salt and coal smoke.' });
  });

  it('defaults the scene kind to scene-open', () => {
    expect(sceneDescriptorFromView(view()).kind).toBe('scene-open');
  });

  it('makes defensive copies so the descriptor never aliases the view', () => {
    const atmosphere = ['smoky'];
    const visible = [{ label: 'a courier' }];
    const descriptor = sceneDescriptorFromView(
      view({ location: { name: 'X', description: 'd', atmosphere }, visible }),
    );

    expect(descriptor.location.atmosphere).not.toBe(atmosphere);
    expect(descriptor.visible).not.toBe(visible);
    expect(descriptor.visible[0]).not.toBe(visible[0]);

    atmosphere.push('mutated');
    visible.push({ label: 'added later' });
    expect(descriptor.location.atmosphere).toEqual(['smoky']);
    expect(descriptor.visible).toHaveLength(1);
  });

  it('is deterministic: same inputs give a byte-identical descriptor', () => {
    const a = sceneDescriptorFromView(view(), 'surveillance');
    const b = sceneDescriptorFromView(view(), 'surveillance');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('carries no truth-bearing field (only labels for visible persons)', () => {
    const descriptor = sceneDescriptorFromView(view());
    const serialized = JSON.stringify(descriptor);
    // The projection has no access to ids, allegiances or MICE values; a label
    // is the only thing it knows about a visible person.
    expect(serialized).not.toContain('npc:');
    expect(serialized).not.toContain('allegiance');
    for (const person of descriptor.visible) {
      expect(Object.keys(person)).toEqual(['label']);
    }
  });
});
