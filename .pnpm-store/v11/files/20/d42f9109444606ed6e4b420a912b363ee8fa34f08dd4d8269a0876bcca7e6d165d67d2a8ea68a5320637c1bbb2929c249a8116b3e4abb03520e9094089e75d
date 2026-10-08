import { type NxJsonConfiguration } from '../config/nx-json';
import type { ProjectGraph } from '../config/project-graph';
import type { HashInputs } from '../native';
/**
 * A project graph the caller has already built. `nx show target` resolves one to
 * find the target in the first place, and `createProjectGraphAsync` is not
 * memoized, so without this the CLI would build the graph a second time.
 */
export interface TaskFileCheckSeed {
    projectGraph: ProjectGraph;
    nxJson: NxJsonConfiguration;
}
/** The rule that made a value an input for a task. */
export type InputCategory = 'files' | 'depOutputs' | 'dependentTasksOutputFiles' | 'runtime' | 'environment' | 'external';
export interface InputCandidate {
    /** The value as supplied — matched verbatim against environment/runtime/external. */
    value: string;
    /** Workspace-relative path form of `value` — matched against the path categories. */
    path: string;
}
/**
 * Check which values are legitimate inputs for the given task. A value matches
 * when it is:
 *   - a declared environment variable, runtime input, or external dependency;
 *   - a file in the task's declared input file list;
 *   - a file in the task's materialized `depOutputs` (upstream has run);
 *   - a file matching a `dependentTasksOutputFiles` glob declared on the task
 *     that lies inside the declared outputs of an upstream task in the task
 *     graph (static — works even when upstream tasks have not yet run).
 *
 * `categories` records the rule each matched value satisfied. Paths may be
 * workspace-relative or absolute; absolute ones are relativized against the
 * workspace root, and a path outside the workspace simply matches nothing. A
 * caller resolving paths against a cwd passes an {@link InputCandidate} so that
 * names are still matched verbatim.
 */
export declare function checkFilesAreInputs(taskId: string, files: Array<string | InputCandidate>): Promise<{
    matched: string[];
    unmatched: string[];
    categories: Map<string, InputCategory>;
}>;
/**
 * Check which files match the output globs declared for the given task.
 * Uses the same path-matching logic as the task runner (directory containment
 * + glob matching through the native `globset` engine), including negated
 * (`!`-prefixed) patterns acting as exclusions over the whole pattern set.
 *
 * Paths may be workspace-relative or absolute; absolute ones are relativized
 * against the workspace root. An output pattern whose `{options.*}` token has no
 * value resolves to nothing — exactly as the task runner drops it — so a file it
 * would have covered is reported `unmatched`, like any other non-output.
 *
 * That last case makes `unmatched` two answers in one: "not an output" and
 * "the outputs could not be determined". A consumer judging sandbox violations
 * cannot tell them apart, and would call the second one illegal. `getTaskOutputs`
 * already computes the `unresolved` list this would need; surfacing it here is
 * deliberately deferred until a consumer's contract asks for the distinction.
 */
export declare function checkFilesAreOutputs(taskId: string, files: string[]): Promise<{
    matched: string[];
    unmatched: string[];
}>;
/**
 * Returns the full hash inputs for a task (files + runtime + env + depOutputs
 * + external). Used internally by the `nx show target --inputs` renderer.
 */
export declare function getTaskRawInputs(taskId: string, seed?: TaskFileCheckSeed): Promise<HashInputs | null>;
export interface TaskOutputs {
    /** Output patterns after token substitution — what the task runner will cache. */
    resolved: string[];
    /** `resolved`, expanded against the files currently on disk. */
    expanded: string[];
    /** Configured outputs left out of `resolved` because an option had no value. */
    unresolved: string[];
}
/**
 * Returns the outputs declared for a task, resolved against its effective
 * configuration. Used internally by the `nx show target --outputs` renderer.
 */
export declare function getTaskOutputs(taskId: string, seed?: TaskFileCheckSeed): Promise<TaskOutputs>;
/**
 * Resets all module-level caches. Call this in `beforeEach` when testing so
 * each test gets a fresh context load. Not part of the public API.
 * @internal
 */
export declare function _resetContextForTesting(): void;
