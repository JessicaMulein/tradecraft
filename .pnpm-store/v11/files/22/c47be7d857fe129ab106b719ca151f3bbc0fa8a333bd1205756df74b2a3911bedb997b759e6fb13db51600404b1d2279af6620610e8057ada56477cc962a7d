import { NxJsonConfiguration } from '../config/nx-json';
import { ProjectGraph } from '../config/project-graph';
import { Task, TaskGraph } from '../config/task-graph';
import { DaemonClient } from '../daemon/client/client';
import { TaskHasher } from '../hasher/task-hasher';
import { NxArgs } from '../utils/command-line-utils';
import { DefaultTasksRunnerOptions } from './default-tasks-runner';
import { TaskResult } from './life-cycle';
import { RunningTask } from './running-tasks/running-task';
import { SharedRunningTask } from './running-tasks/shared-running-task';
import { TaskStatus } from './tasks-runner';
import { Batch } from './tasks-schedule';
export declare class TaskOrchestrator {
    private readonly hasher;
    private readonly initiatingProject;
    private readonly initiatingTasks;
    private readonly projectGraph;
    private readonly taskGraph;
    private readonly nxJson;
    private readonly options;
    private readonly bail;
    private readonly daemon;
    private readonly outputStyle;
    private readonly fullTaskGraph;
    private taskDetails;
    private cache;
    private readonly tuiEnabled;
    private readonly projects;
    private forkedProcessTaskRunner;
    private runningTasksService;
    private taskInvocationTracker;
    private registeredInvocations;
    private tasksSchedule;
    private batchEnv;
    private reverseTaskDeps;
    private initializingTaskIds;
    private processedTasks;
    private cacheMissedHashes;
    private completedTasks;
    private waitingForTasks;
    private pendingDiscreteWorkers;
    private groups;
    private continuousTasksStarted;
    /**
     * How many folds each batch id has rendered. A batch that reports a strict
     * subset of its tasks is re-run under the same id, so one id can produce more
     * than one fold and the redirect lines have to point at the right one.
     */
    private batchFoldRenders;
    private bailed;
    private resolveStopPromise;
    private stopRequested;
    private runningContinuousTasks;
    private runningRunCommandsTasks;
    private runningDiscreteTasks;
    private discreteTaskExitHandled;
    private continuousTaskExitHandled;
    private cleanupPromise;
    private signalHandlers;
    constructor(hasher: TaskHasher, initiatingProject: string | undefined, initiatingTasks: Task[], projectGraph: ProjectGraph, taskGraph: TaskGraph, nxJson: NxJsonConfiguration, options: NxArgs & DefaultTasksRunnerOptions, bail: boolean, daemon: DaemonClient, outputStyle: string, fullTaskGraph?: TaskGraph);
    init(): Promise<void>;
    run(): Promise<{
        [k: string]: TaskStatus;
    }>;
    nextBatch(): Batch;
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
    private executeCoordinatorLoop;
    private executeContinuousTaskLoop;
    private processTask;
    processAllScheduledTasks(): void;
    /**
     * Registers a task invocation and checks for loops across nested Nx processes.
     * Uses the task_invocations DB table keyed by root PID. registerTask() throws
     * on unique constraint violation when a parent Nx process already registered
     * this task — indicating an infinite loop.
     */
    private detectTaskInvocationLoop;
    private applyCachedResults;
    /**
     * Batch cache lookup + filter to successful entries. Handles both
     * local (one rarray SQL call) and remote (parallel HTTP retrievals)
     * inside DbCache.getBatch.
     */
    private fetchCacheHits;
    /**
     * For each confirmed cache hit: decide whether to copy outputs from
     * the cache (skipping if the on-disk outputs already match the
     * recorded hash), copy in parallel, derive the task status, print
     * terminal output, and return the assembled results.
     */
    private finalizeCacheHits;
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
    private resolveCachedTasksBulk;
    /**
     * Hash all batch tasks and resolve cache hits topologically.
     *
     * Walks the task graph level by level. Every task gets a preliminary hash
     * (so startTasks always has a valid hash for Cloud). Tasks with depsOutputs
     * whose deps weren't cached are ineligible for cache lookup but still
     * receive a preliminary hash — they'll be re-hashed after execution.
     */
    private applyBatchCachedResults;
    private hashBatchTasks;
    applyFromCacheOrRunBatch(doNotSkipCache: boolean, batch: Batch, groupId: number): Promise<TaskResult[]>;
    private runBatch;
    /**
     * Rendering a batch's output must never change the batch's results. A throw
     * from the printer would otherwise land in `runBatch`'s own error handling:
     * on the resolved path it rewrites every task to `failure` with the printer's
     * stack as its output — reporting a green build red to the life cycles and Nx
     * Cloud — and on the crash path it escapes `runBatch`, replacing the built
     * failure results with the printer's error. Both call sites degrade to a
     * warning here instead.
     */
    private renderBatchOutputSafely;
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
    private printGroupedBatchOutput;
    /**
     * Renders a batch's whole output as one fold, plus — unless `redirectLines`
     * is off — a line per task pointing at it. The fold is labelled with the
     * executor and a run-unique id (the same
     * executor can run more than one batch), rather than an arbitrary task. Safe
     * to write to `output` directly: grouping implies GitHub Actions implies a
     * non-TTY, static lifecycle.
     */
    private printBatchFold;
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
    resolveCachedTasks(doNotSkipCache: boolean, tasks: Task[], groupId: number): Promise<TaskResult[]>;
    /**
     * Fire a discrete-task worker and track it in pendingDiscreteWorkers until
     * it settles. Uses runTaskDirectly (not applyFromCacheOrRun*) because
     * resolveCachedTasksBulk already confirmed this task is a cache miss —
     * another lookup would re-query the DB and (for Nx Cloud users) repeat
     * the remote HTTP retrieval.
     */
    private dispatchDiscreteWorker;
    /**
     * Route a worker rejection (e.g. remote cache errors) through the normal
     * failure path instead of letting it become an unhandled promise. Guard
     * against double-finalize: completeTasks() populates `completedTasks`,
     * so a rejection arriving after postRunSteps has already finalized the
     * task must not run postRunSteps again.
     */
    private handleDiscreteWorkerFailure;
    /**
     * Spawn and wait on a task's child process, unconditionally — no cache
     * lookup. Callers must have already confirmed the task is a cache miss
     * (or disabled caching entirely).
     */
    runTaskDirectly(doNotSkipCache: boolean, task: Task, groupId: number): Promise<TaskResult>;
    private runTask;
    private runTaskInForkedProcess;
    startContinuousTask(task: Task, groupId: number): Promise<RunningTask | SharedRunningTask>;
    private preRunSteps;
    private postRunSteps;
    private scheduleNextTasksAndReleaseThreads;
    private complete;
    /**
     * Unified task completion handler for a set of tasks.
     * - Calls endTasks() lifecycle hook (non-skipped only)
     * - Marks complete in scheduler
     * - Sets completedTasks
     * - Updates TUI status
     * - Skip dependent tasks
     */
    private completeTasks;
    private pipeOutputCapture;
    private shouldCacheTaskResult;
    private closeGroup;
    private openGroup;
    private shouldCopyOutputsFromCacheBatch;
    private recordOutputsHashBatch;
    private handleContinuousTaskExit;
    private isContinuousTaskNeeded;
    private completeContinuousTask;
    private cleanup;
    private performCleanup;
    private setupSignalHandlers;
    waitForContinuousTaskExit(taskId: string): Promise<void>;
    dispose(): Promise<void>;
    private cleanUpUnneededContinuousTasks;
}
export declare function getThreadPoolSize(options: NxArgs & DefaultTasksRunnerOptions, taskGraph: TaskGraph): {
    discrete: number;
    continuous: number;
    total: number;
};
