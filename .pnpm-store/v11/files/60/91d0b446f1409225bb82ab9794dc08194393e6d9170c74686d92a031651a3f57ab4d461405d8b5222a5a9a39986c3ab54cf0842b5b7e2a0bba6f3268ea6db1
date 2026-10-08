import type { BatchInfo, PerformanceSummaryPayload } from '../../native';
import { TaskGraph } from '../../config/task-graph';
import { LifeCycle, TaskResult } from '../life-cycle';
import { type PerformanceLifeCycleOptions, type PerformanceSummary } from './performance-analysis';
/**
 * Measures how much wall-clock a run loses to parallelism contention versus its
 * critical-path floor, and reports it at the end of a run. Added on every run by
 * `constructLifeCycles`, but only emitted where the report is flushed (the CLI
 * `invokeTasksRunner` path) — the programmatic `init-tasks-runner` path collects
 * timings but never displays them.
 *
 * overhead = runDuration − criticalPathDuration, split by CAUSE off the occupancy
 * timeline: slot-queued time (recoverable by parallelism / machines) versus
 * coordinator time (hashing, scheduling, continuous-dep waits).
 *
 * Scope: discrete tasks only. Continuous tasks (no end time) are excluded; a
 * discrete task's wait for a continuous dependency to start is eligibility, not
 * contention.
 */
export declare class PerformanceLifeCycle implements LifeCycle {
    private readonly taskGraph;
    private readonly options;
    private readonly timings;
    /** taskId → terminal status (cache hit vs ran), for the cache summary. */
    private readonly statuses;
    /** taskId → other tasks in its batch (batches run sequentially). */
    private readonly batchSiblings;
    /** Resolved `--parallel`, set by the runner via {@link startCommand}'s second arg once the thread pool is sized. */
    private parallel;
    constructor(taskGraph: TaskGraph, options?: PerformanceLifeCycleOptions);
    /**
     * The runner passes the resolved `--parallel` (getThreadPoolSize's `discrete`) as the
     * second arg; the first (thread count) is for the TUI and ignored here.
     */
    startCommand(_threadCount?: number, parallel?: number): void;
    registerRunningBatch(_batchId: string, batchInfo: BatchInfo): void;
    endTasks(taskResults: TaskResult[]): void;
    private entry;
    /** Analyze the collected timings into a structured summary, or `null` when no discrete task timings were recorded. */
    getSummary(): PerformanceSummary | null;
}
/**
 * Structured report for the TUI's exit-countdown popup, or null when nothing to
 * show. Clears the active lifecycle so the popup owns the report and a later terminal
 * flush can't re-print it. Best-effort: a throw degrades to null.
 */
export declare function getPerformanceSummaryPayload(): PerformanceSummaryPayload | null;
/**
 * The performance report payload for `endCommand`'s TUI exit popup, or undefined when the
 * report should instead be flushed to the terminal — non-TUI runs, or a single task (the
 * complement of run-command's flush gate). Reading it consumes the report so the flush
 * won't reprint it.
 */
export declare function getPerformanceReport(taskCount: number): PerformanceSummaryPayload | undefined;
/**
 * Print the performance report (if enabled) after the run summary. Called once the
 * terminal is restored, so it appears in every output mode including the TUI.
 */
export declare function flushPerformanceReport(): void;
