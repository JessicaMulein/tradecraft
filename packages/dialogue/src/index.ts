export * from './lib/dialogue.js';
export * from './lib/knowledge-slicer/knowledge-slicer.js';
// The NPC Prompt Builder (`buildPrompt`) and its input types, exported so the
// live voice seam and the Composition Root can assemble an NPC's chat prompt
// (slice-integration Req 16.1).
export * from './lib/prompt-builder/prompt-builder.js';
export * from './lib/leak-guard/leak-guard.js';
export * from './lib/specifics-guard/specifics-guard.js';
export * from './lib/narrator/index.js';
export * from './lib/refusal-guard/refusal-guard.js';
// The Intent vocabulary and `applyIntent` live in the engine
// (`recruit/intent.ts`) so the Turn Pipeline can apply an Intent on the Draft
// without importing dialogue. They are re-exported here unchanged.
// `SCENE_KINDS`/`SceneKind` reach this barrel through the routing module.
export {
  INTENTS,
  INTENT_DELTAS,
  applyIntent,
  isIntent,
  type Intent,
} from '@tradecraft/engine';
export * from './lib/intent/classifier.js';
export * from './lib/routing/routing.js';
export * from './lib/extract/index.js';
export * from './lib/live/live-seams.js';
