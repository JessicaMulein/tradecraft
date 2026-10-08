"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runDiscreteTasks = runDiscreteTasks;
exports.runContinuousTasks = runContinuousTasks;
const run_command_1 = require("./run-command");
const invoke_runner_terminal_output_life_cycle_1 = require("./life-cycles/invoke-runner-terminal-output-life-cycle");
const dotenv_1 = require("../utils/dotenv");
const life_cycle_1 = require("./life-cycle");
const task_orchestrator_1 = require("./task-orchestrator");
const create_task_hasher_1 = require("../hasher/create-task-hasher");
const client_1 = require("../daemon/client/client");
const shared_running_task_1 = require("./running-tasks/shared-running-task");
const task_results_life_cycle_1 = require("./life-cycles/task-results-life-cycle");
async function createOrchestrator(tasks, projectGraph, fullTaskGraph, nxJson, lifeCycle) {
    (0, dotenv_1.loadRootEnvFiles)();
    const invokeRunnerTerminalLifecycle = new invoke_runner_terminal_output_life_cycle_1.InvokeRunnerTerminalOutputLifeCycle(tasks);
    const taskResultsLifecycle = new task_results_life_cycle_1.TaskResultsLifeCycle();
    const compositedLifeCycle = new life_cycle_1.CompositeLifeCycle([
        ...(0, run_command_1.constructLifeCycles)(invokeRunnerTerminalLifecycle, fullTaskGraph, nxJson),
        taskResultsLifecycle,
        lifeCycle,
    ]);
    const { runnerOptions: options } = (0, run_command_1.getRunner)({}, nxJson);
    let hasher = (0, create_task_hasher_1.createTaskHasher)(projectGraph, nxJson, options);
    const taskGraph = {
        roots: tasks.map((task) => task.id),
        tasks: tasks.reduce((acc, task) => {
            acc[task.id] = task;
            return acc;
        }, {}),
        dependencies: tasks.reduce((acc, task) => {
            acc[task.id] = [];
            return acc;
        }, {}),
        continuousDependencies: tasks.reduce((acc, task) => {
            acc[task.id] = [];
            return acc;
        }, {}),
    };
    const nxArgs = {
        ...options,
        parallel: tasks.length,
        lifeCycle: compositedLifeCycle,
    };
    (0, run_command_1.setEnvVarsBasedOnArgs)(nxArgs, true);
    const orchestrator = new task_orchestrator_1.TaskOrchestrator(hasher, null, tasks, projectGraph, taskGraph, nxJson, nxArgs, false, client_1.daemonClient, undefined, fullTaskGraph);
    await orchestrator.init();
    orchestrator.processAllScheduledTasks();
    return orchestrator;
}
// Nothing awaits the dispose chains below, so an unhandled rejection would take
// down a long-lived agent process.
function logDisposeFailure(e) {
    console.error('Failed to dispose the task orchestrator:', e);
}
async function runDiscreteTasks(tasks, projectGraph, fullTaskGraph, nxJson, lifeCycle) {
    const orchestrator = await createOrchestrator(tasks, projectGraph, fullTaskGraph, nxJson, lifeCycle);
    let groupId = 0;
    let nextBatch = orchestrator.nextBatch();
    const batchResults = [];
    /**
     * Set of task ids that were part of batches
     */
    const batchTasks = new Set();
    while (nextBatch) {
        for (const task in nextBatch.taskGraph.tasks) {
            batchTasks.add(task);
        }
        batchResults.push(orchestrator.applyFromCacheOrRunBatch(true, nextBatch, groupId++));
        nextBatch = orchestrator.nextBatch();
    }
    const discreteTasks = tasks.filter((task) => !batchTasks.has(task.id));
    // Bulk-resolve every discrete task's cache state in one shot —
    // single SQL call plus parallel remote retrievals. Batches kicked
    // off above continue running concurrently while we await this.
    const cacheHits = await orchestrator.resolveCachedTasks(true, discreteTasks, groupId++);
    const cacheHitsById = new Map(cacheHits.map((h) => [h.task.id, h]));
    const taskResults = discreteTasks.map(async (task) => {
        const hit = cacheHitsById.get(task.id);
        if (hit)
            return [hit];
        return [await orchestrator.runTaskDirectly(true, task, groupId++)];
    });
    const results = [...batchResults, ...taskResults];
    // Callers like Nx Cloud agents create an orchestrator per invocation in a
    // long-lived process; release its process-level listeners once all tasks
    // settle, otherwise every invocation's orchestrator stays reachable forever.
    // Not awaited, so callers keep consuming handles as they settle; the forked
    // runner's exit handler still reaps children until dispose() runs.
    Promise.allSettled(results)
        .then(() => orchestrator.dispose())
        .catch(logDisposeFailure);
    return results;
}
async function runContinuousTasks(tasks, projectGraph, fullTaskGraph, nxJson, lifeCycle) {
    const orchestrator = await createOrchestrator(tasks, projectGraph, fullTaskGraph, nxJson, lifeCycle);
    const runningTasks = tasks.reduce((current, task, index) => {
        current[task.id] = orchestrator.startContinuousTask(task, index);
        return current;
    }, {});
    // Unlike runDiscreteTasks, this must resolve at task start: callers keep
    // the RunningTask handles to kill later, so disposal has to be deferred
    // until every task actually exits.
    Promise.allSettled(Object.entries(runningTasks).map(async ([taskId, promise]) => {
        const runningTask = await promise;
        // A shared task is owned by another nx process; this orchestrator has
        // no child to protect for it, so disposal does not wait on it.
        if (runningTask instanceof shared_running_task_1.SharedRunningTask) {
            return;
        }
        await orchestrator.waitForContinuousTaskExit(taskId);
    }))
        .then(() => orchestrator.dispose())
        .catch(logDisposeFailure);
    return runningTasks;
}
