/**
 * The Case File slice of the TUI (task 22.4): the Ink Case File browser that
 * lists the player's Claims and lets them filter by entity, source and grade and
 * edit grades and links, and the pure reducer behind it that owns the selection,
 * the active filter, the grade cursor and the link anchor.
 */

export {
  CaseFileBrowser,
  type CaseFileBrowserProps,
} from './case-file-browser.js';

export {
  ADMIRALTY_CREDIBILITY,
  ADMIRALTY_RELIABILITY,
  CLAIM_SOURCE_KINDS,
  FILTER_AXES,
  formatGrade,
  initialCaseFileState,
  reduceCaseFile,
  type AdmiraltyGrade,
  type CaseFileAction,
  type CaseFileInit,
  type CaseFileState,
  type ClaimId,
  type ClaimSourceKind,
  type EntityId,
  type FilterAxis,
} from './case-file.js';
