import { TaskGraph } from '../../config/task-graph';
import { NxJsonConfiguration } from '../../config/nx-json';
import { TaskResult } from '../life-cycle';
export interface TaskTiming {
    startTime?: number;
    endTime?: number;
    continuous: boolean;
}
/** A discrete task that ran, with its window and whether it monopolizes the pool (`parallelism: false`). */
export interface TimedTask {
    id: string;
    start: number;
    end: number;
    nonParallel: boolean;
}
/**
 * One [start, end) slice of the run where the counts below hold steady — the gap between
 * two adjacent sweep boundaries (see {@link buildTimespans}). Because nothing changes
 * within the slice, the analysis treats it as a flat rectangle of `end - start` ms.
 */
export interface Timespan {
    /** Slice bounds (epoch ms); occ/waiting/nonParallel are constant across [start, end). */
    start: number;
    end: number;
    /** Slots busy for the whole slice (a `parallelism: false` task counts as the entire pool). */
    occ: number;
    /** Tasks eligible to run but still queued for a free slot. */
    waiting: number;
    /** `parallelism: false` tasks running during the slice (each one holds every slot). */
    nonParallel: number;
}
/**
 * A task and how long it ran (ms). The unit the report's task lists are built from —
 * shared with the renderers so the producer and the formatters can't drift.
 */
export interface TaskDurationRow {
    id: string;
    duration: number;
}
export interface PerformanceSummary {
    runDuration: number;
    criticalPathDuration: number;
    criticalPathTaskCount: number;
    /** Longest critical-path tasks that ran (desc, capped at a few), cache hits excluded; empty when the path was fully cached. */
    criticalPathTop: TaskDurationRow[];
    /** Ids of tasks that failed (slowest first), for the GitHub Actions summary's failed-tasks list. Continuous tasks and tasks without a complete window are excluded. */
    failedTasks: string[];
    /** runDuration − criticalPathDuration. */
    overhead: number;
    /** Overhead split by lever; these + coordinatorOverhead sum to `overhead`. Their sum is the slot-contention time (derived, never stored, so the halves can't drift). */
    recoverableByParallel: number;
    recoverableByMachines: number;
    coordinatorOverhead: number;
    parallel: number;
    cores: number;
    isCI: boolean;
    /** In CI and not already distributing — so suggesting Nx Agents is actionable. */
    canDistribute: boolean;
    /** Already running on Nx Agents (NX_CLOUD_DISTRIBUTED_EXECUTION_AGENT_COUNT set). */
    distributing: boolean;
    /** Coordinator overhead outweighs task work, so the longest tasks aren't the lever (typical cached run). */
    coordinatorDominated: boolean;
    cacheHits: number;
    /** Tasks with any cache outcome (hits + tasks that ran). */
    cacheableCount: number;
    cacheSkipped: boolean;
    remoteCacheEnabled: boolean;
    /** The workspace opted out of Nx Cloud (`neverConnectToCloud` / NX_NO_CLOUD) — never recommend it. */
    cloudOptedOut: boolean;
}
/** Construction-time inputs for {@link PerformanceLifeCycle}. */
export interface PerformanceLifeCycleOptions {
    /** Whether `--skip-nx-cache` was passed (feeds the cache-skipped check). */
    skipNxCache?: boolean;
    /** Passed in at construction so the lifecycle doesn't re-read nx.json. */
    nxJson?: NxJsonConfiguration;
}
/**
 * Pure analysis over one finished run's collected timings — no lifecycle state and no
 * mutation. Built once per run from the {@link PerformanceLifeCycle}'s accumulated
 * maps; everything here is a function of that snapshot plus the environment it reads.
 */
