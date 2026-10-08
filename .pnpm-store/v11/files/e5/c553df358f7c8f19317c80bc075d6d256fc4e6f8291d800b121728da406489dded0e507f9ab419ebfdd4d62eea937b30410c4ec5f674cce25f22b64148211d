import { TaskStatus } from '../tasks-runner';
import type { LifeCycle, TaskResult } from '../life-cycle';
import { Task } from '../../config/task-graph';
/**
 * The following life cycle's outputs are static, meaning no previous content
 * is rewritten or modified as new outputs are added. It is therefore intended
 * for use in CI environments.
 *
 * For the common case of a user executing a command on their local machine,
 * the dynamic equivalent of this life cycle is usually preferable.
 */
export declare class StaticRunManyTerminalOutputLifeCycle implements LifeCycle {
    private readonly projectNames;
    private readonly tasks;
    private readonly args;
    private readonly taskOverrides;
    failedTasks: Task[];
    cachedTasks: Task[];
    stoppedTasks: Task[];
    allCompletedTasks: Map<string, Task>;
    private collapsedTasks;
    /** Stopped tasks that produced output; a batch-stopped task has none. */
    private stoppedTasksWithOutput;
    constructor(projectNames: string[], tasks: Task[], args: {
        targets?: string[];
        configuration?: string;
        verbose?: boolean;
        outputStyle?: string;
    }, taskOverrides: any);
    startCommand(): void;
    endCommand(): void;
    /**
     * Tasks with a `skipped` status are never reported through `endTasks`, so
     * they are derived by subtracting everything that did complete.
     */
    private skippedTasks;
    /**
     * Whether this run prints every task's output in full rather than collapsing
     * the ones that succeeded.
     */
    private get printsFullOutput();
    /**
     * Tells the reader that output was withheld, so a task that succeeded while
     * printing something worth reading is not silently swallowed.
     */
    private hiddenOutputHint;
    /**
     * Tasks that never produced output worth printing are summarized as counts,
     * with their names available behind --verbose.
     */
    private tasksNotRunSummary;
    endTasks(taskResults: TaskResult[]): void;
    printTaskTerminalOutput(task: Task, taskStatus: TaskStatus, terminalOutput: string): void;
}
