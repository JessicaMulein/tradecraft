"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaticRunManyTerminalOutputLifeCycle = void 0;
const output_1 = require("../../utils/output");
const utils_1 = require("../utils");
const formatting_utils_1 = require("./formatting-utils");
/**
 * The following life cycle's outputs are static, meaning no previous content
 * is rewritten or modified as new outputs are added. It is therefore intended
 * for use in CI environments.
 *
 * For the common case of a user executing a command on their local machine,
 * the dynamic equivalent of this life cycle is usually preferable.
 */
class StaticRunManyTerminalOutputLifeCycle {
    constructor(projectNames, tasks, args, taskOverrides) {
        this.projectNames = projectNames;
        this.tasks = tasks;
        this.args = args;
        this.taskOverrides = taskOverrides;
        this.failedTasks = [];
        this.cachedTasks = [];
        this.stoppedTasks = [];
        this.allCompletedTasks = new Map();
        this.collapsedTasks = 0;
        /** Stopped tasks that produced output; a batch-stopped task has none. */
        this.stoppedTasksWithOutput = 0;
    }
    startCommand() {
        if (this.tasks.length === 0) {
            return;
        }
        if (this.projectNames.length <= 0) {
            output_1.output.logSingleLine(`No projects with ${(0, formatting_utils_1.formatTargetsAndProjects)(this.projectNames, this.args.targets, this.tasks)} were run`);
            return;
        }
        const bodyLines = this.projectNames.map((affectedProject) => `${output_1.output.dim('-')} ${affectedProject}`);
        const filteredOverrides = Object.entries(this.taskOverrides).filter(
        // Don't print the data passed through from the version subcommand to the publish executor options, it could be quite large and it's an implementation detail.
        ([flag]) => flag !== 'nxReleaseVersionData');
        if (filteredOverrides.length > 0) {
            bodyLines.push('');
            bodyLines.push(`${output_1.output.dim('With additional flags:')}`);
            filteredOverrides
                .map(([flag, value]) => (0, formatting_utils_1.formatFlags)('', flag, value))
                .forEach((arg) => bodyLines.push(arg));
        }
        const title = `Running ${(0, formatting_utils_1.formatTargetsAndProjects)(this.projectNames, this.args.targets, this.tasks)}:`;
        output_1.output.log({
            color: 'cyan',
            title,
            bodyLines,
        });
        output_1.output.addVerticalSeparatorWithoutNewLines('cyan');
    }
    endCommand() {
        output_1.output.addNewline();
        if (this.tasks.length === 0) {
            output_1.output.logSingleLine(`No tasks were run`);
            return;
        }
        // A stopped task was killed mid-flight, so the run did not complete even
        // though nothing outright failed. `didCommandComplete` already treats it
        // that way; reporting "Successfully ran" here would contradict it.
        if (this.failedTasks.length === 0 && this.stoppedTasks.length === 0) {
            output_1.output.addVerticalSeparatorWithoutNewLines('green');
            const bodyLines = this.cachedTasks.length > 0
                ? [
                    output_1.output.dim(`Nx read the output from the cache instead of running the command for ${this.cachedTasks.length} out of ${this.tasks.length} tasks.`),
                ]
                : [];
            bodyLines.push(...this.tasksNotRunSummary());
            bodyLines.push(...this.hiddenOutputHint());
            output_1.output.success({
                title: `Successfully ran ${(0, formatting_utils_1.formatTargetsAndProjects)(this.projectNames, this.args.targets, this.tasks)}`,
                bodyLines,
            });
        }
        else {
            output_1.output.addVerticalSeparatorWithoutNewLines('red');
            const bodyLines = [];
            const skippedTasks = this.skippedTasks();
            if (skippedTasks.length > 0) {
                bodyLines.push(output_1.output.dim('Tasks not run because their dependencies failed or --nx-bail=true:'), '', ...skippedTasks.map((task) => `${output_1.output.dim('-')} ${task.id}`), '');
            }
            if (this.stoppedTasks.length > 0) {
                bodyLines.push(output_1.output.dim('Tasks stopped before they finished:'), '', ...this.stoppedTasks.map((task) => `${output_1.output.dim('-')} ${task.id}`), '');
            }
            if (this.failedTasks.length > 0) {
                bodyLines.push(output_1.output.dim('Failed tasks:'), '', ...[...this.failedTasks.values()].map((task) => `${output_1.output.dim('-')} ${task.id}`));
            }
            bodyLines.push(...this.hiddenOutputHint());
            const targets = (0, formatting_utils_1.formatTargetsAndProjects)(this.projectNames, this.args.targets, this.tasks);
            output_1.output.error({
                title: this.failedTasks.length > 0
                    ? `Running ${targets} failed`
                    : `Running ${targets} did not complete`,
                bodyLines,
            });
        }
    }
    /**
     * Tasks with a `skipped` status are never reported through `endTasks`, so
     * they are derived by subtracting everything that did complete.
     */
    skippedTasks() {
        return this.tasks.filter((t) => !this.allCompletedTasks.has(t.id));
    }
    /**
     * Whether this run prints every task's output in full rather than collapsing
     * the ones that succeeded.
     */
    get printsFullOutput() {
        return (0, output_1.printsFullTaskOutput)(this.args);
    }
    /**
     * Tells the reader that output was withheld, so a task that succeeded while
     * printing something worth reading is not silently swallowed.
     */
    hiddenOutputHint() {
        const withheld = [];
        if (this.collapsedTasks > 0) {
            withheld.push(`${this.collapsedTasks} successful ${this.collapsedTasks === 1 ? 'task' : 'tasks'}`);
        }
        // A stopped task's partial output is what diagnoses a hang, and it is
        // dropped by default, so say so even when nothing collapsed.
        if (this.stoppedTasksWithOutput > 0) {
            withheld.push(`${this.stoppedTasksWithOutput} stopped ${this.stoppedTasksWithOutput === 1 ? 'task' : 'tasks'}`);
        }
        if (this.printsFullOutput || withheld.length === 0) {
            return [];
        }
        const total = this.collapsedTasks + this.stoppedTasksWithOutput;
        return [
            '',
            `${output_1.output.dim(`Output of ${withheld.join(' and ')} ${total === 1 && withheld.length === 1 ? 'was' : 'were'} not shown. Run with`)} --verbose ${output_1.output.dim('or')} --output-style=static ${output_1.output.dim('to see it.')}`,
        ];
    }
    /**
     * Tasks that never produced output worth printing are summarized as counts,
     * with their names available behind --verbose.
     */
    tasksNotRunSummary() {
        const skippedTasks = this.skippedTasks();
        const counts = [];
        if (skippedTasks.length > 0) {
            counts.push(`${skippedTasks.length} skipped`);
        }
        if (this.stoppedTasks.length > 0) {
            counts.push(`${this.stoppedTasks.length} stopped`);
        }
        if (counts.length === 0) {
            return [];
        }
        const lines = [output_1.output.dim(counts.join(', '))];
        if (this.printsFullOutput) {
            lines.push('', ...[...skippedTasks, ...this.stoppedTasks].map((task) => `${output_1.output.dim('-')} ${task.id}`));
        }
        return lines;
    }
    endTasks(taskResults) {
        for (let t of taskResults) {
            this.allCompletedTasks.set(t.task.id, t.task);
            if (t.status === 'failure') {
                this.failedTasks.push(t.task);
            }
            else if (t.status === 'stopped') {
                this.stoppedTasks.push(t.task);
                // A batch-stopped task is reported with no output at all, so counting
                // it would have the hint promise something --verbose cannot show.
                if (t.terminalOutput) {
                    this.stoppedTasksWithOutput++;
                }
            }
            else if (t.status === 'local-cache') {
                this.cachedTasks.push(t.task);
            }
            else if (t.status === 'local-cache-kept-existing') {
                this.cachedTasks.push(t.task);
            }
            else if (t.status === 'remote-cache') {
                this.cachedTasks.push(t.task);
            }
        }
    }
    printTaskTerminalOutput(task, taskStatus, terminalOutput) {
        const args = (0, utils_1.getPrintableCommandArgsForTask)(task);
        if (this.printsFullOutput || taskStatus === 'failure') {
            // A stopped task was killed part way through; under --verbose or
            // --output-style=static its partial output is shown, which is what
            // diagnoses a hang. It is dropped on the default path below.
            output_1.output.logCommandOutput(args.join(' '), taskStatus, terminalOutput);
            return;
        }
        // Named in the end of run summary instead; output not shown by default.
        if (taskStatus === 'skipped' || taskStatus === 'stopped') {
            return;
        }
        this.collapsedTasks++;
        output_1.output.logCommandSummary(args.join(' '), taskStatus);
    }
}
exports.StaticRunManyTerminalOutputLifeCycle = StaticRunManyTerminalOutputLifeCycle;
