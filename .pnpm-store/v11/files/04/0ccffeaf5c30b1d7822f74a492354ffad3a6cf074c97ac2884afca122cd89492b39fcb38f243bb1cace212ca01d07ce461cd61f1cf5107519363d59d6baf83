"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TaskOrchestrator = void 0;
exports.getThreadPoolSize = getThreadPoolSize;
const tslib_1 = require("tslib");
const events_1 = require("events");
const fs_1 = require("fs");
const path_1 = require("path");
const perf_hooks_1 = require("perf_hooks");
const pc = tslib_1.__importStar(require("picocolors"));
const project_graph_1 = require("../project-graph/project-graph");
const run_commands_impl_1 = require("../executors/run-commands/run-commands.impl");
const hash_task_1 = require("../hasher/hash-task");
const task_graph_utils_1 = require("./task-graph-utils");
const task_hasher_1 = require("../hasher/task-hasher");
const native_1 = require("../native");
const db_connection_1 = require("../utils/db-connection");
const exit_codes_1 = require("../utils/exit-codes");
const output_1 = require("../utils/output");
const params_1 = require("../utils/params");
const workspace_root_1 = require("../utils/workspace-root");
const cache_1 = require("./cache");
const forked_process_task_runner_1 = require("./forked-process-task-runner");
const is_tui_enabled_1 = require("./is-tui-enabled");
const pseudo_terminal_1 = require("./pseudo-terminal");
const noop_child_process_1 = require("./running-tasks/noop-child-process");
const output_prefix_1 = require("./running-tasks/output-prefix");
const shared_running_task_1 = require("./running-tasks/shared-running-task");
const task_env_1 = require("./task-env");
const tasks_schedule_1 = require("./tasks-schedule");
const utils_1 = require("./utils");
/**
 * Resolve a batch executor's per-task result to a TaskStatus. Prefers an
 * explicit `status` from the executor; falls back to the `success` boolean
 * for executors that pre-date the `status` field.
 */
