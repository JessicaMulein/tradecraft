/**
 * Readable day-and-phase formatting for the TUI (design, "TUI": the status bar
 * shows "day and phase"; the scene header shows the time).
 *
 * The engine stores a {@link GameTime} phase as an ordinal `0 | 1 | 2 | 3`;
 * the player reads it as a phase *name*. The engine owns the canonical mapping
 * (`PHASE_NAMES`/`phaseName`), but the TUI may import only `@tradecraft/player-
 * view` (the `tui-imports-only-player-view` dependency rule, Req 13.5), and the
 * facade does not re-export the phase helpers. So the four phase names are
 * mirrored here as a tiny local lookup, matching the engine's order exactly.
 */

/**
 * The game-time shape the TUI renders: a day and a phase ordinal. This mirrors
 * the engine's `GameTime` structurally; the view-safe `SceneView.time` and
 * `StatusView.time` are assignable to it. It is declared locally rather than
 * imported because the player-view facade does not re-export `GameTime` (and
 * the TUI may not reach into the engine, Req 13.5).
 */
export interface TimeLike {
  readonly day: number;
  readonly phase: number;
}

/**
 * The four phase names in ordinal order, mirroring the engine's `PHASE_NAMES`
 * (`0` morning, `1` afternoon, `2` evening, `3` night). Kept local to the TUI
 * because the player-view facade does not re-export the engine helper.
 */
export const PHASE_NAMES = ['morning', 'afternoon', 'evening', 'night'] as const;

/** The player-facing name of a phase ordinal, or a numeric fallback. */
export function phaseName(phase: number): string {
  return PHASE_NAMES[phase] ?? `phase ${phase}`;
}

/** Render a {@link TimeLike} as the plain `Day N, <phase>` form the player reads. */
export function formatTime(time: TimeLike): string {
  return `Day ${time.day}, ${phaseName(time.phase)}`;
}
