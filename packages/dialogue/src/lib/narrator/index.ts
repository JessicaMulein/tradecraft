/**
 * The Narrator (`dialogue/narrator`). It lives alongside the Specifics Guard in
 * the dialogue package. This barrel re-exports the pieces task 15.2 builds:
 *
 * - the scene descriptor and its projection from the Player View
 *   ({@link ./scene-descriptor.js}),
 * - the Narrator prompt builder ({@link ./prompt-builder.js}), and
 * - the narration streaming loop ({@link ./stream-narration.js}, task 15.3):
 *   Fact Lines first, then Flavour streamed through the Leak and Specifics
 *   guards, with the three narration modes and the fact-only fallback, and
 * - the Location Flavour cache ({@link ./flavour-cache.js}, task 15.4): arrival
 *   Flavour keyed by `(locId, phase, crowdBand)`, produced once and reused so a
 *   Location looks the same on repeat visits in the same phase and crowd band.
 */

export * from './scene-descriptor.js';
export * from './prompt-builder.js';
export * from './stream-narration.js';
export * from './flavour-cache.js';
