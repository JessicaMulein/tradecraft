"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports._setEnvForwardTimeoutMs = _setEnvForwardTimeoutMs;
exports.handleClientEnv = handleClientEnv;
const get_plugins_1 = require("../../project-graph/plugins/get-plugins");
const daemon_environment_1 = require("../client/daemon-environment");
const logger_1 = require("../logger");
const project_graph_incremental_recomputation_1 = require("./project-graph-incremental-recomputation");
// Bounds the wait for worker acknowledgements so a wedged worker cannot hold
// every env-carrying client message for the 10-minute plugin-hook timeout. A
// healthy worker applies the env synchronously and acks in milliseconds.
let envForwardTimeoutMs = 10_000;
// Test seam: the production timeout would stall the suite.
function _setEnvForwardTimeoutMs(ms) {
    envForwardTimeoutMs = ms;
}
let inFlightApply;
/**
 * Applies an env-carrying client message to the daemon. Must be awaited
 * before dispatching the message's handler: plugin workers key their disk
 * caches on their own process env, so a graph request must not reach a worker
 * whose env still reflects the previous client.
 */
async function handleClientEnv(env) {
    // A client whose env matches one an in-flight apply already wrote to
    // process.env sees zero changed keys, yet the graph cache is only discarded
    // once that apply's forwarding completes. Wait for it so such a client
    // cannot be served the graph computed under the previous env.
    while (inFlightApply) {
        await inFlightApply;
    }
    const graphEnvBefore = (0, daemon_environment_1.normalizeDaemonEnvironmentForGraph)(process.env);
    const previousClientEnv = (0, daemon_environment_1.getAppliedDaemonClientEnv)()?.env;
    const changedEnvKeys = (0, daemon_environment_1.applyDaemonEnvFromClient)(env);
    if (changedEnvKeys.length === 0) {
        return;
    }
    // Runtime changes always reach the workers, but only changes that survive
    // graph normalization (e.g. Yarn Berry's per-invocation BERRY_BIN_FOLDER
    // does not) invalidate the computed graph.
    const graphChangedKeys = new Set([
        ...(0, daemon_environment_1.getChangedEnvKeys)(graphEnvBefore, (0, daemon_environment_1.normalizeDaemonEnvironmentForGraph)(process.env)),
        ...(previousClientEnv
            ? (0, daemon_environment_1.getChangedEnvKeys)((0, daemon_environment_1.normalizeDaemonEnvironmentForGraph)(previousClientEnv), (0, daemon_environment_1.normalizeDaemonEnvironmentForGraph)(env))
            : []),
    ]);
    if (graphChangedKeys.size > 0) {
        logger_1.serverLogger.log(`Graph recompute necessary due to env variable refresh. Changed keys: ${[
            ...graphChangedKeys,
        ].join(', ')}`);
    }
    else {
        logger_1.serverLogger.log(`Env variable refresh changed only runtime values (${changedEnvKeys.join(', ')}); graph identity is unchanged, keeping the cached graph.`);
    }
    const apply = applyEnvChange(env, graphChangedKeys.size > 0);
    inFlightApply = apply;
    try {
        await apply;
    }
    finally {
        if (inFlightApply === apply) {
            inFlightApply = undefined;
        }
    }
}
async function applyEnvChange(env, invalidateGraph) {
    await forwardEnvToPluginWorkers(env);
    if (!invalidateGraph) {
        return;
    }
    // Discarding the cached graph makes the next request recompute under the
    // new env, and chains any in-flight compute (started under the old env) to
    // that successor.
    (0, project_graph_incremental_recomputation_1.invalidateGraphCache)();
}
// Covers committed workers and an in-flight load, whose workers forked under
// the previous env before this apply and would otherwise keep it for good. A
// load started after this needs no forwarding: its workers fork with the
// daemon's already-updated process.env. Each forward settles rather than
// rejects so one dead worker (or a failed load) cannot fail every env-carrying
// client message. Timing out is safe: each worker socket delivers the already
// sent env update before any later graph message, and the plugin cache write
// guard drops a pass the update lands in the middle of.
async function forwardEnvToPluginWorkers(env) {
    let timer;
    const timedOut = await Promise.race([
        forwardEnvToPluginWorkersUnbounded(env).then(() => false),
        new Promise((resolve) => {
            timer = setTimeout(() => resolve(true), envForwardTimeoutMs);
            timer.unref();
        }),
    ]).finally(() => clearTimeout(timer));
    if (timedOut) {
        logger_1.serverLogger.log(`Timed out forwarding the new env to plugin workers after ${envForwardTimeoutMs}ms; continuing without their acknowledgement.`);
    }
}
async function forwardEnvToPluginWorkersUnbounded(env) {
    const pluginsPromise = (0, get_plugins_1.getPluginsIfLoadedOrLoading)();
    if (!pluginsPromise) {
        return;
    }
    let plugins;
    try {
        plugins = await pluginsPromise;
    }
    catch {
        // The load failed, so there are no workers to forward to.
        return;
    }
    await Promise.all(plugins.map((plugin) => plugin.setWorkerEnv?.(env)?.catch((e) => {
        logger_1.serverLogger.log(`Failed to forward env to plugin worker "${plugin.name}": ${e.message}`);
    })));
}
