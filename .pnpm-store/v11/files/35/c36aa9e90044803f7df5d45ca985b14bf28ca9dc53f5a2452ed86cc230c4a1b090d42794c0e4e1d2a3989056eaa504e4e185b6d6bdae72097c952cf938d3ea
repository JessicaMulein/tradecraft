"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PerformanceLifeCycle = void 0;
exports.getPerformanceSummaryPayload = getPerformanceSummaryPayload;
exports.getPerformanceReport = getPerformanceReport;
exports.flushPerformanceReport = flushPerformanceReport;
const node_fs_1 = require("node:fs");
const performance_report_1 = require("./performance-report");
const is_tui_enabled_1 = require("../is-tui-enabled");
const performance_analysis_1 = require("./performance-analysis");
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
class PerformanceLifeCycle {
    constructor(taskGraph, options = {}) {
        this.taskGraph = taskGraph;
        this.options = options;
        this.timings = new Map();
        /** taskId → terminal status (cache hit vs ran), for the cache summary. */
        this.statuses = new Map();
        /** taskId → other tasks in its batch (batches run sequentially). */
        this.batchSiblings = new Map();
        /** Resolved `--parallel`, set by the runner via {@link startCommand}'s second arg once the thread pool is sized. */
        this.parallel = 1;
        activePerformanceLifeCycle = this;
    }
    // === Lifecycle hooks (called by the orchestrator as the run progresses) ===
    /**
     * The runner passes the resolved `--parallel` (getThreadPoolSize's `discrete`) as the
     * second arg; the first (thread count) is for the TUI and ignored here.
     */
    startCommand(_threadCount, parallel) {
        if (parallel != null) {
            this.parallel = parallel;
        }
    }
    registerRunningBatch(_batchId, batchInfo) {
        for (const id of batchInfo.taskIds) {
            this.batchSiblings.set(id, batchInfo.taskIds.filter((other) => other !== id));
        }
    }
    endTasks(taskResults) {
        // Called incrementally (per group/batch); accumulate so the last call sees every timing.
        for (const { task, status } of taskResults) {
            const entry = this.entry(task.id);
            // `!= null`, not truthiness: synthetic/relative timelines can legitimately start at 0.
            if (task.startTime != null) {
                entry.startTime = task.startTime;
            }
            if (task.endTime != null) {
                entry.endTime = task.endTime;
            }
            if (status != null) {
                this.statuses.set(task.id, status);
            }
        }
    }
    entry(taskId) {
        let entry = this.timings.get(taskId);
        if (!entry) {
            entry = { continuous: this.taskGraph.tasks[taskId]?.continuous ?? false };
            this.timings.set(taskId, entry);
        }
        return entry;
    }
    /** Analyze the collected timings into a structured summary, or `null` when no discrete task timings were recorded. */
    getSummary() {
        return new performance_analysis_1.PerformanceAnalysis(this.timings, this.statuses, this.taskGraph, this.batchSiblings, this.parallel, this.options).summary();
    }
}
exports.PerformanceLifeCycle = PerformanceLifeCycle;
/** The most recently constructed performance lifecycle, read after the run. Cleared once consumed. */
let activePerformanceLifeCycle = null;
/**
 * Structured report for the TUI's exit-countdown popup, or null when nothing to
 * show. Clears the active lifecycle so the popup owns the report and a later terminal
 * flush can't re-print it. Best-effort: a throw degrades to null.
 */
function getPerformanceSummaryPayload() {
    const lifeCycle = activePerformanceLifeCycle;
    if (!lifeCycle) {
        return null;
    }
    try {
        const summary = lifeCycle.getSummary();
        if (!summary) {
            return null;
        }
        activePerformanceLifeCycle = null;
        return (0, performance_report_1.buildExitSummaryPayload)(summary);
    }
    catch (e) {
        // Best-effort: the report must never break the run. Surface the cause only under
        // verbose logging so a missing report stays debuggable.
        if (process.env.NX_VERBOSE_LOGGING === 'true') {
            console.error(e);
        }
        return null;
    }
}
/**
 * The performance report payload for `endCommand`'s TUI exit popup, or undefined when the
 * report should instead be flushed to the terminal — non-TUI runs, or a single task (the
 * complement of run-command's flush gate). Reading it consumes the report so the flush
 * won't reprint it.
 */
function getPerformanceReport(taskCount) {
    if (!(0, is_tui_enabled_1.isTuiEnabled)() || taskCount <= 1) {
        return undefined;
    }
    return getPerformanceSummaryPayload() ?? undefined;
}
/**
 * Print the performance report (if enabled) after the run summary. Called once the
 * terminal is restored, so it appears in every output mode including the TUI.
 */
function flushPerformanceReport() {
    const lifeCycle = activePerformanceLifeCycle;
    activePerformanceLifeCycle = null;
    if (!lifeCycle) {
        return;
    }
    // Cosmetic report; a throw (e.g. EPIPE to a closed pipe) must never mask the
    // real task error or fail an otherwise successful run.
    try {
        const summary = lifeCycle.getSummary();
        if (!summary) {
            return;
        }
        // restore_terminal cooks the terminal back post-TUI, so console.log's plain \n
        // renders fine; it also supplies the single trailing newline formatReport omits.
        console.log((0, performance_report_1.formatReport)(summary));
        // In GitHub Actions, also append the report to the job summary page — the same stats
        // as above, led by the run's outcome (a failed-tasks list, or a success line).
        // Independent of the console.log above so neither masks the other.
        writePerformanceReportToGitHubActions(summary);
    }
    catch (e) {
        // Best-effort report; never let it affect the run's exit behavior. Surface the
        // cause only under verbose logging.
        if (process.env.NX_VERBOSE_LOGGING === 'true') {
            console.error(e);
        }
    }
}
/**
 * Append the performance report to the GitHub Actions job summary page when running in
 * Actions (`$GITHUB_STEP_SUMMARY` is set there and nowhere else). No-op otherwise. The
 * Markdown is rendered below the guard, so non-CI runs don't pay to format a report
 * nothing reads. Best-effort: a write failure must never affect the run.
 *
 * Skipped for a nested run (one nx command invoked by another nx task's command), so only
 * the outermost run writes to the summary. Nx sets `NX_TASK_TARGET_PROJECT` on every task's
 * environment, which a nested nx inherits; its absence marks the top-level invocation (the
 * same "NX is already running" signal `nx exec` uses).
 */
function writePerformanceReportToGitHubActions(summary) {
    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (process.env.GITHUB_ACTIONS !== 'true' ||
        !summaryPath ||
        process.env.NX_TASK_TARGET_PROJECT) {
        return;
    }
    try {
        const report = (0, performance_report_1.formatReportMarkdown)(summary, currentNxCommand());
        (0, node_fs_1.appendFileSync)(summaryPath, `${report}\n`);
    }
    catch (e) {
        if (process.env.NX_VERBOSE_LOGGING === 'true') {
            console.error(e);
        }
    }
}
/**
 * The nx command as typed — everything after the nx bin (`process.argv[0]` is node,
 * `[1]` is the bin). Only read on the CLI flush path, where argv is always the real nx
 * invocation, so it identifies the run in the summary heading.
 */
function currentNxCommand() {
    return process.argv.slice(2).join(' ').trim();
}
