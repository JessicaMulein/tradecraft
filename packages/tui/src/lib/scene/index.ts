/**
 * The scene slice of the TUI (task 22.2): the Ink Scene pane and status bar that
 * render the current scene and the game's state, and the pure transcript reducer
 * behind the Scene pane that accumulates the turn's streamed {@link TurnChunk}s.
 */

export {
  ScenePane,
  type ScenePaneProps,
} from './scene-pane.js';

export {
  StatusBar,
  type StatusBarProps,
} from './status-bar.js';

export {
  collectTranscript,
  emptyTranscript,
  reduceTranscript,
  type TranscriptLine,
  type TranscriptPause,
  type TranscriptState,
} from './transcript.js';

export {
  PHASE_NAMES,
  formatTime,
  phaseName,
  type TimeLike,
} from './time.js';
