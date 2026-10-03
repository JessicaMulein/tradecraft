/**
 * The "here" slice of the TUI (task 22.3): the Ink Here pane that renders the
 * current Location, crowd, weather and visible persons (design, "TUI": "Here
 * (side)"; Requirements 21.7), the action menu that lists the Location's actions
 * with their quotes — allowed costs and disallowed reasons (Requirements 13.1,
 * 21.5) — and the pure selection reducer behind the menu.
 */

export {
  HerePane,
  type HerePaneProps,
} from './here-pane.js';

export {
  ActionMenu,
  type ActionMenuProps,
} from './action-menu.js';

export {
  initialMenuState,
  reduceMenu,
  type MenuAction,
  type MenuState,
} from './menu.js';
