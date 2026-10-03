/**
 * The Workbench slice of the TUI (task 22.5; design, "TUI"; Requirements 9.5,
 * 9.6, 25.3): the Ink Workbench pane that renders one Intercept's metadata,
 * frequency table and caesar shift preview with a key/plaintext entry, and the
 * pure entry reducer behind it that holds the shift selection and composes the
 * {@link KeySubmission}.
 */

export {
  Workbench,
  type WorkbenchProps,
} from './workbench.js';

export {
  initialWorkbenchState,
  reduceWorkbench,
  buildKeySpec,
  buildSubmission,
  KEY_KINDS,
  type WorkbenchState,
  type WorkbenchAction,
  type EntryMode,
  type KeyKind,
} from './workbench-entry.js';
