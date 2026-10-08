import type { ProjectConfiguration } from 'nx/src/config/workspace-json-project-json';
import { type CreateNodes, type ExpandedPluginConfiguration, type NxJsonConfiguration, type ProjectGraph, type ProjectGraphProjectNode, type TargetConfiguration, type TargetDefaultArrayEntry, type Tree, logger as devkitLogger } from 'nx/src/devkit-exports';
import { ProjectConfigurationsError } from 'nx/src/devkit-internals';
import { type PackageJsonIdentitySource } from './conversion-warnings';
export type InferredTargetConfiguration = TargetConfiguration & {
    name: string;
};
type PostTargetTransformer = (targetConfiguration: TargetConfiguration, tree: Tree, projectDetails: {
    projectName: string;
    root: string;
}, inferredTargetConfiguration: InferredTargetConfiguration) => TargetConfiguration | Promise<TargetConfiguration>;
type SkipTargetFilter = (targetOptions: Record<string, unknown>, projectConfiguration: ProjectConfiguration) => false | string;
type SkipProjectFilter = (projectConfiguration: ProjectConfiguration) => false | string;
type MigrationDefinition<T> = {
    executors: string[];
    targetPluginOptionMapper: (targetName: string) => Partial<T>;
    postTargetTransformer: PostTargetTransformer;
    skipProjectFilter?: SkipProjectFilter;
    skipTargetFilter?: SkipTargetFilter;
    /**
     * Let several targets of a project map different target names through the
     * same plugin option (last write wins) instead of keeping the later targets
     * executor-based. Only for migrations that reconcile the resulting
     * registration afterwards, like the detox one.
     */
    allowSharedOptionOverwrite?: boolean;
};
/**
 * A distinct plugin-option set used to infer targets (Phase 1). `options` is the
 * value passed to the plugin's `createNodes` (i.e. `targetPluginOptionMapper`'s
 * output) and `targetNames` are the migrated target names that option set is
 * responsible for producing.
 */
interface InferenceOptionSet<T> {
    /** Stable id used to keep inference results isolated by option set. */
    id: number;
    /**
     * The object handed to the plugin's `createNodes`: the raw
     * `targetPluginOptionMapper` output. The engine never merges its own
     * `defaultPluginOptions` into it (that is why `derivePluginFilledDefaults`
     * skips keys already in the defaults). NOTE: the plugin itself may mutate this
     * object in place during Phase 1 (e.g. `options.devTargetName ??= 'dev'`);
     * `derivePluginFilledDefaults` relies on exactly that mutation, so after
     * Phase 1 this can carry the plugin's own fills too.
     */
    options: Partial<T>;
    targetNames: Set<string>;
    /**
     * Roots of the projects migrated under this option set. Phase 1 retains
     * cloned inferred targets only for these roots (Phase 2 reads no others), so
     * retention scales with the migrated projects instead of every inferred root
     * times every option set.
     */
    migratedRoots: Set<string>;
}
interface ExecutorScope<T> {
    executor: string;
    migration: MigrationDefinition<T>;
    targetAndProjects: Map<string, Set<string>>;
    inferenceOptionSetIdsByTarget: Map<string, number>;
}
/**
 * The result of Phase 0 (Collect). Built by folding `forEachExecutorOptions`
 * over every migration/executor into one scope object, replacing the
 * per-executor scope derivation the migrator used to do internally.
 */
export interface MigrationScope<T> {
    /** project -> resolved plugin registration options (defaults + mappers) */
    pluginOptionsByProject: Map<string, T>;
    /** distinct inference option sets paired with the target names they infer */
    optionSetGroups: InferenceOptionSet<T>[];
    /** per (migration, executor) slice used to drive residual computation */
    executorScopes: ExecutorScope<T>[];
}
export declare function stableStringify(value: unknown): string;
/**
 * Phase 0: Collect (once). Fold `forEachExecutorOptions` over every
 * migration/executor into a single scope object, applying the skip filters with
 * the exact same warn-vs-throw semantics the migrator used before (a
 * `specificProjectToMigrate` skip throws instead of warning). This is the single
 * authority for filtering; downstream phases only read the returned maps.
 */
