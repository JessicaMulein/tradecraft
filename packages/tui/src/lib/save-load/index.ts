/**
 * The save-load slice of the TUI (task 22.12): the Ink Save/load screen that
 * lists the saves (`saves.list()`) with name, seed, Difficulty Preset and
 * day/phase, marks saves whose Content Manifest no longer matches the loaded
 * packs, and shows a mismatched save's `manifest-mismatch` pack list as a
 * read-only warning without changing the current game (design, "TUI" → the
 * Save/load screen; Requirements 13.9, 31.6), plus the pure cursor/selection
 * reducer and the manifest-load gate behind it.
 */

export {
  SaveLoadScreen,
  type SaveLoadScreenProps,
} from './save-load-screen.js';

export {
  canLoad,
  initialSaveListState,
  reduceSaveList,
  selectedSave,
  type PackDifference,
  type SaveListAction,
  type SaveListState,
} from './save-list.js';
