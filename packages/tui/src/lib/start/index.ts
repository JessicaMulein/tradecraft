/**
 * The start-screen slice of the TUI (task 22.1): the Ink start screen that
 * gathers the new-game options and shows the brief Cable, the Cable/Document
 * reader it reuses, and the pure options reducer behind both.
 */

export {
  StartScreen,
  type StartScreenProps,
} from './start-screen.js';

export {
  CableReader,
  type CableReaderProps,
} from './cable-reader.js';

export {
  DIFFICULTY_PRESETS,
  START_FIELDS,
  initialStartState,
  reduceStart,
  toNewGameOptions,
  type DifficultyPresetId,
  type NewGameOptions,
  type StartAction,
  type StartField,
  type StartState,
} from './options.js';