export declare function collectMigrationScope<T>(tree: Tree, projectGraph: ProjectGraph, migrations: MigrationDefinition<T>[], defaultPluginOptions: T, specificProjectToMigrate?: string, logger?: typeof devkitLogger): MigrationScope<T>;
/** The per-project residual and the equivalence oracle baseline for a target. */
export interface ResidualEntry {
    /** Byte-for-byte what the previous engine writes into project.json. */
    residual: TargetConfiguration;
    /**
     * The migrated (command-based) effective config the previous engine yields:
     * the full inferred target with the residual layered on top. Used in Phase 4
     * as the equivalence oracle.
     */
    baselineFinal: TargetConfiguration;
    /**
     * The explicit target as authored before the migration. Restored when
     * package.json turns out to author the target's identity (see
     * `writeResidualTarget`, and the batch finalize for identities that appear
     * after the write).
     */
    preMigrationTarget: TargetConfiguration;
    /**
     * Set by the write phase when the pre-migration target was kept untouched
     * (see `writeResidualTarget`); the verification phase then leaves it alone.
     */
    keptPreMigration?: boolean;
}
/** project name -> (target name -> residual entry) */
export type ResidualByProject = Map<string, Map<string, ResidualEntry>>;
export type InferredTargetsByRoot = Map<string, Map<string, TargetConfiguration>>;
export type InferredTargetsByOptionSet = Map<number, InferredTargetsByRoot>;
/**
 * Phase 2: Per-project residual (in-memory, no inference). For each
 * `(project, target)` computes the residual exactly as the previous engine did
 * (`mergeTargetConfigurations` with the executor target defaults ->
 * `deleteMatchingProperties` -> input merge -> the plugin's
 * `postTargetTransformer`), plus `baselineFinal = merge(residual, inferred)` as
 * the equivalence oracle. Does NOT write project.json.
 */
export declare function computeResidualByProject<T>(tree: Tree, projectGraph: ProjectGraph, scope: MigrationScope<T>, inferredTargetsByOptionSet: InferredTargetsByOptionSet, nxJson: NxJsonConfiguration, projectConfigsByName?: Map<string, ProjectConfiguration>): Promise<ResidualByProject>;
/**
 * Phase 3: the strict-common residual across ALL migrated projects for a
 * target: the values that are deep-equal across every project's residual.
 * Granularity: whole value for top-level target props (`inputs`, `outputs`,
 * `cache`, `dependsOn`, `configurations`, ...); per-key for `options`. A key is
 * common only when EVERY residual carries it with an identical value.
 */
export declare function computeStrictCommon(residuals: TargetConfiguration[]): TargetConfiguration;
/** `residual` with every property that the strict-common config carries removed. */
export declare function subtractCommon(residual: TargetConfiguration, common: TargetConfiguration): TargetConfiguration;
/**
 * Remove the now-dead executor-keyed target default that Phase 2 inlined into
 * every migrated project (mirrors `readTargetDefaultsForExecutor`'s match: the
 * unfiltered entry keyed directly by the executor string).
 */
export declare function removeDeadExecutorTargetDefault(nxJson: NxJsonConfiguration, executor: string): void;
/**
 * Append the hoisted common as a plugin-scoped entry after whatever value the
 * key already holds. Existing entries, the workspace catch-all and any
 * user-authored filtered entries, are never modified, so targets outside this
 * plugin resolve exactly what they resolved before the migration. The entry is
 * appended (never merged into an existing one) so the verification pass can
 * revert precisely this entry and nothing else.
 */
