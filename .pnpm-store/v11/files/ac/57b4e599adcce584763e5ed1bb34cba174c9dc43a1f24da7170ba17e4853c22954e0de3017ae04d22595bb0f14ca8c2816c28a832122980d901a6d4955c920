import { type CreateNodes, type ExpandedPluginConfiguration, type ProjectGraphProjectNode, type Tree, logger as devkitLogger } from 'nx/src/devkit-exports';
import type { ResidualByProject } from './executor-to-plugin-migrator';
/**
 * The evidence one deferred engine invocation stages for the batch finalize
 * pass. Everything is captured by value at staging time (see `stagePlan`)
 * because later children in the batch keep mutating the Tree and their own
 * caches; the only live references kept are the plugin's `createNodes`
 * functions, which the finalize verification pass needs to run.
 */
export interface DeferredConversionPlan {
    pluginPath: string;
    createNodes: CreateNodes | undefined;
    createNodesV2: CreateNodes | undefined;
    logger: typeof devkitLogger | undefined;
    /**
     * Whether the plugin was registered in nx.json before this conversion wrote
     * its registrations. Gates dead executor-keyed target-default cleanup, as in
     * the inline engine path.
     */
    pluginPreRegistered: boolean;
    /** Per-(project, target) residuals + equivalence-oracle baselines (Phase 2). */
    residualByProject: ResidualByProject;
    /** project name -> project root for every migrated project. */
    rootByProject: Map<string, string>;
    /**
     * project name -> pre-migration graph node for every migrated project. The
     * finalize target-default preflight resolves `filter.projects` entries
     * through the production reader, which matches against the project's node.
     */
    graphNodeByProject: Map<string, ProjectGraphProjectNode>;
    /**
     * Every project root in the pre-migration graph. With the plans' Phase 1
     * inferred roots, these are the known owners the finalize pass attributes
     * errored config files to (closest root wins).
     */
    graphRoots: Set<string>;
    /**
     * `"<project>\t<target>"` -> the effective executor the pair resolves to
     * after migration (the inferred target's; a `command` resolves to
     * `nx:run-commands`). Input to the finalize target-default preflight.
     */
    inferredExecutorByPair: Map<string, string | undefined>;
    /** Every effective executor the plugin's Phase 1 inference emitted. */
    inferredExecutors: Set<string>;
    /** Every root the plugin's Phase 1 inference produced a project for. */
    inferredRoots: Set<string>;
    /** Config files matched by the plugin's glob and owned by an inferred root. */
    matchedConfigFiles: string[];
    /** Config files the Phase 1 inference could not load. */
    erroredConfigFiles: string[];
    /** The migrated executors (Phase 0 scope): dead-default cleanup candidates. */
    migratedExecutors: string[];
    /**
     * `"<project>\t<target>"` -> executor from the pre-migration project graph.
     * Feeds the batch-global liveness scan: a pair no plan migrated still
     * resolves its graph executor, keeping that executor's defaults live.
     */
    graphExecutorByPair: Map<string, string>;
}
/**
 * One child generator run inside the batch: the `nx.json` `plugins` snapshots
 * around it and the plans its engine invocations staged. A registration delta
 * that no staged plan's plugin accounts for is an opaque barrier for the
 * finalize planner (e.g. a converter that bypasses the engine entirely, or
 * registers an unrelated plugin).
 */
export interface BatchChildRecord {
    pluginsBefore: (string | ExpandedPluginConfiguration)[];
    pluginsAfter: (string | ExpandedPluginConfiguration)[];
    plans: DeferredConversionPlan[];
}
/** The engine-facing slice of the session: stage a plan for the running child. */
export interface BatchConversionStaging {
    stagePlan(plan: DeferredConversionPlan): void;
}
/**
 * A batch of convert-to-inferred generator runs against one Tree
 * (`infer-targets` with several plugins selected). While a child runs inside
 * `runChild`, the engine defers centralization: it writes full residuals,
 * skips the hoist / dead-default cleanup / verification pass, and stages a
 * {@link DeferredConversionPlan} here instead. The staged evidence is committed
 * only when the child generator resolves, so a failed child contributes
 * nothing. A finalize pass consumes the committed records after the batch loop.
 *
 * Open with {@link openBatchConversionSession} and always `close()` in a
 * `finally` so the Tree's engine invocations return to the inline path.
 */
export declare class BatchConversionSession {
    private readonly tree;
    private readonly children;
    private pendingPlans;
    private closed;
    constructor(tree: Tree);
    /** The committed child records, in batch order. */
    get records(): readonly BatchChildRecord[];
    /**
     * Run one child generator with deferred centralization. Commits the plans
     * its engine invocations staged only when `fn` resolves; a rejection (a
     * failed child, or `NoTargetsToMigrateError`) discards them.
     */
    runChild<T>(fn: () => T | Promise<T>): Promise<T>;
    /**
     * Stage a deferred plan for the running child (engine-facing; reach it via
     * {@link getActiveBatchStaging}). Clones every mutable structure so the
     * staged evidence is immune to later Tree/cache mutations; the `createNodes`
     * references are kept live for the finalize verification pass.
     */
    stagePlan(plan: DeferredConversionPlan): void;
    private hasRunningChild;
    /**
     * End the session: engine invocations on the Tree return to the inline path.
     * Rejected while a child is running; otherwise a still-running child would
     * fall back to inline centralization mid-batch, or stage its plan into a
     * session opened after this one. `runChild` always settles its child before
     * returning or throwing, so a `finally { session.close() }` never hits this.
     */
    close(): void;
    /** @internal module-level accessor for {@link getActiveBatchStaging}. */
    static activeStagingFor(tree: Tree): BatchConversionStaging | undefined;
}
/**
 * Open a batch conversion session for `tree`. Throws when one is already open:
 * sessions do not nest (each child in a batch must observe the same session).
 */
export declare function openBatchConversionSession(tree: Tree): BatchConversionSession;
/**
 * The staging handle for `tree`, or `undefined` when no batch child is
 * currently running (no session, or the session is between children). The
 * engine checks this to decide between the inline path and deferred staging.
 */
export declare function getActiveBatchStaging(tree: Tree): BatchConversionStaging | undefined;