function resolveBatchTaskStatus(result) {
    return result.status ?? (result.success ? 'success' : 'failure');
}
class TaskOrchestrator {
    // endregion internal state
    constructor(hasher, initiatingProject, initiatingTasks, projectGraph, taskGraph, nxJson, options, bail, daemon, outputStyle, fullTaskGraph = taskGraph) {
        this.hasher = hasher;
        this.initiatingProject = initiatingProject;
        this.initiatingTasks = initiatingTasks;
        this.projectGraph = projectGraph;
        this.taskGraph = taskGraph;
        this.nxJson = nxJson;
        this.options = options;
        this.bail = bail;
        this.daemon = daemon;
        this.outputStyle = outputStyle;
        this.fullTaskGraph = fullTaskGraph;
        this.taskDetails = (0, hash_task_1.getTaskDetails)();
        this.cache = (0, cache_1.getCache)(this.options);
        this.tuiEnabled = (0, is_tui_enabled_1.isTuiEnabled)();
        // Derived from projectGraph once — passed to getExecutorForTask /
        // getCustomHasher so they don't have to re-walk the graph per call.
        this.projects = (0, project_graph_1.readProjectsConfigurationFromProjectGraph)(this.projectGraph).projects;
        this.forkedProcessTaskRunner = new forked_process_task_runner_1.ForkedProcessTaskRunner(this.options, this.tuiEnabled);
        this.runningTasksService = !native_1.IS_WASM
            ? new native_1.RunningTasksService((0, db_connection_1.getLocalDbConnection)())
            : null;
        this.taskInvocationTracker = !native_1.IS_WASM
            ? new native_1.TaskInvocationTracker((0, db_connection_1.getLocalDbConnection)(), Number(process.env.NX_INVOCATION_ROOT_PID ?? process.pid))
            : null;
        // Tracks tasks registered by THIS process so that recursive code paths
        // (e.g. applyFromCacheOrRunBatch looping on incomplete batches) don't
        // re-register and trip the DB uniqueness constraint.
        this.registeredInvocations = new Set();
        this.tasksSchedule = new tasks_schedule_1.TasksSchedule(this.projectGraph, this.projects, this.taskGraph, this.options);
        // region internal state
        this.batchEnv = (0, task_env_1.getEnvVariablesForBatchProcess)(this.options.skipNxCache, this.options.captureStderr);
        this.reverseTaskDeps = (0, utils_1.calculateReverseDeps)(this.taskGraph);
        // `nx:noop` initiating tasks exit instantly via the fast-path in
        // `spawnProcess`. If we treat the noop itself as the keep-alive anchor for
        // its continuous dependencies, `cleanUpUnneededContinuousTasks` kills those
        // children the moment the noop finishes. Expand through noops so the
        // underlying real tasks become the anchors.
        this.initializingTaskIds = (0, utils_1.expandInitiatingTasksThroughNoop)(this.initiatingTasks, this.taskGraph, this.projectGraph);
        this.processedTasks = new Map();
        // Hashes confirmed absent from the cache this run. A confirmed miss can
        // only become a hit when the task itself runs — and then it leaves the
        // schedule — so a missed hash never needs re-querying. Without this, a
        // miss waiting for a worker slot is re-queried (including the remote
        // retrieval) on every coordinator cycle.
        this.cacheMissedHashes = new Set();
        this.completedTasks = new Map();
        this.waitingForTasks = [];
        this.pendingDiscreteWorkers = new Set();
        this.groups = [];
        this.continuousTasksStarted = 0;
        /**
         * How many folds each batch id has rendered. A batch that reports a strict
         * subset of its tasks is re-run under the same id, so one id can produce more
         * than one fold and the redirect lines have to point at the right one.
         */
        this.batchFoldRenders = new Map();
        this.bailed = false;
        this.resolveStopPromise = null;
        this.stopRequested = false;
        this.runningContinuousTasks = new Map();
        this.runningRunCommandsTasks = new Map();
        this.runningDiscreteTasks = new Map();
        this.discreteTaskExitHandled = new Map();
        this.continuousTaskExitHandled = new Map();
        this.cleanupPromise = null;
        this.signalHandlers = [];
    }
    async init() {
        this.setupSignalHandlers();
        this.taskInvocationTracker?.cleanupStale();
        // Init the ForkedProcessTaskRunner, TasksSchedule, and Cache
        await Promise.all([
            this.forkedProcessTaskRunner.init(),
            this.tasksSchedule.init().then(() => {
                return this.tasksSchedule.scheduleNextTasks();
            }),
            'init' in this.cache ? this.cache.init() : null,
        ]);
        // Pass estimated timings to TUI after TasksSchedule is initialized
        if (this.tuiEnabled) {
            const estimatedTimings = this.tasksSchedule.getEstimatedTaskTimings();
            this.options.lifeCycle.setEstimatedTaskTimings(estimatedTimings);
        }
    }
    async run() {
        await this.init();
        perf_hooks_1.performance.mark('task-execution:start');
        const { discrete, continuous, total } = getThreadPoolSize(this.options, this.taskGraph);
        process.stdout.setMaxListeners(total + events_1.defaultMaxListeners);
        process.stderr.setMaxListeners(total + events_1.defaultMaxListeners);
        process.setMaxListeners(total + events_1.defaultMaxListeners);
        const doNotSkipCache = this.options.skipNxCache === false ||
            this.options.skipNxCache === undefined;
        // Start continuous task loops (these run independently)
        const continuousLoops = [];
        for (let i = 0; i < continuous; ++i) {
            continuousLoops.push(this.executeContinuousTaskLoop(continuous));
        }
        // Set up forced shutdown handler
        const shutdownPromise = this.tuiEnabled
            ? new Promise((resolve) => {
                this.options.lifeCycle.registerForcedShutdownCallback(() => {
                    this.stopRequested = true;
                    resolve(undefined);
                });
            })
            : new Promise((resolve) => {
                this.resolveStopPromise = resolve;
            });
        const coordinatorLoop = this.executeCoordinatorLoop(doNotSkipCache, discrete);
        await Promise.race([
            Promise.all([coordinatorLoop, ...continuousLoops]),
            shutdownPromise,
        ]);
        perf_hooks_1.performance.mark('task-execution:end');
        perf_hooks_1.performance.measure('task-execution', 'task-execution:start', 'task-execution:end');
        if (!this.stopRequested) {
            this.cache.removeOldCacheRecords();
        }
        await this.cleanup();
        await this.dispose();
        // Public API (defaultTasksRunner) returns a plain object keyed by
        // task id. Internal state is a Map for faster lookup.
        return Object.fromEntries(this.completedTasks);
    }
    nextBatch() {
        return this.tasksSchedule.nextBatch();
    }
    /**
     * Coordinator loop. All batch operations (hashing, cache resolution)
     * happen on this single thread — no races. Cache misses are dispatched
     * as fire-and-forget workers. Workers signal completion via
     * scheduleNextTasksAndReleaseThreads which wakes all waiting loops.
     *
     * Safety: the dispatch phase (step 5) is fully synchronous — no
     * worker can run during it. So all tasks picked up by nextTask()
     * are guaranteed to be in processedTasks from step 1.
     */
    async executeCoordinatorLoop(doNotSkipCache, parallelism) {
        while (true) {
            if (this.bailed || this.stopRequested)
                break;
            // 1. Hash BEFORE processAll so processTask sees hashes set, and so
            //    resolveCachedTasksBulk can look them up in the cache. Each task
            //    is hashed with its own task-specific env (project/target .env
            //    files, custom hasher env reads) — the shared batchEnv would
            //    compute a different cache key than the single-task path and
            //    risk stale cache reuse after env changes.
            {
                const { scheduledTasks } = this.tasksSchedule.getAllScheduledTasks();
                const unhashed = scheduledTasks
                    .map((id) => this.taskGraph.tasks[id])
                    .filter((t) => !t.hash &&
                    this.taskGraph.dependencies[t.id].every((depId) => this.completedTasks.has(depId)));
                if (unhashed.length > 0) {
                    const perTaskEnvs = {};
                    for (const task of unhashed) {
                        perTaskEnvs[task.id] = (0, task_env_1.getTaskSpecificEnv)(task, this.projectGraph);
                    }
                    await (0, hash_task_1.hashTasks)(this.hasher, this.projectGraph, this.fullTaskGraph, perTaskEnvs, this.taskDetails, unhashed);
                }
            }
            // 2. Bulk-resolve cache hits before processTask — avoids N
            //    lifecycle calls for tasks that will be resolved from cache.
            if (doNotSkipCache) {
                const resolved = await this.resolveCachedTasksBulk();
                if (resolved)
                    continue;
            }
            // 3. Process remaining scheduled tasks (cache misses + non-cacheable).
            this.processAllScheduledTasks();
            // 4. Handle batch executors
            const batch = this.nextBatch();
            if (batch) {
                const groupId = this.closeGroup();
                await this.applyFromCacheOrRunBatch(doNotSkipCache, batch, groupId);
                this.openGroup(groupId);
                continue;
            }
            // 5. Dispatch cache misses as individual workers
            while (this.pendingDiscreteWorkers.size < parallelism) {
                const task = this.tasksSchedule.nextTask((t) => !t.continuous);
                if (!task)
                    break;
                const groupId = this.closeGroup();
                this.dispatchDiscreteWorker(doNotSkipCache, task, groupId);
            }
            // 6. Nothing left to dispatch and nothing in flight — done.
            if (!this.tasksSchedule.hasTasks() &&
                this.pendingDiscreteWorkers.size === 0) {
                break;
            }
            // 7. Wait for a worker to finish (woken by scheduleNextTasksAndReleaseThreads)
            await new Promise((res) => this.waitingForTasks.push(res));
        }
    }
    async executeContinuousTaskLoop(continuousTaskCount) {
        while (true) {
            // completed all the tasks
            if (!this.tasksSchedule.hasTasks() || this.bailed || this.stopRequested) {
                return null;
            }
            this.processAllScheduledTasks();
            const task = this.tasksSchedule.nextTask((t) => t.continuous);
            if (task) {
                // Use a separate groupId space (parallel..parallel+N) so continuous tasks
                // don't consume discrete group slots
                const groupId = this.options.parallel + this.continuousTasksStarted++;
                const runningTask = await this.startContinuousTask(task, groupId);
                if (this.initializingTaskIds.has(task.id)) {
                    await this.continuousTaskExitHandled.get(task.id);
                }
                // all continuous tasks have been started, thread can exit
                if (this.continuousTasksStarted >= continuousTaskCount) {
                    return null;
                }
                continue;
            }
            // all continuous tasks have been started, thread can exit
            if (this.continuousTasksStarted >= continuousTaskCount) {
                return null;
            }
            // block until some other task completes, then try again
            await new Promise((res) => this.waitingForTasks.push(res));
        }
    }
    // region Processing Scheduled Tasks
    async processTask(taskId) {
        const task = this.taskGraph.tasks[taskId];
        const taskSpecificEnv = (0, task_env_1.getTaskSpecificEnv)(task, this.projectGraph);
        if (!task.hash) {
            await (0, hash_task_1.hashTask)(this.hasher, this.projectGraph, this.fullTaskGraph, task, taskSpecificEnv, this.taskDetails);
        }
        await this.options.lifeCycle.scheduleTask(task);
        return taskSpecificEnv;
    }
    processAllScheduledTasks() {
        const { scheduledTasks } = this.tasksSchedule.getAllScheduledTasks();
        for (const taskId of scheduledTasks) {
            // Task is already handled or being handled
            if (!this.processedTasks.has(taskId)) {
                this.processedTasks.set(taskId, this.processTask(taskId));
            }
        }
    }
    /**
     * Registers a task invocation and checks for loops across nested Nx processes.
     * Uses the task_invocations DB table keyed by root PID. registerTask() throws
     * on unique constraint violation when a parent Nx process already registered
     * this task — indicating an infinite loop.
     */
    detectTaskInvocationLoop(task) {
        if (!this.taskInvocationTracker)
            return;
        if (this.registeredInvocations.has(task.id))
            return;
        try {
            this.taskInvocationTracker.registerTask(process.pid, task.id);
            this.registeredInvocations.add(task.id);
        }
        catch {
            // Unique constraint violation — task already invoked by an ancestor Nx process
            const chain = this.taskInvocationTracker.getInvocationChain();
            const chainDisplay = chain.map((r) => r.taskId).join(' -> ');
            output_1.output.error({
                title: 'Recursive task invocation detected',
                bodyLines: [
                    `Nx detected a recursive loop of task invocations:`,
                    ``,
                    `  ${chainDisplay} -> ${task.id}`,
                    ``,
                    `Task "${task.id}" was already invoked by a parent Nx process in this chain.`,
                    `This typically happens when a task's command (e.g., "nx ${task.target.target} ${task.target.project}")`,
                    `triggers a chain of tasks that eventually re-invokes itself.`,
                    ``,
                    `To fix this, review the command configuration for the tasks in the chain above.`,
                ],
            });
            process.exit(1);
        }
    }
    // endregion Processing Scheduled Tasks
    // region Applying Cache
    async applyCachedResults(tasks) {
        const cacheableTasks = tasks.filter((t) => t.cache);
        if (cacheableTasks.length === 0)
            return [];
        const cacheHits = await this.fetchCacheHits(cacheableTasks);
        if (cacheHits.length === 0)
            return [];
        return this.finalizeCacheHits(cacheHits);
    }
    /**
     * Batch cache lookup + filter to successful entries. Handles both
     * local (one rarray SQL call) and remote (parallel HTTP retrievals)
     * inside DbCache.getBatch.
     */
    async fetchCacheHits(tasks) {
        const tasksToQuery = tasks.filter((t) => t.hash && !this.cacheMissedHashes.has(t.hash));
        if (tasksToQuery.length === 0)
            return [];
        const batchResults = await this.cache.getBatch(tasksToQuery);
        const cacheHits = [];
        for (const task of tasksToQuery) {
            const cachedResult = batchResults.get(task.hash);
            // Replay a cached result only under the same condition it was cached
            // under (shouldCacheTaskResult): successes always, failures only when
            // NX_CACHE_FAILURES is enabled. Otherwise cached failures would be
            // written but never read back.
            if (cachedResult && this.shouldCacheTaskResult(task, cachedResult.code)) {
                cacheHits.push({ task, cachedResult });
            }
            else {
                this.cacheMissedHashes.add(task.hash);
            }
        }
        return cacheHits;
    }
    /**
     * For each confirmed cache hit: decide whether to copy outputs from
     * the cache (skipping if the on-disk outputs already match the
     * recorded hash), copy in parallel, derive the task status, print
     * terminal output, and return the assembled results.
     */
    async finalizeCacheHits(cacheHits) {
        // Batch-check which tasks need outputs copied from cache. Remote
        // cache entries come pre-restored to their output dirs when the
        // db cache is on, so we only check ones that aren't.
        const usingDbCache = (0, cache_1.dbCacheEnabled)();
        const tasksNeedingOutputCheck = cacheHits.filter(({ task, cachedResult }) => task.outputs.length > 0 && (!cachedResult.remote || !usingDbCache));
        const shouldCopyMap = await this.shouldCopyOutputsFromCacheBatch(tasksNeedingOutputCheck.map(({ task }) => ({
            outputs: task.outputs,
            hash: task.hash,
        })));
        // Copy outputs in parallel for tasks that need it.
        await Promise.all(cacheHits.map(async ({ task, cachedResult }) => {
            if (shouldCopyMap.get(task.hash)) {
                await this.cache.copyFilesFromCache(task.hash, cachedResult, task.outputs);
            }
        }));
        // Derive status, print terminal output, build results.
        const results = [];
        for (const { task, cachedResult } of cacheHits) {
            const shouldCopy = shouldCopyMap.get(task.hash) ?? false;
            // A cached failure (only replayed when NX_CACHE_FAILURES is enabled) is
            // reported as a plain failure so exit codes, run summaries, and the TUI
            // treat it as a failed run rather than a successful cache hit. Reporting
            // it as 'failure' also ensures its terminal output is always printed,
            // which the cache statuses suppress for non-initiating projects.
            const status = cachedResult.code !== 0
                ? 'failure'
                : cachedResult.remote
                    ? 'remote-cache'
                    : shouldCopy
                        ? 'local-cache'
                        : 'local-cache-kept-existing';
            this.options.lifeCycle.printTaskTerminalOutput(task, status, cachedResult.terminalOutput);
            results.push({
                task,
                code: cachedResult.code,
                status,
                terminalOutput: cachedResult.terminalOutput,
            });
        }
        return results;
    }
    /**
     * Coordinator wrapper around {@link resolveCachedTasks}: peeks at
     * scheduledTasks (without removing anything from the schedule),
     * filters to cacheable hashed discrete candidates, and delegates the
     * cache fetch + lifecycle to the public method. Returns true if any
     * tasks were resolved.
     *
     * The coordinator relies on this running unconditionally (when cache
     * is enabled): tasks dispatched in step 5 via runTaskDirectly skip
     * their own cache lookup on the assumption that this has already
     * confirmed them as misses. Excluding cacheMissedHashes preserves that
     * invariant — every dispatched hash was queried exactly once — but
     * don't add other length-based bails.
     */
    async resolveCachedTasksBulk() {
        const { scheduledTasks } = this.tasksSchedule.getAllScheduledTasks();
        const candidates = [];
        for (const id of scheduledTasks) {
            const task = this.taskGraph.tasks[id];
            if (task.hash &&
                !this.cacheMissedHashes.has(task.hash) &&
                !task.continuous &&
                task.cache) {
                candidates.push(task);
            }
        }
        if (candidates.length === 0)
            return false;
        // postRunSteps → complete() → tasksSchedule.complete() will filter
        // resolved hits out of scheduledTasks before we return, so there's
        // no need to mutate the schedule here.
        const groupId = this.closeGroup();
        try {
            const results = await this.resolveCachedTasks(true, candidates, groupId);
            return results.length > 0;
        }
        finally {
            this.openGroup(groupId);
        }
    }
    // endregion Applying Cache
    // region Batch
    /**
     * Hash all batch tasks and resolve cache hits topologically.
     *
     * Walks the task graph level by level. Every task gets a preliminary hash
     * (so startTasks always has a valid hash for Cloud). Tasks with depsOutputs
     * whose deps weren't cached are ineligible for cache lookup but still
     * receive a preliminary hash — they'll be re-hashed after execution.
     */
    async applyBatchCachedResults(batch, doNotSkipCache, groupId) {
        const cachedResults = [];
        const needsRehashAfterExecution = new Set();
        const tasks = Object.values(batch.taskGraph.tasks);
        if (!doNotSkipCache) {
            // Cache skipped — just hash so startTasks has valid hashes
            await this.hashBatchTasks(tasks);
            return { cachedResults, needsRehashAfterExecution };
        }
        const nonCachedTaskIds = new Set();
        await (0, task_graph_utils_1.walkTaskGraph)(batch.taskGraph, async (rootTaskIds) => {
            const rootTasks = rootTaskIds.map((id) => batch.taskGraph.tasks[id]);
            await this.hashBatchTasks(rootTasks);
            const eligible = [];
            for (const task of rootTasks) {
                const depIds = batch.taskGraph.dependencies[task.id];
                const hasNonCachedDep = depIds.some((id) => nonCachedTaskIds.has(id));
                if (hasNonCachedDep &&
                    (0, task_hasher_1.getInputs)(task, this.projectGraph, this.nxJson).depsOutputs.length > 0) {
                    nonCachedTaskIds.add(task.id);
                    needsRehashAfterExecution.add(task.id);
                }
                else {
                    eligible.push(task);
                }
            }
            if (eligible.length > 0) {
                const cacheResults = await this.applyCachedResults(eligible);
                const cachedIds = new Set(cacheResults.map((r) => r.task.id));
                cachedResults.push(...cacheResults);
                if (cacheResults.length > 0) {
                    const cachedTasks = cacheResults.map((r) => r.task);
                    await Promise.all(cachedTasks.map((task) => this.options.lifeCycle.scheduleTask(task)));
                    await this.preRunSteps(cachedTasks, { groupId });
                    // Replayed from the cache — don't write the results back.
                    await this.postRunSteps(cacheResults, false, groupId);
                }
                for (const task of eligible) {
                    if (!cachedIds.has(task.id)) {
                        nonCachedTaskIds.add(task.id);
                    }
                }
            }
        });
        return { cachedResults, needsRehashAfterExecution };
    }
    async hashBatchTasks(tasks) {
        // Batch executors run every task in the same forked process, but
        // each task still has its own .env files / custom-hasher env — use
        // task-specific env for hashing so the cache key matches the
        // single-task path.
        const perTaskEnvs = {};
        for (const task of tasks) {
            perTaskEnvs[task.id] = (0, task_env_1.getTaskSpecificEnv)(task, this.projectGraph);
        }
        await (0, hash_task_1.hashTasks)(this.hasher, this.projectGraph, this.fullTaskGraph, perTaskEnvs, this.taskDetails, tasks);
    }
    async applyFromCacheOrRunBatch(doNotSkipCache, batch, groupId) {
        const applyFromCacheOrRunBatchStart = perf_hooks_1.performance.mark('TaskOrchestrator-apply-from-cache-or-run-batch:start');
        const taskEntries = Object.entries(batch.taskGraph.tasks);
        const tasks = taskEntries.map(([, task]) => task);
        this.options.lifeCycle.registerRunningBatch?.(batch.id, {
            executorName: batch.executorName,
            taskIds: Object.keys(batch.taskGraph.tasks),
        });
        const { cachedResults, needsRehashAfterExecution } = await this.applyBatchCachedResults(batch, doNotSkipCache, groupId);
        // Schedule and start non-cached tasks (cached tasks were already
        // started and completed inside applyBatchCachedResults)
        const cachedTaskIds = new Set(cachedResults.map((r) => r.task.id));
        const nonCachedTasks = tasks.filter((t) => !cachedTaskIds.has(t.id));
        if (nonCachedTasks.length > 0) {
            await Promise.all(nonCachedTasks.map((task) => this.options.lifeCycle.scheduleTask(task)));
            await this.preRunSteps(nonCachedTasks, { groupId });
        }
        // Phase 2: Run non-cached tasks, then re-hash depsOutputs tasks
        const taskIdsToSkip = cachedResults.map((r) => r.task.id);
        let batchResults = [];
        if (taskIdsToSkip.length < tasks.length) {
            const runGraph = (0, utils_1.removeTasksFromTaskGraph)(batch.taskGraph, taskIdsToSkip);
            for (const task of Object.values(runGraph.tasks)) {
                this.detectTaskInvocationLoop(task);
            }
            batchResults = await this.runBatch({
                id: batch.id,
                executorName: batch.executorName,
                taskGraph: runGraph,
            }, this.batchEnv, groupId);
            // Re-hash depsOutputs tasks — their dep outputs are now on disk
            const tasksToRehash = batchResults
                .filter((r) => needsRehashAfterExecution.has(r.task.id) &&
                (r.status === 'success' || r.status === 'failure'))
                .map((r) => r.task);
            if (tasksToRehash.length > 0) {
                // hashTasks skips tasks that already have a hash — clear the
                // preliminary hashes so these tasks actually get re-hashed
                for (const task of tasksToRehash) {
                    task.hash = undefined;
                    task.hashDetails = undefined;
                }
                await this.hashBatchTasks(tasksToRehash);
            }
        }
        if (batchResults.length > 0) {
            await this.postRunSteps(batchResults, doNotSkipCache, groupId);
        }
        // Update batch status based on all task results
        const hasFailures = taskEntries.some(([taskId]) => {
            const status = this.completedTasks.get(taskId);
            return status === 'failure' || status === 'skipped';
        });
        this.options.lifeCycle.setBatchStatus?.(batch.id, hasFailures ? "Failure" /* BatchStatus.Failure */ : "Success" /* BatchStatus.Success */);
        this.forkedProcessTaskRunner.cleanUpBatchProcesses();
        const tasksCompleted = taskEntries.filter(([taskId]) => this.completedTasks.has(taskId));
        // Batch is still not done, run it again
        if (tasksCompleted.length !== taskEntries.length) {
            await this.applyFromCacheOrRunBatch(doNotSkipCache, {
                id: batch.id,
                executorName: batch.executorName,
                taskGraph: (0, utils_1.removeTasksFromTaskGraph)(batch.taskGraph, tasksCompleted.map(([taskId]) => taskId)),
            }, groupId);
        }
        // Batch is done, mark it as completed
        const applyFromCacheOrRunBatchEnd = perf_hooks_1.performance.mark('TaskOrchestrator-apply-from-cache-or-run-batch:end');
        perf_hooks_1.performance.measure('TaskOrchestrator-apply-from-cache-or-run-batch', applyFromCacheOrRunBatchStart.name, applyFromCacheOrRunBatchEnd.name);
        return [...cachedResults, ...batchResults];
    }
    async runBatch(batch, env, groupId) {
        const runBatchStart = perf_hooks_1.performance.mark('TaskOrchestrator-run-batch:start');
        let batchProcess;
        try {
            batchProcess = await this.forkedProcessTaskRunner.forkProcessForBatch(batch, this.projectGraph, this.fullTaskGraph, env);
            // Stream output from batch process to the batch
            batchProcess.onOutput((output) => {
                this.options.lifeCycle.appendBatchOutput?.(batch.id, output);
            });
            // Stream task results as they complete
            // Heavy operations (caching, scheduling, complete) happen at batch-end in postRunSteps
            batchProcess.onTaskResults((taskId, result) => {
                const task = this.taskGraph.tasks[taskId];
                const status = resolveBatchTaskStatus(result);
                // Append before print so printTaskTerminalOutput finds the PTY already
                // populated and no-ops; reversing the order writes terminalOutput twice.
                if (result.terminalOutput) {
                    this.options.lifeCycle.appendTaskOutput(taskId, result.terminalOutput, false);
                }
                // Skipped tasks didn't run, so they have no terminal output and don't
                // need a per-task PTY — calling printTaskTerminalOutput would otherwise
                // allocate one just to write a cursor-hide escape.
                //
                // When the batch is being folded, printing is deferred to batch end
                // (printGroupedBatchOutput), which always renders each task through the
                // life cycle and adds the worker's whole log as a fold when the run
                // asked for full output or any task failed or was stopped.
                if (status !== 'skipped' && !(0, output_1.shouldGroupBatchOutput)()) {
                    this.options.lifeCycle.printTaskTerminalOutput(task, status, result.terminalOutput ?? '');
                }
                task.startTime = result.startTime;
                task.endTime = result.endTime;
                if (result.startTime && result.endTime) {
                    this.options.lifeCycle.setTaskTiming?.(taskId, result.startTime, result.endTime);
                }
                this.options.lifeCycle.setTaskStatus(taskId, (0, native_1.parseTaskStatus)(status));
            });
            const results = await batchProcess.getResults();
            const batchResultEntries = Object.entries(results);
            const taskResults = batchResultEntries.map(([taskId, result]) => {
                const task = this.taskGraph.tasks[taskId];
                task.startTime = result.startTime;
                task.endTime = result.endTime;
                const status = resolveBatchTaskStatus(result);
                return {
                    code: status === 'success' ? 0 : 1,
                    task,
                    status,
                    terminalOutput: result.terminalOutput,
                };
            });
            if ((0, output_1.shouldGroupBatchOutput)()) {
                this.renderBatchOutputSafely(batch.id, () => this.printGroupedBatchOutput(batch, taskResults, batchProcess.getCapturedOutputPath()));
            }
            return taskResults;
        }
        catch (e) {
            const isBatchStopping = this.stopRequested;
            const taskResults = Object.keys(batch.taskGraph.tasks).map((taskId) => {
                const task = this.taskGraph.tasks[taskId];
                if (isBatchStopping) {
                    task.endTime = Date.now();
                }
                return {
                    task,
                    code: 1,
                    status: (isBatchStopping ? 'stopped' : 'failure'),
                    terminalOutput: isBatchStopping ? '' : (e.stack ?? e.message ?? ''),
                };
            });
            // The worker died without reporting results, so nothing was attributed to
            // a task and no per-task output ran. Everything it wrote went to
            // stdout/stderr, held back under log grouping — surface it as one fold.
            // Outside grouping it already streamed live. This matters just as much
            // when the batch was stopped: every task is marked stopped whether or not
            // it finished, so the log is the only record of what got through. Only
            // the exit-code error is dropped there, since it restates the
            // cancellation.
            if ((0, output_1.shouldGroupBatchOutput)()) {
                const capturedOutputPath = batchProcess?.getCapturedOutputPath();
                const trailer = isBatchStopping ? undefined : e.message;
                if (capturedOutputPath || trailer) {
                    this.renderBatchOutputSafely(batch.id, () => this.printBatchFold(batch, taskResults, {
                        capturedOutputPath,
                        trailer,
                    }));
                }
            }
            return taskResults;
        }
        finally {
            batchProcess?.discardCapturedOutput();
            const runBatchEnd = perf_hooks_1.performance.mark('TaskOrchestrator-run-batch:end');
            perf_hooks_1.performance.measure('TaskOrchestrator-run-batch', runBatchStart.name, runBatchEnd.name);
        }
    }
    /**
     * Rendering a batch's output must never change the batch's results. A throw
     * from the printer would otherwise land in `runBatch`'s own error handling:
     * on the resolved path it rewrites every task to `failure` with the printer's
     * stack as its output — reporting a green build red to the life cycles and Nx
     * Cloud — and on the crash path it escapes `runBatch`, replacing the built
     * failure results with the printer's error. Both call sites degrade to a
     * warning here instead.
     */
    renderBatchOutputSafely(batchId, render) {
        try {
            render();
        }
        catch (e) {
            output_1.output.warn({
                title: `Could not render output for batch ${batchId}`,
                bodyLines: [e.message],
            });
        }
    }
    /**
     * Prints a completed batch's output once, under log grouping. Live forwarding
     * was suppressed while grouping, so this is the only copy — which is why the
     * requested output style has to reach this path rather than stopping at the
     * life cycle.
     *
     * Two things are rendered, and they answer different questions.
     *
     * Every task always renders through the life cycle, exactly as in a non-batch
     * run - failures in full, successes collapsed to a line for run-many, plus the
     * initiating project in full for run-one. That is what attributes output to a
     * task, and it is the only place some of it exists: `@nx/jest` synthesizes
     * each task's `terminalOutput` from an aggregated result and never writes
     * those per-project summaries to the worker's stdio at all.
     *
     * The worker's whole captured log is rendered as a fold above them when the
     * run asked for full output, or when any task failed or was stopped. A
     * diagnostic that explains a failure is routinely one no task claimed:
     * `@nx/maven`'s batch impl writes its exit-code dump and failed-task outputs
     * to the worker's stderr via `console.error`, and the Maven JVM it spawns
     * points slf4j at `System.out` because its own stderr carries the result
     * protocol - two layers, two streams, both captured and neither attributed to
     * a task - and `@nx/gradle` emits configuration-phase errors before the first
     * `> Task :x:y` header tells it which task to attribute to. Both catch their
     * own crash and backfill task results, so the batch resolves and lands here
     * rather than in the caller's failure path.
     *
     * Rendering both duplicates some bytes, deliberately. `@nx/maven` and
     * `@nx/gradle` tee each task's output into the worker's stdio on the way to
     * `terminalOutput`, so a failing task's body appears in the fold and again in
     * its own block. That is bounded on the default style, where successes
     * collapse to a line each and a crashed batch backfills a short
     * `e.toString()` rather than a body, so the case with the largest fold
     * duplicates the least. Under a full-output style it is not bounded: every
     * task prints in full beside a log that already contains it, which is the
     * price of that style asking for everything. What it buys either way is
     * attribution the fold cannot express. The
     * alternative, letting the fold replace per-task rendering, silently dropped
     * `@nx/jest`'s summaries and is what this shape exists to avoid.
     *
     * A batch that never reported results is handled by the caller instead.
     */
    printGroupedBatchOutput(batch, taskResults, capturedOutputPath) {
        // Read from the same field the streaming decision uses. `this.options` has
        // its own `outputStyle`, merged from `nx.json`'s tasksRunnerOptions, so the
        // two disagree whenever a style is configured there but not named on the
        // command line - and `init-tasks-runner` passes a populated `options` with
        // no style argument at all, so on that path only `options` can carry one.
        const printsFullOutput = (0, output_1.printsFullTaskOutput)({
            verbose: this.options.verbose,
            outputStyle: this.outputStyle,
        });
        const batchOwnsTheDiagnostic = taskResults.some((r) => r.status === 'failure' || r.status === 'stopped');
        if ((printsFullOutput || batchOwnsTheDiagnostic) && capturedOutputPath) {
            // No redirect lines: every task renders itself below, so there is nothing
            // to redirect anyone to.
            this.printBatchFold(batch, taskResults, { capturedOutputPath }, { redirectLines: false });
        }
        for (const { task, status, terminalOutput } of taskResults) {
            if (status !== 'skipped') {
                this.options.lifeCycle.printTaskTerminalOutput(task, status, terminalOutput ?? '');
            }
        }
    }
    /**
     * Renders a batch's whole output as one fold, plus — unless `redirectLines`
     * is off — a line per task pointing at it. The fold is labelled with the
     * executor and a run-unique id (the same
     * executor can run more than one batch), rather than an arbitrary task. Safe
     * to write to `output` directly: grouping implies GitHub Actions implies a
     * non-TTY, static lifecycle.
     */
    printBatchFold(batch, taskResults, body, { redirectLines = true } = {}) {
        // batch.id is already `<executor> <n>`, numbered per executor when the batch
        // was scheduled. Deriving a second number here would drift from it, since
        // only batches that render a fold would be counted. The suffix disambiguates
        // re-runs of the same batch rather than replacing the id, so it cannot.
        const renders = (this.batchFoldRenders.get(batch.id) ?? 0) + 1;
        this.batchFoldRenders.set(batch.id, renders);
        const label = renders === 1 ? `batch ${batch.id}` : `batch ${batch.id}:${renders}`;
        const worst = taskResults.some((r) => r.status === 'failure')
            ? 'failure'
            : taskResults.some((r) => r.status === 'stopped')
                ? 'stopped'
                : 'success';
        output_1.output.logBatchGroup(label, body, worst);
        if (!redirectLines) {
            return;
        }
        for (const { task, status } of taskResults) {
            if (status !== 'skipped') {
                output_1.output.logCommandRedirect((0, utils_1.getPrintableCommandArgsForTask)(task).join(' '), status, `(output in "${label}" above)`);
            }
        }
    }
    // endregion Batch
    // region Single Task
    /**
     * Bulk-resolve cache hits for a set of tasks: fetch cached entries,
     * copy outputs as needed, fire lifecycle, and return the TaskResults
     * for the hits. Tasks that aren't in the cache (or aren't cacheable)
     * are silently omitted from the return value — callers are responsible
     * for running those via {@link runTaskDirectly}.
     *
     * Fires scheduleTask lifecycle for hits that haven't been through
     * processAllScheduledTasks yet. That's a coordinator gap-filler and
     * a no-op for callers that pre-process the schedule.
     *
     * The caller provides `groupId` — cache hits share one slot since they
     * don't actually compete for parallelism.
     */
    async resolveCachedTasks(doNotSkipCache, tasks, groupId) {
        if (!doNotSkipCache || tasks.length === 0)
            return [];
        const cacheableTasks = tasks.filter((t) => t.cache);
        if (cacheableTasks.length === 0)
            return [];
        // Wait for any queued processTask promises to settle so task.hash is
        // populated before cache.getBatch maps it into a Rust String.
        await Promise.all(cacheableTasks.map((t) => this.processedTasks.get(t.id)));
        const cacheHits = await this.fetchCacheHits(cacheableTasks);
        if (cacheHits.length === 0)
            return [];
        // scheduleTask lifecycle for hits the coordinator resolved before
        // processAllScheduledTasks could fire it. No-op for callers that
        // already ran processAllScheduledTasks (every hit is in processedTasks).
        await Promise.all(cacheHits
            .filter(({ task }) => !this.processedTasks.has(task.id))
            .map(({ task }) => this.options.lifeCycle.scheduleTask(task)));
        const hitTasks = cacheHits.map((h) => h.task);
        await this.preRunSteps(hitTasks, { groupId });
        const results = await this.finalizeCacheHits(cacheHits);
        // Replayed from the cache — don't write the results back.
        await this.postRunSteps(results, false, groupId);
        return results;
    }
    /**
     * Fire a discrete-task worker and track it in pendingDiscreteWorkers until
     * it settles. Uses runTaskDirectly (not applyFromCacheOrRun*) because
     * resolveCachedTasksBulk already confirmed this task is a cache miss —
     * another lookup would re-query the DB and (for Nx Cloud users) repeat
     * the remote HTTP retrieval.
     */
    dispatchDiscreteWorker(doNotSkipCache, task, groupId) {
        const worker = this.runTaskDirectly(doNotSkipCache, task, groupId)
            .catch((e) => this.handleDiscreteWorkerFailure(doNotSkipCache, task, groupId, e))
            .finally(() => {
            this.openGroup(groupId);
            this.pendingDiscreteWorkers.delete(worker);
            // Wake coordinator — the delete above may satisfy the exit condition
            // (pendingDiscreteWorkers.size === 0) that was missed when
            // scheduleNextTasksAndReleaseThreads fired earlier.
            this.waitingForTasks.forEach((f) => f(null));
            this.waitingForTasks.length = 0;
        });
        this.pendingDiscreteWorkers.add(worker);
    }
    /**
     * Route a worker rejection (e.g. remote cache errors) through the normal
     * failure path instead of letting it become an unhandled promise. Guard
     * against double-finalize: completeTasks() populates `completedTasks`,
     * so a rejection arriving after postRunSteps has already finalized the
     * task must not run postRunSteps again.
     */
    async handleDiscreteWorkerFailure(doNotSkipCache, task, groupId, e) {
        if (this.completedTasks.has(task.id))
            return;
        const terminalOutput = e?.message ?? '';
        this.options.lifeCycle.printTaskTerminalOutput(task, 'failure', terminalOutput);
        await this.postRunSteps([{ task, status: 'failure', terminalOutput }], doNotSkipCache, groupId);
    }
    /**
     * Spawn and wait on a task's child process, unconditionally — no cache
     * lookup. Callers must have already confirmed the task is a cache miss
     * (or disabled caching entirely).
     */
    async runTaskDirectly(doNotSkipCache, task, groupId) {
        // Wait for task to be processed
        const taskSpecificEnv = await this.processedTasks.get(task.id);
        await this.preRunSteps([task], { groupId });
        const pipeOutput = await this.pipeOutputCapture(task);
        const temporaryOutputPath = this.cache.temporaryOutputPath(task);
        const streamOutput = (0, output_1.isStaticOutputStyle)(this.outputStyle)
            ? false
            : (0, utils_1.shouldStreamOutput)(task, this.initiatingProject);
        const env = pipeOutput
            ? (0, task_env_1.getEnvVariablesForTask)(task, taskSpecificEnv, (0, task_env_1.getForceColorForChild)(), this.options.skipNxCache, this.options.captureStderr, null, null)
            : (0, task_env_1.getEnvVariablesForTask)(task, taskSpecificEnv, undefined, this.options.skipNxCache, this.options.captureStderr, temporaryOutputPath, streamOutput);
        let resolveDiscreteExit;
        const discreteExitHandled = new Promise((r) => (resolveDiscreteExit = r));
        this.discreteTaskExitHandled.set(task.id, discreteExitHandled);
        this.detectTaskInvocationLoop(task);
        const childProcess = await this.runTask(task, streamOutput, env, temporaryOutputPath, pipeOutput);
        this.runningDiscreteTasks.set(task.id, {
            runningTask: childProcess,
            stopping: false,
        });
        const { code, terminalOutput } = await childProcess.getResults();
        const isStopping = this.runningDiscreteTasks.get(task.id)?.stopping ?? false;
        this.runningDiscreteTasks.delete(task.id);
        const result = {
            task,
            code,
            status: isStopping ? 'stopped' : code === 0 ? 'success' : 'failure',
            terminalOutput,
        };
        try {
            await this.postRunSteps([result], doNotSkipCache, groupId);
        }
        finally {
            this.discreteTaskExitHandled.delete(task.id);
            resolveDiscreteExit();
        }
        return result;
    }
    async runTask(task, streamOutput, env, temporaryOutputPath, pipeOutput) {
        const shouldPrefix = streamOutput &&
            process.env.NX_PREFIX_OUTPUT === 'true' &&
            !this.tuiEnabled;
        const targetConfiguration = (0, utils_1.getTargetConfigurationForTask)(task, this.projectGraph);
        if (process.env.NX_RUN_COMMANDS_DIRECTLY !== 'false' &&
            targetConfiguration.executor === 'nx:run-commands') {
            try {
                const { schema } = (0, utils_1.getExecutorForTask)(task, this.projects);
                const combinedOptions = (0, params_1.combineOptionsForExecutor)(task.overrides, task.target.configuration ?? targetConfiguration.defaultConfiguration, targetConfiguration, schema, task.target.project, (0, path_1.relative)(task.projectRoot ?? workspace_root_1.workspaceRoot, process.cwd()), process.env.NX_VERBOSE_LOGGING === 'true');
                if (combinedOptions.env) {
                    env = {
                        ...env,
                        ...combinedOptions.env,
                    };
                }
                if (streamOutput) {
                    const args = (0, utils_1.getPrintableCommandArgsForTask)(task);
                    output_1.output.logCommand(args.join(' '));
                }
                const runCommandsOptions = {
                    ...combinedOptions,
                    env,
                    usePty: this.tuiEnabled ||
                        (!this.tasksSchedule.hasTasks() &&
                            this.runningContinuousTasks.size === 0),
                    streamOutput: streamOutput && !shouldPrefix,
                };
                const runningTask = await (0, run_commands_impl_1.runCommands)(runCommandsOptions, {
                    root: workspace_root_1.workspaceRoot, // only root is needed in runCommands
                }, task.id);
                this.runningRunCommandsTasks.set(task.id, runningTask);
                runningTask.onExit(() => {
                    this.runningRunCommandsTasks.delete(task.id);
                });
                if (shouldPrefix) {
                    const color = (0, output_prefix_1.getColor)(task.target.project);
                    const formattedPrefix = pc.bold(color(`${task.target.project}:`));
                    runningTask.onOutput((chunk) => {
                        (0, output_prefix_1.writePrefixedLines)(chunk, formattedPrefix);
                    });
                }
                else if (this.tuiEnabled) {
                    if (runningTask instanceof pseudo_terminal_1.PseudoTtyProcess) {
                        // This is an external of a the pseudo terminal where a task is running and can be passed to the TUI
                        this.options.lifeCycle.registerRunningTask(task.id, runningTask.getPtyHandles());
                        runningTask.onOutput((output) => {
                            this.options.lifeCycle.appendTaskOutput(task.id, output, true);
                        });
                    }
                    else {
                        this.options.lifeCycle.registerRunningTaskWithEmptyParser(task.id);
                        runningTask.onOutput((output) => {
                            this.options.lifeCycle.appendTaskOutput(task.id, output, false);
                        });
                    }
                }
                if (!streamOutput && !shouldPrefix) {
                    // TODO: shouldn't this be checking if the task is continuous before writing anything to disk or calling printTaskTerminalOutput?
                    runningTask.onExit((code, terminalOutput) => {
                        this.options.lifeCycle.printTaskTerminalOutput(task, code === 0 ? 'success' : 'failure', terminalOutput);
                        (0, fs_1.writeFileSync)(temporaryOutputPath, terminalOutput);
                    });
                }
                return runningTask;
            }
            catch (e) {
                if (process.env.NX_VERBOSE_LOGGING === 'true') {
                    console.error(e);
                }
                else {
                    console.error(e.message);
                }
                const terminalOutput = e.stack ?? e.message ?? '';
                (0, fs_1.writeFileSync)(temporaryOutputPath, terminalOutput);
                return new noop_child_process_1.NoopChildProcess({
                    code: 1,
                    terminalOutput,
                });
            }
        }
        else if (targetConfiguration.executor === 'nx:noop') {
            (0, fs_1.writeFileSync)(temporaryOutputPath, '');
            return new noop_child_process_1.NoopChildProcess({
                code: 0,
                terminalOutput: '',
            });
        }
        else {
            // cache prep
            const runningTask = await this.runTaskInForkedProcess(task, env, pipeOutput, temporaryOutputPath, streamOutput);
            if (this.tuiEnabled) {
                if (runningTask instanceof pseudo_terminal_1.PseudoTtyProcess) {
                    // This is an external of a the pseudo terminal where a task is running and can be passed to the TUI
                    this.options.lifeCycle.registerRunningTask(task.id, runningTask.getPtyHandles());
                    runningTask.onOutput((output) => {
                        this.options.lifeCycle.appendTaskOutput(task.id, output, true);
                    });
                }
                else if ('onOutput' in runningTask &&
                    typeof runningTask.onOutput === 'function') {
                    // Register task that can provide progressive output but isn't interactive (e.g., NodeChildProcessWithNonDirectOutput)
                    this.options.lifeCycle.registerRunningTaskWithEmptyParser(task.id);
                    runningTask.onOutput((output) => {
                        this.options.lifeCycle.appendTaskOutput(task.id, output, false);
                    });
                }
                else {
                    // Fallback for tasks that don't support progressive output
                    this.options.lifeCycle.registerRunningTaskWithEmptyParser(task.id);
                }
            }
            return runningTask;
        }
    }
    async runTaskInForkedProcess(task, env, pipeOutput, temporaryOutputPath, streamOutput) {
        try {
            const usePtyFork = process.env.NX_NATIVE_COMMAND_RUNNER !== 'false';
            // Disable the pseudo terminal if this is a run-many or when running a continuous task as part of a run-one
            const disablePseudoTerminal = !this.tuiEnabled && (!this.initiatingProject || task.continuous);
            // execution
            const childProcess = usePtyFork
                ? await this.forkedProcessTaskRunner.forkProcess(task, {
                    temporaryOutputPath,
                    streamOutput,
                    pipeOutput,
                    taskGraph: this.taskGraph,
                    env,
                    disablePseudoTerminal,
                })
                : await this.forkedProcessTaskRunner.forkProcessLegacy(task, {
                    temporaryOutputPath,
                    streamOutput,
                    pipeOutput,
                    taskGraph: this.taskGraph,
                    env,
                });
            return childProcess;
        }
        catch (e) {
            if (process.env.NX_VERBOSE_LOGGING === 'true') {
                console.error(e);
            }
            return new noop_child_process_1.NoopChildProcess({
                code: 1,
                terminalOutput: e.stack ?? e.message ?? '',
            });
        }
    }
    async startContinuousTask(task, groupId) {
        if (this.runningTasksService &&
            this.runningTasksService.getRunningTasks([task.id]).length) {
            await this.preRunSteps([task], { groupId });
            if (this.tuiEnabled) {
                this.options.lifeCycle.setTaskStatus(task.id, 8 /* NativeTaskStatus.Shared */);
            }
            const runningTask = new shared_running_task_1.SharedRunningTask(this.runningTasksService, task.id);
            this.runningContinuousTasks.set(task.id, {
                runningTask,
                groupId,
                ownsRunningTasksService: false,
            });
            this.continuousTaskExitHandled.set(task.id, new Promise((resolve) => {
                runningTask.onExit(async (code) => {
                    await this.handleContinuousTaskExit(code, task, groupId, false);
                    resolve();
                });
            }));
            // task is already running by another process, we schedule the next tasks
            // and release the threads
            await this.scheduleNextTasksAndReleaseThreads();
            return runningTask;
        }
        const taskSpecificEnv = await this.processedTasks.get(task.id);
        await this.preRunSteps([task], { groupId });
        const pipeOutput = await this.pipeOutputCapture(task);
        // obtain metadata
        const temporaryOutputPath = this.cache.temporaryOutputPath(task);
        const streamOutput = (0, output_1.isStaticOutputStyle)(this.outputStyle)
            ? false
            : (0, utils_1.shouldStreamOutput)(task, this.initiatingProject);
        let env = pipeOutput
            ? (0, task_env_1.getEnvVariablesForTask)(task, taskSpecificEnv, (0, task_env_1.getForceColorForChild)(), this.options.skipNxCache, this.options.captureStderr, null, null)
            : (0, task_env_1.getEnvVariablesForTask)(task, taskSpecificEnv, undefined, this.options.skipNxCache, this.options.captureStderr, temporaryOutputPath, streamOutput);
        this.detectTaskInvocationLoop(task);
        const childProcess = await this.runTask(task, streamOutput, env, temporaryOutputPath, pipeOutput);
        this.runningTasksService?.addRunningTask(task.id);
        this.runningContinuousTasks.set(task.id, {
            runningTask: childProcess,
            groupId,
            ownsRunningTasksService: true,
        });
        this.continuousTaskExitHandled.set(task.id, new Promise((resolve) => {
            childProcess.onExit(async (code) => {
                await this.handleContinuousTaskExit(code, task, groupId, true);
                resolve();
            });
        }));
        await this.scheduleNextTasksAndReleaseThreads();
        return childProcess;
    }
    // endregion Single Task
    // region Lifecycle
    async preRunSteps(tasks, metadata) {
        const now = Date.now();
        for (const task of tasks) {
            task.startTime = now;
        }
        await this.options.lifeCycle.startTasks(tasks, metadata);
    }
    async postRunSteps(results, shouldCache, groupId) {
        const now = Date.now();
        const tasksToRecord = [];
        for (const { task, status } of results) {
            // Only set endTime as fallback (batch provides timing via result.task)
            task.endTime ??= now;
            // Skip recording for tasks whose outputs already match the cache —
            // the daemon already has the correct hash recorded.
            if (!this.stopRequested &&
                task.outputs.length > 0 &&
                status !== 'local-cache-kept-existing') {
                tasksToRecord.push({ outputs: task.outputs, hash: task.hash });
            }
        }
        if (tasksToRecord.length > 0) {
            await this.recordOutputsHashBatch(tasksToRecord);
        }
        // Caller decides whether these results should be written to the cache.
        // Cache replays pass false so a replayed failure (reported as 'failure' so
        // it counts as a failed run) isn't re-written to the cache on every replay.
        if (shouldCache && !this.stopRequested) {
            // cache the results
            perf_hooks_1.performance.mark('cache-results-start');
            await Promise.all(results
                .filter(({ status }) => status !== 'local-cache' &&
                status !== 'local-cache-kept-existing' &&
                status !== 'remote-cache' &&
                status !== 'skipped' &&
                status !== 'stopped')
                .map((result) => ({
                ...result,
                code: result.status === 'local-cache' ||
                    result.status === 'local-cache-kept-existing' ||
                    result.status === 'remote-cache' ||
                    result.status === 'success'
                    ? 0
                    : 1,
                outputs: result.task.outputs,
            }))
                .filter(({ task, code }) => this.shouldCacheTaskResult(task, code))
                .filter(({ terminalOutput, outputs }) => terminalOutput || outputs)
                .map(async ({ task, code, terminalOutput, outputs }) => this.cache.put(task, terminalOutput, outputs, code)));
            perf_hooks_1.performance.mark('cache-results-end');
            perf_hooks_1.performance.measure('cache-results', 'cache-results-start', 'cache-results-end');
        }
        await this.complete(results, groupId);
        await this.scheduleNextTasksAndReleaseThreads();
    }
    async scheduleNextTasksAndReleaseThreads() {
        if (this.stopRequested) {
            this.waitingForTasks.forEach((f) => f(null));
            this.waitingForTasks.length = 0;
            return;
        }
        await this.tasksSchedule.scheduleNextTasks();
        // release blocked threads
        this.waitingForTasks.forEach((f) => f(null));
        this.waitingForTasks.length = 0;
    }
    async complete(results, groupId) {
        await this.completeTasks(results, groupId);
        this.cleanUpUnneededContinuousTasks();
    }
    /**
     * Unified task completion handler for a set of tasks.
     * - Calls endTasks() lifecycle hook (non-skipped only)
     * - Marks complete in scheduler
     * - Sets completedTasks
     * - Updates TUI status
     * - Skip dependent tasks
     */
    async completeTasks(results, groupId) {
        // 1. endTasks FIRST (non-skipped only)
        const tasksToReport = [];
        const taskIds = [];
        for (const { task, status, terminalOutput } of results) {
            taskIds.push(task.id);
            if (!this.completedTasks.has(task.id) && status !== 'skipped') {
                tasksToReport.push({
                    task,
                    status,
                    terminalOutput,
                    code: status === 'success' ||
                        status === 'local-cache' ||
                        status === 'local-cache-kept-existing' ||
                        status === 'remote-cache'
                        ? 0
                        : 1,
                });
            }
        }
        if (tasksToReport.length > 0) {
            await this.options.lifeCycle.endTasks(tasksToReport, { groupId });
        }
        // 2. Mark complete in scheduler
        this.tasksSchedule.complete(taskIds);
        // 3. Set completedTasks + update TUI + collect dependent tasks to skip
        const dependentTasksToSkip = [];
        for (const { task, status, displayStatus } of results) {
            if (this.completedTasks.has(task.id))
                continue;
            this.completedTasks.set(task.id, status);
            this.taskInvocationTracker?.unregisterTask(task.id);
            this.registeredInvocations.delete(task.id);
            if (this.tuiEnabled) {
                this.options.lifeCycle.setTaskStatus(task.id, displayStatus ?? (0, native_1.parseTaskStatus)(status));
            }
            if (status === 'failure' ||
                status === 'skipped' ||
                status === 'stopped') {
                if (this.bail) {
                    // mark the execution as bailed which will stop all further execution
                    // only the tasks that are currently running will finish
                    this.bailed = true;
                }
                else {
                    // Collect reverse deps to skip
                    for (const depTaskId of this.reverseTaskDeps[task.id]) {
                        const depTask = this.taskGraph.tasks[depTaskId];
                        if (depTask) {
                            // Don't skip tasks that are still running/stopping — their own
                            // exit handler will set the correct terminal status
                            if (this.runningDiscreteTasks.has(depTaskId) ||
                                this.runningContinuousTasks.has(depTaskId)) {
                                continue;
                            }
                            dependentTasksToSkip.push({ task: depTask, status: 'skipped' });
                        }
                    }
                }
            }
        }
        // 4. Skip dependent tasks
        if (dependentTasksToSkip.length > 0) {
            await this.completeTasks(dependentTasksToSkip, groupId);
        }
    }
    //endregion Lifecycle
    // region utils
    async pipeOutputCapture(task) {
        try {
            if (process.env.NX_NATIVE_COMMAND_RUNNER !== 'false') {
                return true;
            }
            // When TUI is enabled, we need to use pipe output capture to support
            // progressive output streaming via the onOutput callback
            if (this.tuiEnabled) {
                return true;
            }
            const { schema } = (0, utils_1.getExecutorForTask)(task, this.projects);
            return (schema.outputCapture === 'pipe' ||
                process.env.NX_STREAM_OUTPUT === 'true');
        }
        catch (e) {
            return false;
        }
    }
    shouldCacheTaskResult(task, code) {
        return (task.cache &&
            (process.env.NX_CACHE_FAILURES == 'true' ? true : code === 0));
    }
    closeGroup() {
        for (let i = 0; i < this.options.parallel; i++) {
            if (!this.groups[i]) {
                this.groups[i] = true;
                return i;
            }
        }
    }
    openGroup(id) {
        this.groups[id] = false;
    }
    async shouldCopyOutputsFromCacheBatch(tasks) {
        const resultMap = new Map();
        if (tasks.length === 0)
            return resultMap;
        if (this.daemon?.enabled()) {
            const matches = await this.daemon.outputsHashesMatchBatch(tasks);
            for (let i = 0; i < tasks.length; i++) {
                resultMap.set(tasks[i].hash, !matches[i]);
            }
        }
        else {
            // No daemon → can't verify on-disk outputs, always copy.
            for (const task of tasks) {
                resultMap.set(task.hash, true);
            }
        }
        return resultMap;
    }
    async recordOutputsHashBatch(entries) {
        if (this.daemon?.enabled()) {
            return this.daemon.recordOutputsHashBatch(entries);
        }
    }
    // endregion utils
    async handleContinuousTaskExit(code, task, groupId, ownsRunningTasksService) {
        // If cleanup already completed this task, nothing left to do
        if (this.completedTasks.has(task.id)) {
            return;
        }
        const stoppingReason = this.runningContinuousTasks.get(task.id)?.stoppingReason;
        if (stoppingReason || exit_codes_1.EXPECTED_TERMINATION_SIGNALS.has(code)) {
            const reason = stoppingReason === 'fulfilled' ? 'fulfilled' : 'interrupted';
            await this.completeContinuousTask(task, groupId, ownsRunningTasksService, reason);
        }
        else if (!this.isContinuousTaskNeeded(task.id)) {
            // No remaining tasks depend on this — the task was about to be
            // killed by cleanUpUnneededContinuousTasks anyway.
            await this.completeContinuousTask(task, groupId, ownsRunningTasksService, 'fulfilled');
        }
        else {
            console.error(`Task "${task.id}" is continuous but exited with code ${code}`);
            await this.completeContinuousTask(task, groupId, ownsRunningTasksService, 'crashed');
        }
    }
    isContinuousTaskNeeded(taskId) {
        return this.tasksSchedule
            .getIncompleteTasks()
            .some((t) => this.taskGraph.continuousDependencies[t.id]?.includes(taskId));
    }
    async completeContinuousTask(task, groupId, ownsRunningTasksService, reason) {
        if (this.completedTasks.has(task.id))
            return;
        this.runningContinuousTasks.delete(task.id);
        if (ownsRunningTasksService) {
            this.runningTasksService?.removeRunningTask(task.id);
        }
        task.endTime = Date.now();
        if (reason === 'fulfilled') {
            await this.complete([
                {
                    task,
                    status: 'success',
                    displayStatus: 9 /* NativeTaskStatus.Stopped */,
                },
            ], groupId);
        }
        else if (reason === 'crashed') {
            await this.complete([{ task, status: 'failure' }], groupId);
        }
        else {
            await this.complete([{ task, status: 'stopped' }], groupId);
        }
    }
    async cleanup() {
        if (this.cleanupPromise) {
            return this.cleanupPromise;
        }
        this.cleanupPromise = this.performCleanup();
        return this.cleanupPromise;
    }
    async performCleanup() {
        // Mark all running tasks for intentional stop
        const reason = this.stopRequested ? 'interrupted' : 'fulfilled';
        for (const entry of this.runningContinuousTasks.values()) {
            entry.stoppingReason = reason;
        }
        for (const entry of this.runningDiscreteTasks.values()) {
            entry.stopping = true;
        }
        // Snapshot continuous tasks before clearing the map.
        // We clear first because complete() -> cleanUpUnneededContinuousTasks()
        // iterates runningContinuousTasks and would re-kill already-stopping tasks.
        const continuousSnapshot = Array.from(this.runningContinuousTasks.entries());
        this.runningContinuousTasks.clear();
        // Complete continuous tasks directly — don't rely on onExit which may hang
        // when grandchild processes keep the pty slave fd open.
        for (const [taskId, { groupId, ownsRunningTasksService },] of continuousSnapshot) {
            const task = this.taskGraph.tasks[taskId];
            if (!task)
                continue;
            await this.completeContinuousTask(task, groupId, ownsRunningTasksService, reason);
        }
        // Kill all processes — await forked runner cleanup for graceful shutdown
        const forkedCleanup = this.forkedProcessTaskRunner.cleanup();
        const continuousTaskIds = new Set(continuousSnapshot.map(([id]) => id));
        await Promise.all([
            forkedCleanup,
            ...continuousSnapshot.map(async ([taskId, { runningTask }]) => {
                try {
                    await runningTask.kill();
                }
                catch (e) {
                    console.error(`Unable to terminate ${taskId}\nError:`, e);
                }
            }),
            ...Array.from(this.runningDiscreteTasks).map(async ([taskId, { runningTask }]) => {
                try {
                    await runningTask.kill();
                }
                catch (e) {
                    console.error(`Unable to terminate ${taskId}\nError:`, e);
                }
            }),
            // Skip tasks already killed via continuousSnapshot to avoid duplicate signals
            ...Array.from(this.runningRunCommandsTasks)
                .filter(([taskId]) => !continuousTaskIds.has(taskId))
                .map(async ([taskId, t]) => {
                try {
                    await t.kill();
                }
                catch (e) {
                    console.error(`Unable to terminate ${taskId}\nError:`, e);
                }
            }),
        ]);
        // Discrete exit promises resolve promptly (process kill → getResults →
        // postRunSteps → resolve). Await them so lifecycle endTasks() completes
        // before run() returns and endCommand() is called.
        await Promise.all(this.discreteTaskExitHandled.values());
    }
    setupSignalHandlers() {
        // Use process.on (not once) so the handler stays registered and absorbs
        // re-raised signals from signal-exit. Without this, signal-exit's handler
        // sees no remaining listeners after our once-handler auto-removes, and
        // re-raises the signal — killing the process before async cleanup completes.
        // The cleanup() idempotency guard (cleanupPromise) prevents double execution.
        const handleSignal = (signal) => {
            if (this.stopRequested)
                return;
            this.stopRequested = true;
            if (!this.tuiEnabled) {
                // Synchronously remove DB entries before async cleanup to prevent
                // new nx processes from seeing stale "Waiting for ..." messages.
                for (const [taskId, { ownsRunningTasksService }] of this
                    .runningContinuousTasks) {
                    if (ownsRunningTasksService) {
                        this.runningTasksService?.removeRunningTask(taskId);
                    }
                }
            }
            if (signal === 'SIGINT' && !this.tuiEnabled) {
                // Silence output — pnpm (and similar wrappers) may exit before nx
                // finishes cleanup, returning the shell prompt. Any output after
                // that point would appear after the prompt.
                const noop = (_chunk, _encoding, callback) => {
                    if (callback)
                        callback();
                    return true;
                };
                process.stdout.write = noop;
                process.stderr.write = noop;
            }
            this.cleanup().finally(() => {
                if (this.resolveStopPromise) {
                    this.resolveStopPromise();
                }
                else {
                    process.exit((0, exit_codes_1.signalToCode)(signal));
                }
            });
        };
        for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
            const handler = () => handleSignal(signal);
            this.signalHandlers.push([signal, handler]);
            process.on(signal, handler);
        }
    }
    // Registered at child creation, so unlike subscribing to RunningTask.onExit
    // after the fact it cannot miss an exit that already happened.
    waitForContinuousTaskExit(taskId) {
        return this.continuousTaskExitHandled.get(taskId) ?? Promise.resolve();
    }
    // Releases the process-level listeners registered by setupSignalHandlers.
    // Each closes over `this`, so a long-lived caller (an Nx Cloud agent creates
    // an orchestrator per invocation) leaks whole orchestrators until they run.
    async dispose() {
        // The forked runner's exit handler is the last-resort kill for child
        // processes, and a batch child can outlive its results message. Reap
        // children first so removing the handler cannot orphan a live one.
        try {
            await this.forkedProcessTaskRunner.cleanup();
        }
        catch (e) {
            console.error('Failed to clean up child processes on dispose:', e);
        }
        for (const [signal, handler] of this.signalHandlers) {
            process.off(signal, handler);
        }
        this.signalHandlers = [];
        this.forkedProcessTaskRunner.removeProcessEventListeners();
    }
    cleanUpUnneededContinuousTasks() {
        const incompleteTasks = this.tasksSchedule.getIncompleteTasks();
        const neededContinuousTasks = new Set();
        for (const task of incompleteTasks) {
            // Keep initiating tasks that are still incomplete
            if (task.continuous && this.initializingTaskIds.has(task.id)) {
                neededContinuousTasks.add(task.id);
            }
            const continuousDependencies = this.taskGraph.continuousDependencies[task.id];
            for (const continuousDependency of continuousDependencies) {
                neededContinuousTasks.add(continuousDependency);
            }
        }
        for (const [taskId, entry] of this.runningContinuousTasks) {
            if (!neededContinuousTasks.has(taskId)) {
                // Mark as intentional kill before calling kill()
                // onExit will see this and use success/Stopped
                entry.stoppingReason = 'fulfilled';
                entry.runningTask.kill();
            }
        }
    }
}
exports.TaskOrchestrator = TaskOrchestrator;
function getThreadPoolSize(options, taskGraph) {
    if (options['parallel'] === 'false' ||
        options['parallel'] === false) {
        options['parallel'] = 1;
    }
    else if (options['parallel'] === 'true' ||
        options['parallel'] === true ||
        options['parallel'] === undefined ||
        options['parallel'] === '') {
        options['parallel'] = Number(options['maxParallel'] || 3);
    }
    const continuousCount = Object.values(taskGraph.tasks).filter((t) => t.continuous).length;
    const discrete = options['parallel'];
    const continuous = continuousCount;
    const total = discrete + continuous;
    return { discrete, continuous, total };
}