export declare function appendPluginScopedTargetDefault(nxJson: NxJsonConfiguration, targetName: string, pluginPath: string, common: TargetConfiguration): TargetDefaultArrayEntry;
/**
 * Remove a previously appended plugin-scoped entry, collapsing the value back
 * to the plain object form when only a lone unfiltered entry remains. The
 * appended entry survives an `updateNxJson`/`readNxJson` round trip only by
 * value, so the last deep-equal occurrence (append order puts ours last) is
 * the one removed.
 */
export declare function removeHoistedTargetDefault(nxJson: NxJsonConfiguration, targetName: string, entry: TargetDefaultArrayEntry): void;
/**
 * Which `package.json` signal, if any, authors an identity for `targetName` in
 * the DEFAULT plugin layer. The package-json plugin turns every included script into
 * an `nx:run-script` target and honors `nx.targets`; either way the target gains
 * an `executor`/`command` in a default layer, which makes Nx's
 * `resolveSourcePlugin` refuse a `filter: { plugin }` targetDefault for it.
 * The hoist uses this to keep the full residual per project instead of silently
 * dropping the centralized keys; the residual write uses it to keep the
 * pre-migration target instead of letting the package.json identity take the
 * target over.
 *
 * Read through the Tree so this sees the same in-memory package.json the rest of
 * the generator reads and writes, rather than a possibly-stale copy on disk.
 */
export declare function packageJsonAuthorsTargetIdentity(tree: Tree, root: string | undefined, targetName: string): PackageJsonIdentitySource | undefined;
export declare function isRegistrationOfPlugin(registration: string | ExpandedPluginConfiguration, pluginPath: string): boolean;
/**
 * Whether appending the plugin-scoped `targetDefaults[targetName]` entry would
 * change what the existing target defaults resolve to for any eligible migrated
 * pair. Two hazards, both invisible to the Phase 4 verification (it merges no
 * target defaults):
 *
 * - Key displacement: an exact target-name key takes precedence over a glob
 *   key (`build-*`), so appending one can silently stop a glob default from
 *   contributing to the migrated targets.
 * - Executor masking: an executor-keyed default for the plugin's INFERRED
 *   executor (e.g. `nx:run-commands` for command-based inferred targets) takes
 *   precedence over the exact key, so the appended entry would never resolve
 *   and its keys would be silently dropped.
 *
 * The check resolves the defaults for each pair without and with the
 * hypothetical entry, through the production reader. The hoist is a pure
 * "residual moved into a default" only when the with-entry resolution equals
 * the without-entry resolution with the common merged on top; anything else
 * changes behavior, so the target keeps its full residuals.
 */
export declare function hoistChangesExistingTargetDefaults(targetDefaults: NxJsonConfiguration['targetDefaults'], targetName: string, common: TargetConfiguration, pluginPath: string, eligiblePairs: {
    projectName: string;
    inferredExecutor: string | undefined;
}[], projectNodesByName: Record<string, ProjectGraphProjectNode>): boolean;
export declare class NoTargetsToMigrateError extends Error {
    constructor();
}
export declare function readTargetDefaultsForExecutor(executor: string, targetDefaults: NxJsonConfiguration['targetDefaults'] | undefined): Partial<TargetConfiguration> | undefined;
export declare function migrateProjectExecutorsToPlugin<T>(tree: Tree, projectGraph: ProjectGraph, pluginPath: string, createNodesV2: CreateNodes<T>, defaultPluginOptions: T, migrations: Array<{
    executors: string[];
    targetPluginOptionMapper: (targetName: string) => Partial<T>;
    postTargetTransformer: PostTargetTransformer;
    skipProjectFilter?: SkipProjectFilter;
    skipTargetFilter?: SkipTargetFilter;
    allowSharedOptionOverwrite?: boolean;
}>, specificProjectToMigrate?: string, logger?: typeof devkitLogger): Promise<Map<string, Record<string, string>>>;
export declare function migrateProjectExecutorsToPluginV1<T>(tree: Tree, projectGraph: ProjectGraph, pluginPath: string, createNodes: CreateNodes<T>, defaultPluginOptions: T, migrations: Array<{
    executors: string[];
    targetPluginOptionMapper: (targetName: string) => Partial<T>;
    postTargetTransformer: PostTargetTransformer;
    skipProjectFilter?: SkipProjectFilter;
    skipTargetFilter?: SkipTargetFilter;
    allowSharedOptionOverwrite?: boolean;
}>, specificProjectToMigrate?: string): Promise<Map<string, Record<string, string>>>;
/**
 * Phase 1: Infer (once per distinct option set). Runs a whole-workspace
 * inference per distinct plugin-option set (usually one) instead of once per
 * target and once per project. Builds `inferredTargetsByOptionSet` (option set
 * id -> project root -> target name -> FULL inferred target; residual
 * computation strips `command` / `options.cwd` at the point of use), which
 * Phase 2 (`computeResidualByProject`) reads to compute residuals and
 * `baselineFinal`; plus the matched config files owned by an inferred project
 * root, which Phase 3's registration step reads for analytic include coverage.
 */
