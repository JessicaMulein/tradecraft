/**
 * The App Shell key map (design, "TUI: App Shell": the key table; Requirement
 * 19.3). This is the single, documented source of truth for the shell's global
 * keys: it drives the reducer's routing in `./shell.ts`, is listed verbatim by
 * the help overlay, and is documented in the README (design: "a constant
 * exported for the help overlay and documented in the README").
 *
 * Each binding pairs the key the player presses with the shell action it starts
 * and a human-readable description for the help overlay. Keeping the bindings as
 * data — rather than a `switch` buried in the component — is what lets the reducer
 * and the help overlay read the one list, so they can never drift (Req 19.3).
 *
 * The bindings that *start a turn* (none of the global navigation keys do; the
 * turn-starting keys are the scene-local `Enter`/`Esc`, handled by the scene) are
 * flagged `startsTurn` so the reducer can enforce the streaming input lock from
 * one place (Req 19.11): while a turn streams, every `startsTurn` binding is
 * ignored.
 */

/**
 * The shell actions a global key can request. These name *what the reducer does*,
 * not the Ink wiring:
 *
 * - `open-case-file`, `open-documents`, `open-workbench`, `open-journal`,
 *   `open-map`, `open-people` — route to the matching view screen (Req 19.3).
 * - `open-feed` — open the feed composer for the selected turned Asset.
 * - `save` / `load` — open the save or load screen.
 * - `toggle-help` — toggle the help overlay.
 * - `quit` — quit the game (the component confirms first).
 */
export type ShellKeyAction =
  | 'open-case-file'
  | 'open-documents'
  | 'open-workbench'
  | 'open-journal'
  | 'open-map'
  | 'open-city'
  | 'open-stories'
  | 'open-duties'
  | 'open-people'
  | 'open-region'
  | 'open-departures'
  | 'open-papers'
  | 'open-carriage'
  | 'open-feed'
  | 'save'
  | 'load'
  | 'toggle-help'
  | 'quit';

/** One entry in the {@link KEY_MAP}: a key, the action it starts, and its label. */
export interface KeyBinding {
  /** The key the player presses (a single character, as `ink`'s `input`). */
  readonly key: string;
  /** The shell action the key starts. */
  readonly action: ShellKeyAction;
  /** The player-facing description shown in the help overlay (Req 19.3). */
  readonly description: string;
}

/**
 * The documented global key map (design, "TUI: App Shell"; Req 19.3), in display
 * order. The scene-local `Enter` (open the action menu / submit a typed line)
 * and `Esc` (back to scene / `endScene` in a Talk Scene, Req 19.8) are handled by
 * the scene screen itself, so they are not global bindings here; this map is the
 * global navigation and command keys the shell owns on every screen.
 */
export const KEY_MAP: readonly KeyBinding[] = [
  { key: 'c', action: 'open-case-file', description: 'Case File' },
  { key: 'd', action: 'open-documents', description: 'Documents' },
  { key: 'w', action: 'open-workbench', description: 'Workbench' },
  { key: 'j', action: 'open-journal', description: 'Journal' },
  { key: 'm', action: 'open-map', description: 'Map' },
  { key: 'y', action: 'open-city', description: 'City' },
  { key: 'r', action: 'open-stories', description: 'Stories' },
  { key: 'k', action: 'open-duties', description: 'Cover duties' },
  { key: 'p', action: 'open-people', description: 'People' },
  { key: 'n', action: 'open-region', description: 'Region map' },
  { key: 'b', action: 'open-departures', description: 'Departures' },
  { key: 'a', action: 'open-papers', description: 'Papers' },
  { key: 't', action: 'open-carriage', description: 'Carriage' },
  { key: 'f', action: 'open-feed', description: 'Feed composer for the selected turned Asset' },
  { key: 's', action: 'save', description: 'Save' },
  { key: 'l', action: 'load', description: 'Load' },
  { key: '?', action: 'toggle-help', description: 'Help overlay' },
  { key: 'q', action: 'quit', description: 'Quit (confirms)' },
] as const;

/**
 * The {@link KEY_MAP} indexed by key, for O(1) lookup in the reducer. Built once
 * from the ordered list so the two can never disagree.
 */
export const KEY_BINDINGS: ReadonlyMap<string, KeyBinding> = new Map(
  KEY_MAP.map((binding) => [binding.key, binding]),
);

/** Look up the binding for a key, or `undefined` when the key is unbound. */
export function bindingFor(key: string): KeyBinding | undefined {
  return KEY_BINDINGS.get(key);
}
