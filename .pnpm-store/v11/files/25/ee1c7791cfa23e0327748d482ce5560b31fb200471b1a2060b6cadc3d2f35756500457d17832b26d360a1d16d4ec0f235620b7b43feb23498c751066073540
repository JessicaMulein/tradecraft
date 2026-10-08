/** Project names matching `current`. */
export declare function getProjectNameCompletions(current: string): string[];
/** Projects that declare `targetName`, matching `current`. */
export declare function getProjectNamesWithTarget(current: string, targetName: string): string[];
/** Two-stage `project[:target]` — stage 1 emits `project:` (nospace), stage 2 emits `project:target`. */
export declare function completeProjectTarget(current: string): string[];
/** Generator completion. Stage 1 (`nx g <TAB>`) emits plugin names (with `:`)
 *  and bare generator names (for `nx g application`); stage 2 emits
 *  `plugin:generator`. */
export declare function completeGenerator(current: string): string[];
/** Plugin names matching `current` — installed npm plugins + workspace-local
 *  plugin projects, only those declaring a generator collection. */
export declare function getGeneratorPluginCompletions(current: string): string[];
/** Generator names in a single plugin, matching `current`. */
export declare function getGeneratorsForPlugin(pluginName: string, current: string): string[];
/** Unique target names across the workspace, matching `current`. */
export declare function getTargetNameCompletions(current: string): string[];
/** Target names for a single project, matching `current`. Falls back to
 *  workspace-wide if the project isn't in the graph — covers the
 *  `project:t<TAB>` case where the user is still typing the project name. */
export declare function getTargetNamesForProject(current: string, projectName: string): string[];