export declare function inferOncePerOptionSet<T>(tree: Tree, pluginPath: string, createNodes: CreateNodes<T> | undefined, createNodesV2: CreateNodes<T> | undefined, nxJson: NxJsonConfiguration, scope: MigrationScope<T>): Promise<{
    inferredTargetsByOptionSet: InferredTargetsByOptionSet;
    matchedConfigFiles: string[];
    erroredConfigFiles: string[];
    rawMatchedConfigFiles: string[];
    inferredExecutors: Set<string>;
    inferredRoots: Set<string>;
}>;
/**
 * The set of project roots a generated `include` list scopes to, or `undefined`
 * if any entry is not one of the two shapes this generator emits: `*` (the root
 * project) or a literal root followed by a trailing globstar segment (a nested
 * root). A user-authored include or any `exclude` falls back to the glob engine.
 *
 * The globstar branch only qualifies when the root prefix is a LITERAL path.
 * A prefix carrying glob metacharacters (a wildcard, brace, or extglob segment
 * before the trailing globstar) is not a shape this generator emits and can't be
 * reduced to root ownership by string equality, so it falls back to the glob
 * engine.
 */
export declare function generatedIncludeRoots(include: string[]): Set<string> | undefined;
/** One harvested verification error, attributable to a plugin registration. */
export interface HarvestedConfigurationError {
    message: string;
    /** The config files the error names (empty for a file-less error). */
    files: string[];
    /**
     * The `nx.json` `plugins` index of the registration that produced the error,
     * when the plugins were constructed with one (the batch finalize pass does);
     * `undefined` otherwise.
     */
    pluginIndex: number | undefined;
}
/**
 * Harvest the diagnostic messages and the errored config-file paths from a
 * `ProjectConfigurationsError`. `ProjectConfigurationsError.errors` is a closed
 * 5-member union; the two members that name a failing config file are
 * `AggregateCreateNodesError` (a `[file, error]` list) and `MergeNodesError` (a
 * single `.file`). `ProjectsWithNoNameError` / `MultipleProjectsWithSameNameError`
 * are artifacts of running with no `project.json` layer (nothing supplies names),
 * so they are dropped; `WorkspaceValidityError` carries no file and is exempt.
 */
export declare function harvestConfigurationErrors(e: ProjectConfigurationsError): {
    messages: string[];
    erroredConfigFiles: string[];
    entries: HarvestedConfigurationError[];
};
/**
 * Attribution map for errored-config ownership: every root the engine knows
 * owns a project, i.e. graph project roots plus the roots the plugin inference
 * produced (a project discovered from a config file alone has no graph node;
 * graph roots win a collision). Keys are normalized for the
 * `findProjectForPath` walk; values are the raw roots the per-target
 * migrated-root sets hold.
 */
export declare function buildOwnerRootByPath(graphRoots: Iterable<string>, inferredRoots: Iterable<string>): Map<string, string>;
export {};
