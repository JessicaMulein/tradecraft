"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.BatchConversionSession = void 0;
exports.openBatchConversionSession = openBatchConversionSession;
exports.getActiveBatchStaging = getActiveBatchStaging;
const devkit_exports_1 = require("nx/src/devkit-exports");
// Keyed by Tree identity so a session cannot leak into another generator
// invocation. At most one session per Tree.
const activeSessions = new WeakMap();
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
class BatchConversionSession {
    constructor(tree) {
        this.tree = tree;
        this.children = [];
        this.closed = false;
    }
    /** The committed child records, in batch order. */
    get records() {
        return this.children;
    }
    /**
     * Run one child generator with deferred centralization. Commits the plans
     * its engine invocations staged only when `fn` resolves; a rejection (a
     * failed child, or `NoTargetsToMigrateError`) discards them.
     */
    async runChild(fn) {
        if (this.closed) {
            throw new Error('The convert-to-inferred batch session has been closed; open a new one to run more conversions.');
        }
        if (this.pendingPlans) {
            throw new Error('A convert-to-inferred batch child is already running; batch children must run sequentially.');
        }
        const pluginsBefore = structuredClone((0, devkit_exports_1.readNxJson)(this.tree)?.plugins ?? []);
        this.pendingPlans = [];
        try {
            const result = await fn();
            this.children.push({
                pluginsBefore,
                pluginsAfter: structuredClone((0, devkit_exports_1.readNxJson)(this.tree)?.plugins ?? []),
                plans: this.pendingPlans,
            });
            return result;
        }
        finally {
            this.pendingPlans = undefined;
        }
    }
    /**
     * Stage a deferred plan for the running child (engine-facing; reach it via
     * {@link getActiveBatchStaging}). Clones every mutable structure so the
     * staged evidence is immune to later Tree/cache mutations; the `createNodes`
     * references are kept live for the finalize verification pass.
     */
    stagePlan(plan) {
        if (!this.pendingPlans) {
            throw new Error('Cannot stage a conversion plan: no batch child is running.');
        }
        const residualByProject = new Map();
        for (const [projectName, targetMap] of plan.residualByProject) {
            const clonedTargetMap = new Map();
            for (const [targetName, entry] of targetMap) {
                clonedTargetMap.set(targetName, structuredClone(entry));
            }
            residualByProject.set(projectName, clonedTargetMap);
        }
        const graphNodeByProject = new Map();
        for (const [projectName, node] of plan.graphNodeByProject) {
            graphNodeByProject.set(projectName, structuredClone(node));
        }
        this.pendingPlans.push({
            ...plan,
            residualByProject,
            rootByProject: new Map(plan.rootByProject),
            graphNodeByProject,
            graphRoots: new Set(plan.graphRoots),
            inferredExecutorByPair: new Map(plan.inferredExecutorByPair),
            inferredExecutors: new Set(plan.inferredExecutors),
            inferredRoots: new Set(plan.inferredRoots),
            matchedConfigFiles: [...plan.matchedConfigFiles],
            erroredConfigFiles: [...plan.erroredConfigFiles],
            migratedExecutors: [...plan.migratedExecutors],
            graphExecutorByPair: new Map(plan.graphExecutorByPair),
        });
    }
    hasRunningChild() {
        return this.pendingPlans !== undefined;
    }
    /**
     * End the session: engine invocations on the Tree return to the inline path.
     * Rejected while a child is running; otherwise a still-running child would
     * fall back to inline centralization mid-batch, or stage its plan into a
     * session opened after this one. `runChild` always settles its child before
     * returning or throwing, so a `finally { session.close() }` never hits this.
     */
    close() {
        if (this.pendingPlans) {
            throw new Error('Cannot close the convert-to-inferred batch session while a child conversion is running.');
        }
        this.closed = true;
        if (activeSessions.get(this.tree) === this) {
            activeSessions.delete(this.tree);
        }
    }
    /** @internal module-level accessor for {@link getActiveBatchStaging}. */
    static activeStagingFor(tree) {
        const session = activeSessions.get(tree);
        return session?.hasRunningChild() ? session : undefined;
    }
}
exports.BatchConversionSession = BatchConversionSession;
/**
 * Open a batch conversion session for `tree`. Throws when one is already open:
 * sessions do not nest (each child in a batch must observe the same session).
 */
function openBatchConversionSession(tree) {
    if (activeSessions.has(tree)) {
        throw new Error('A convert-to-inferred batch session is already open for this Tree.');
    }
    const session = new BatchConversionSession(tree);
    activeSessions.set(tree, session);
    return session;
}
/**
 * The staging handle for `tree`, or `undefined` when no batch child is
 * currently running (no session, or the session is between children). The
 * engine checks this to decide between the inline path and deferred staging.
 */
function getActiveBatchStaging(tree) {
    return BatchConversionSession.activeStagingFor(tree);
}
