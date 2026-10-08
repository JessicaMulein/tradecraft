import { Task } from '../config/task-graph';
import { BatchInfo, BatchStatus, ExternalObject, PerformanceSummaryPayload, TaskResult, TaskStatus as NativeTaskStatus } from '../native';
import { TaskStatus } from './tasks-runner';
/**
 * The result of a completed {@link Task}.
 *
 * Defined as a Rust struct in `packages/nx/src/native/tasks/types.rs` and
 * exposed to TypeScript via NAPI. Re-exported here so existing imports
 * keep working.
 *
 * Task timing information (start and end timestamps) is available
 * on the {@link Task} object itself via {@link Task.startTime} and
 * {@link Task.endTime}.
 */
export type { TaskResult };
/**
 * A map of {@link TaskResult} keyed by the ID of the completed {@link Task}s
 */
export type TaskResults = Record<string, TaskResult>;
export interface TaskMetadata {
    groupId: number;
}
export interface LifeCycle {
    /**
     * @param threadCount total thread-pool size (drives the TUI display)
     * @param parallel resolved `--parallel` (discrete slots), for the performance report
     */
    startCommand?(threadCount?: number, parallel?: number): void | Promise<void>;
    /** @param summary performance report payload for the TUI exit popup (TUI runs only) */
    endCommand?(summary?: PerformanceSummaryPayload): void | Promise<void>;
    scheduleTask?(task: Task): void | Promise<void>;
    /**
     * @deprecated use startTasks
     *
     * startTask won't be supported after Nx 14 is released.
     */
    startTask?(task: Task): void;
    /**
     * @deprecated use endTasks
     *
     * endTask won't be supported after Nx 14 is released.
     */
    endTask?(task: Task, code: number): void;
    startTasks?(task: Task[], metadata: TaskMetadata): void | Promise<void>;
    endTasks?(taskResults: TaskResult[], metadata: TaskMetadata): void | Promise<void>;
    printTaskTerminalOutput?(task: Task, status: TaskStatus, output: string): void;
    registerRunningTask?(taskId: string, ptyHandles: ExternalObject<[any, any, any]>): void;
    registerRunningTaskWithEmptyParser?(taskId: string): void;
    appendTaskOutput?(taskId: string, output: string, isPtyTask: boolean): void;
    setTaskStatus?(taskId: string, status: NativeTaskStatus): void;
    setTaskTiming?(taskId: string, startTime: number, endTime: number): void;
    registerForcedShutdownCallback?(callback: () => void): void;
    setEstimatedTaskTimings?(timings: Record<string, number>): void;
    registerRunningBatch?(batchId: string, batchInfo: BatchInfo): void;
    appendBatchOutput?(batchId: string, output: string): void;
    setBatchStatus?(batchId: string, status: BatchStatus): void;
    /**
     * Set a clickable Nx Cloud link in the terminal UI: `label` is the text
     * shown, `url` is opened when it's clicked. Implemented by the TUI lifecycle;
     * callers (e.g. the Nx Cloud client) should feature-detect it.
     */
    setCloudLink?(label: string, url: string): void | Promise<void>;
}
export declare class CompositeLifeCycle implements LifeCycle {
    private readonly lifeCycles;
    constructor(lifeCycles: LifeCycle[]);
    startCommand(threadCount?: number, parallel?: number): Promise<void>;
    endCommand(summary?: PerformanceSummaryPayload): Promise<void>;
    scheduleTask(task: Task): Promise<void>;
    startTask(task: Task): void;
    endTask(task: Task, code: number): void;
    startTasks(tasks: Task[], metadata: TaskMetadata): Promise<void>;
    endTasks(taskResults: TaskResult[], metadata: TaskMetadata): Promise<void>;
    printTaskTerminalOutput(task: Task, status: TaskStatus, output: string): void;
    registerRunningTask(taskId: string, ptyHandles: ExternalObject<[any, any, any]>): void;
    registerRunningTaskWithEmptyParser(taskId: string): void;
    appendTaskOutput(taskId: string, output: string, isPtyTask: boolean): void;
    setTaskStatus(taskId: string, status: NativeTaskStatus): void;
    setTaskTiming(taskId: string, startTime: number, endTime: number): void;
    registerForcedShutdownCallback(callback: () => void): void;
    setEstimatedTaskTimings(timings: Record<string, number>): void;
    registerRunningBatch(batchId: string, batchInfo: BatchInfo): void;
    appendBatchOutput(batchId: string, output: string): void;
    setBatchStatus(batchId: string, status: BatchStatus): void;
    setCloudLink(label: string, url: string): Promise<void>;
}
