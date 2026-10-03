/**
 * The game-over slice of the TUI (task 22.10): the Ink game-over screen that
 * states the outcome (success, Plot failure or burned), the end day and phase
 * and the cause, and offers the debrief, save and quit options (design, "TUI":
 * the game-over screen; Requirements 13.7, 19.4, 19.5), plus the pure outcome
 * classification and menu-selection reducer behind it.
 */

export {
  GameOverScreen,
  type GameOverScreenProps,
} from './game-over-screen.js';

export {
  GAME_OVER_OPTIONS,
  GAME_OVER_OPTION_LABELS,
  classifyOutcome,
  initialGameOverState,
  outcomeHeadline,
  reduceGameOver,
  selectedOption,
  type GameOverAction,
  type GameOverOption,
  type GameOverState,
  type OutcomeKind,
} from './game-over.js';