export declare class PerformanceAnalysis {
    private readonly timings;
    private readonly statuses;
    private readonly taskGraph;
    private readonly batchSiblings;
    /** Resolved `--parallel` (getThreadPoolSize's `discrete`), set on the lifecycle by the runner; falls back to 1. */
    private readonly parallel;
    private readonly options;
    constructor(timings: Map<string, TaskTiming>, statuses: Map<string, TaskResult['status']>, taskGraph: TaskGraph, batchSiblings: Map<string, string[]>, 
    /** Resolved `--parallel` (getThreadPoolSize's `discrete`), set on the lifecycle by the runner; falls back to 1. */
    parallel: number, options: PerformanceLifeCycleOptions);
    /**
     * Whether a remote (Nx Cloud) cache is active, from the nx.json handed in at
     * construction. Assumes no remote cache when it wasn't provided rather than
     * re-reading nx.json from disk — the CLI path always provides it.
     */
    private remoteCacheEnabled;
    /** Discrete tasks that ran and have a start + end timestamp. */
    private timedTasks;
    /**
     * Longest-duration chain through the dependency DAG — the floor with unlimited
     * slots. `finishEstimate(t) = duration[t] + max(finishEstimate(p) for predecessors
     * p)`. Predecessors are real dependencies *plus* earlier batch siblings (a batch runs
     * sequentially in one process, so that ordering is part of the floor too). On equal
     * finish estimates keep the longer-running predecessor.
     */
    private criticalPath;
    /**
     * Real predecessors of `id`: dependencies plus any earlier batch sibling that FINISHED
     * before `id` started. A batch runs sequentially in one process, so that ordering is
     * part of the floor; concurrent batch executors aren't, and chaining them would inflate
     * it. (Matches readyTime.)
     */
    private predecessorsFor;
    /**
     * Longest finish time of any chain reaching `id` — its duration plus the best
     * predecessor's finish estimate — memoized in `ctx`. `ctx.visiting` guards a cycle in
     * a malformed graph (the back-edge contributes nothing).
     */
    private finishEstimate;
    /**
     * Earliest this task became eligible, independent of slots: the latest of run
     * start, dependency ends, any continuous dependency's *start* (an ordering
     * constraint, not contention), and any earlier batch sibling's end.
     */
    private readyTime;
    /**
     * Longest critical-path tasks that RAN (desc, capped at 3). Cache hits are excluded
     * (their duration is just restore time); no-status tasks (synthetic test runs) are
     * kept.
     */
    private computeCriticalPathTop;
    /** Cache outcome: tasks restored (`cacheHits`) and the total with a cache outcome (`cacheableCount` = hits + ran). No-status tasks count for neither. */
    private computeCacheStats;
    /**
     * The ids of tasks that failed during the run, slowest first, for the GitHub Actions
     * summary's failed-tasks list. Continuous tasks and tasks without a complete window are
     * excluded (a failed task ran to a non-zero exit, so it has both timestamps). Duration
     * orders the list but isn't shown — for a failure, which task failed is what matters.
     */
    private computeFailedTasks;
    /** The structured performance summary, or `null` when no discrete task timings were recorded. */
    summary(): PerformanceSummary | null;
}
/**
 * Union a set of `[start, end]` intervals into an ordered, non-overlapping set, e.g.
 * `[[1, 3], [2, 5]]` → `[[1, 5]]`. Sort by start, then sweep once: each interval
 * either extends the previous merged one (if it overlaps or touches it) or begins a
 * new one.
 */
export declare function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]>;
/** Total time [a, b] overlaps the given (unsorted, possibly overlapping) intervals. */
export declare function overlap(a: number, b: number, intervals: Array<[number, number]>): number;
/**
 * Coordinator hashing wall-clock that ran *before* the first task started — the run
 * window (first task start → last task end) would otherwise miss it. Matters on a
 * cached run where hashing dominates but the tasks restore in milliseconds.
 *
 * `hashWindows` are absolute `[start, end]` spans from nx's `hash*` perf measures.
 */
export declare function preDispatchHashTime(firstTaskStart: number, hashWindows: Array<[number, number]>): number;
/**
 * The occupancy timeline (contiguous {@link Timespan}s) — single source of truth for
 * slot contention. A `parallelism: false` task occupies the whole pool. Integrates
 * over time rather than sampling one instant, so it's robust to when tasks hand off.
 *
 * Builds it via a delta sweep: each task bumps a counter up at its start and down at
 * its end, then we walk the sorted boundaries accumulating the running totals into one
 * timespan per gap.
 */
export declare function buildTimespans(timed: TimedTask[], eligible: Map<string, number>, parallel: number): Timespan[];
