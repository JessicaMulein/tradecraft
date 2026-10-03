import { createHash } from 'node:crypto';

import type { FrameBuildInput, FrameKind, FrameRequest } from './types.js';

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
      );
    }
    return v;
  });
}

/** The key covers every field including the art direction, so a change re-renders. */
export function frameKey(body: Omit<FrameRequest, 'key'>): string {
  return createHash('sha256').update(canonical(body)).digest('hex');
}

/**
 * Build a Frame Request from Player View data only (Requirement 11.3). It is a
 * pure function: the Location's public name, type, description and atmosphere,
 * the phase, crowd band and weather, the people the player can see, and the art
 * direction. No Truth-branded value can reach it, because its inputs are the
 * two view types.
 */
export function buildFrameRequest(input: FrameBuildInput, kind: FrameKind = 'scene'): FrameRequest {
  const { scene, here, artDirection } = input;
  const body: Omit<FrameRequest, 'key'> = {
    kind,
    location: {
      name: scene.location.name,
      type: scene.location.type,
      description: scene.location.description,
      atmosphere: [...scene.location.atmosphere],
    },
    phase: String(scene.time.phase),
    crowd: String(here.crowd),
    weather: scene.weather,
    visible: here.visible.map((p) => ({ label: p.label, descriptor: p.label })),
    artDirection,
  };
  return { ...body, key: frameKey(body) };
}

/** One scene request for a known Location, from the Map's public facts. */
export function buildBatchRequest(
  loc: { readonly name: string; readonly type: string; readonly crowd: string },
  context: { readonly phase: string; readonly weather: string; readonly artDirection: string },
): FrameRequest {
  const body: Omit<FrameRequest, 'key'> = {
    kind: 'scene',
    location: { name: loc.name, type: loc.type, description: '', atmosphere: [] },
    phase: context.phase,
    crowd: loc.crowd,
    weather: context.weather,
    visible: [],
    artDirection: context.artDirection,
  };
  return { ...body, key: frameKey(body) };
}
