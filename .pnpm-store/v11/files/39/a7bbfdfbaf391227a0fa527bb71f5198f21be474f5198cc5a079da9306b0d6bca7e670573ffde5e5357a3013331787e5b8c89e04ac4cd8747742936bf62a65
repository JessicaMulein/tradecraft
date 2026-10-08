"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleOutputsChanges = void 0;
exports.getOutputsWatcherTerminalError = getOutputsWatcherTerminalError;
const logger_1 = require("../logger");
const dotenv_graph_changes_1 = require("./dotenv-graph-changes");
const outputs_tracking_1 = require("./outputs-tracking");
const project_graph_incremental_recomputation_1 = require("./project-graph-incremental-recomputation");
let outputsWatcherError;
let outputsWatcherTerminalError;
/**
 * The error a native outputs watcher failure delivered, if one has. Such an
 * error is terminal (the native watch loop exits after delivering it), so the
 * gitignored dotenv edits only that watcher reports stop arriving and a warm
 * graph would go stale silently. The server fails requests closed on it, like
 * a workspace watcher error.
 */
function getOutputsWatcherTerminalError() {
    return outputsWatcherTerminalError;
}
const handleOutputsChanges = async (err, changeEvents) => {
    try {
        if (err || !changeEvents || !changeEvents.length) {
            let error = typeof err === 'string' ? new Error(err) : err;
            logger_1.serverLogger.watcherLog('Unexpected outputs watcher error', error.message);
            console.error(error);
            outputsWatcherError = error;
            (0, outputs_tracking_1.disableOutputsTracking)();
            if (err) {
                // A native error is terminal: the watch loop has exited, so the
                // gitignored dotenv edits only this watcher reports stop arriving and
                // the graph invalidation below can never run again. Fail requests
                // closed like a workspace watcher error rather than serving a graph
                // that silently goes stale. The original error is preserved so an
                // inotify_add_watch failure still makes the client disable the daemon
                // and rebuild without it.
                outputsWatcherTerminalError = error;
            }
            return;
        }
        // A dotenv change that a task chain loads must refresh the graph so
        // createNodes re-resolves config reading process.env. This runs above the
        // outputsWatcherError guard: the two concerns are independent, and a
        // disabled outputs tracker must not leave the graph stale on a dotenv edit.
        // A change to a file the workspace watcher tracks already schedules a
        // recomputation that reads the new content; invalidating for it here too
        // would discard that recomputation at commit and force a second one. It is
        // queued instead of dropped: the two watchers deliver independently, so a
        // computation already in flight may have read the file before the edit,
        // and only the pre-serve replay can prove that. The committed file map
        // approximates what the watcher tracks: a file it does not know is either
        // gitignored (never reaches the workspace watcher, so it needs the
        // invalidation) or created since the last recompute (the watcher handles
        // it; the extra invalidation is fail-safe). Its own try/catch so a fault
        // here cannot trip the outputs-tracking kill switch below, which belongs
        // to an unrelated subsystem, and it fails safe by invalidating: a stale
        // graph on a dotenv edit is the bug this prevents.
        try {
            const { invalidating, unclassified } = (0, dotenv_graph_changes_1.classifyDotEnvChanges)(changeEvents, project_graph_incremental_recomputation_1.currentProjectGraph);
            const generation = (0, project_graph_incremental_recomputation_1.getRecomputationGeneration)();
            (0, dotenv_graph_changes_1.queuePendingDotEnvEvents)(unclassified.map((event) => event.path), generation);
            const knownInvalidating = invalidating.filter((path) => (0, project_graph_incremental_recomputation_1.isKnownWorkspaceFile)(path));
            (0, dotenv_graph_changes_1.queuePendingDotEnvEvents)(knownInvalidating, generation);
            if (knownInvalidating.length < invalidating.length) {
                (0, project_graph_incremental_recomputation_1.invalidateGraphCache)();
            }
        }
        catch (e) {
            logger_1.serverLogger.watcherLog('Failed to evaluate dotenv changes for graph invalidation; invalidating the graph cache to be safe', e instanceof Error ? e.message : String(e));
            console.error(e);
            (0, project_graph_incremental_recomputation_1.invalidateGraphCache)();
        }
        if (outputsWatcherError) {
            return;
        }
        logger_1.serverLogger.watcherLog('Processing file changes in outputs');
        (0, outputs_tracking_1.processFileChangesInOutputs)(changeEvents);
    }
    catch (err) {
        logger_1.serverLogger.watcherLog(`Unexpected outputs watcher error`, err.message);
        console.error(err);
        outputsWatcherError = err;
        (0, outputs_tracking_1.disableOutputsTracking)();
    }
};
exports.handleOutputsChanges = handleOutputsChanges;
