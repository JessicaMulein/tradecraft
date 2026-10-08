/**
 * Plot generation for Template Schema v2 (plot-library).
 *
 * The slice generator (`generatePlot`) stays the path for schema-1 templates,
 * so a core-only game keeps its draws. These functions are the selector,
 * binder, expander and instantiator the library pack and the Plot Lab use.
 */

export { libraryPreset, type LibraryPreset, type PresetSource } from './preset.js';
export { accumulatedDeadlineDays, scopeStageRequires, worstCaseDeadlineDay, type DeadlineStage } from './deadlines.js';
export { bind, bindable, type BindCity, type BindingResult } from './bind.js';
export {
  expand,
  expandedStageIds,
  expansionWellFormed,
  variantKey,
  type ExpandedPlot,
  type ExpandedStage,
} from './expand.js';
export {
  DEFAULT_PLOT_SELECTION,
  historyHash,
  select,
  type PlotSelectionConfig,
  type SelectionInput,
  type SelectionResult,
  type TemplateHistory,
  type TemplateHistoryEntry,
} from './select.js';
export { instantiate, type InstantiatedPlot, type InstantiateWorld } from './instantiate.js';
export {
  advanceLibrary,
  bindCityFromView,
  branchConfigurations,
  buildLibrarySession,
  contingentBelief,
  identifyReport,
  projectLibraryFacts,
  verifyLibrary,
  type LibraryBuildInput,
  type LibraryFactSource,
  type LibraryFacts,
  type LibrarySession,
  type VerifyFailure,
} from './library.js';
export { type LibrarySelection, type PlotStateV2 } from './types.js';
export {
  rerouteAlternative,
  resolveBranch,
  type BranchWorld,
  type RuntimeBranch,
} from './branches.js';
export { countsTowardAbort, evaluateOutcomes, type OutcomeFacts, type OutcomePlot } from './outcomes.js';
export {
  checkConsistency,
  reschedule,
  type Conflict,
  type ConsistencyFact,
  type ScheduleEntry,
} from './consistency.js';
export {
  instantiateSideThread,
  lookalikeCount,
  type SideThreadResult,
  type SideThreadSpawn,
  type SideThreadState,
} from './sidethread.js';

/** Select-stream base. Reselection k uses derive(derive(seed, SELECT_STREAM), k). */
export const SELECT_STREAM = 0x31000;
