"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadingMethod = void 0;
exports.resetIsolationFallbackForTesting = resetIsolationFallbackForTesting;
exports.getPlugins = getPlugins;
exports.getPluginsSeparated = getPluginsSeparated;
exports.getOnlyDefaultPlugins = getOnlyDefaultPlugins;
exports.getPluginsIfLoadedOrLoading = getPluginsIfLoadedOrLoading;
exports.cleanupPlugins = cleanupPlugins;
exports.reasonToError = reasonToError;
const node_path_1 = require("node:path");
const angular_json_1 = require("../../adapter/angular-json");
const file_hasher_1 = require("../../hasher/file-hasher");
const workspace_root_1 = require("../../utils/workspace-root");
const in_process_loader_1 = require("./in-process-loader");
const isolation_1 = require("./isolation");
const resolve_plugin_1 = require("./resolve-plugin");
const enabled_1 = require("./isolation/enabled");
const isolated_plugin_1 = require("./isolation/isolated-plugin");
const sandbox_socket_hint_1 = require("../../daemon/sandbox-socket-hint");
const is_sandbox_1 = require("../../utils/is-sandbox");
const native_1 = require("../../native");
const output_1 = require("../../utils/output");
const transpiler_1 = require("./transpiler");
/**
 * Stuff for specified NX Plugins.
 */
let currentPluginsConfigurationHash;
let loadedPlugins;
let cachedSeparatedPlugins;
let pendingPluginsPromise;
let cleanupSpecifiedPlugins;
// In-flight separated-plugins load, tagged with its hash. Two roles: a
// concurrent caller for the same set shares this load instead of racing a
// second one, and it gates the cache commit — a load writes the cache only if
// it's still the registered load when it finishes, so a slow older load can't
// clobber a newer one's result (two recomputes can overlap).
let pendingSeparatedPlugins;
/**
 * Set once a worker has been refused in this process, and read by every later
 * plugin: nothing about a second attempt can succeed once the first has been
 * refused for a reason that belongs to the sandbox.
 *
 * It does not stop the spawns of the plugins already in flight. Callers load
 * plugins concurrently, so all of them are past the entry check before the
 * first worker dies; what the latch guarantees is that the advice is printed
 * once rather than once per plugin, and that anything loaded after the refusal
 * skips the worker entirely.
 *
 * Process-scoped rather than persisted: the refusal describes the environment
 * Nx is running in, so it must not follow the workspace into a plain terminal.
 */
let isolationRefusedInThisProcess = false;
/** Exported for tests: the fallback latch is process-scoped by design. */
function resetIsolationFallbackForTesting() {
    isolationRefusedInThisProcess = false;
}
/**
 * Loads a plugin in a worker, falling back to this process when the worker's
 * socket was refused.
 *
 * Isolation is preferred: it is what keeps two plugins with conflicting
 * TypeScript versions or module-level state apart. But a sandbox that has not
 * been told about the Nx socket root refuses the worker's socket, and failing
 * the whole command over that is worse than running the plugins here. The
 * fallback is narrow on purpose. It needs a failure to start or reach the
 * worker, plus either a detectable sandbox or the worker's own EPERM/EACCES
 * exit code under an AI agent — the second arm is what covers an agent whose
 * sandbox sets no variable `isSandbox()` reads. A plugin that loaded and then
 * threw is rethrown, because rerunning it in-process would bury its actual
 * error.
 */
const loadingMethod = async (plugin, root, index) => {
    if (!(0, enabled_1.isIsolationEnabled)() || isolationRefusedInThisProcess) {
        return (0, in_process_loader_1.loadNxPlugin)(plugin, root, index);
    }
    const [isolatedPlugin, cleanup] = await (0, isolation_1.loadIsolatedNxPlugin)(plugin, root, index);
    // Awaited here rather than handed on, because the worker failure surfaces on
    // this promise and the fallback has to happen before the caller sees it.
    try {
        return [Promise.resolve(await isolatedPlugin), cleanup];
    }
    catch (e) {
        // Proof, kept separate from policy. The errno the worker saw is what makes
        // the message certain; whether that errno is also grounds for degrading is a
        // different question, and conflating them made the warning assert a sandbox
        // for agents the hint itself declines to name.
        const provenRefusal = (0, isolated_plugin_1.isPluginWorkerSocketRefusal)(e);
        // An agent is required alongside the errno, so a refusal on an ordinary
        // workstation still surfaces rather than silently losing isolation.
        if (!(0, isolated_plugin_1.isPluginWorkerStartupFailure)(e) ||
            !((provenRefusal && (0, native_1.isAiAgent)()) || (0, is_sandbox_1.isSandbox)())) {
            throw e;
        }
        cleanup();
        // Read and set in one synchronous step. Concurrently loaded plugins each
        // arrive here with their own failure, so testing the latch after setting it
        // is what keeps the advice to one copy.
        const alreadyRefused = isolationRefusedInThisProcess;
        isolationRefusedInThisProcess = true;
        if (!alreadyRefused) {
            output_1.output.warn({
                // Names what Nx observed, not what it infers. `isAiAgent()` is broader
                // than the agents `sandboxSpecificRemedy` will name a setting for, so a
                // title asserting a sandbox could sit above a body that deliberately
                // does not.
                title: provenRefusal
                    ? 'Nx was denied permission to create a plugin worker socket. Running plugins in the main process instead.'
                    : 'Could not start a plugin worker. Running plugins in the main process instead.',
                bodyLines: [
                    'Plugins that expect isolation may misbehave, and this is slower than a worker.',
                    // `certain` on the errno alone. Reaching here via `isSandbox()` proves
                    // only that a worker died before it connected, which denied permission
                    // explains but so does an OOM kill or a broken install.
                    ...(0, sandbox_socket_hint_1.sandboxSocketHint)({ certain: provenRefusal }),
                ],
            });
        }
        return (0, in_process_loader_1.loadNxPlugin)(plugin, root, index);
    }
};
exports.loadingMethod = loadingMethod;
/**
 * Returns all plugins (specified + default) as a flat list.
 * Specified plugins come first, followed by default plugins.
 */
async function getPlugins(nxJson, root = workspace_root_1.workspaceRoot) {
    const { specifiedPlugins, defaultPlugins } = await getPluginsSeparated(nxJson, root);
    return specifiedPlugins.concat(defaultPlugins);
}
/**
 * Returns specified plugins (from nx.json) and default plugins (project.json,
 * package.json, etc.) as separate arrays. This separation is needed for
 * two-phase project configuration processing where target defaults are
 * applied between specified and default plugin results.
 *
 * `nxJson` is required so callers control the snapshot of nx.json the plugin
 * loader uses. This matters for the daemon's freshness-gated recompute, where
 * the snap hash and the plugin set must reflect the same disk state.
 */
async function getPluginsSeparated(nxJson, root = workspace_root_1.workspaceRoot) {
    const pluginsConfiguration = nxJson.plugins ?? [];
    const pluginsConfigurationHash = (0, file_hasher_1.hashObject)(pluginsConfiguration);
    // If the plugins configuration has not changed, reuse the current plugins
    if (cachedSeparatedPlugins &&
        pluginsConfigurationHash === currentPluginsConfigurationHash) {
        return cachedSeparatedPlugins;
    }
    // A concurrent call is already loading this exact plugin set — share its
    // load rather than starting a second one that would race the module-level
    // cache state below.
    if (pendingSeparatedPlugins?.hash === pluginsConfigurationHash) {
        return pendingSeparatedPlugins.promise;
    }
    // Plugins config changed (e.g. `nx add @nx/maven` updated nx.json). The
    // cached SeparatedPlugins is invalidated by the early-return above, but
    // pendingPluginsPromise — the in-flight load — would otherwise be reused
    // by the `??=` below and serve the previous plugin set forever. Tear
    // down the old workers and force a fresh load.
    cleanupSpecifiedPlugins?.();
    pendingPluginsPromise = undefined;
    const loadPromise = (async () => {
        const results = await Promise.allSettled([
            getOnlyDefaultPlugins(root),
            (pendingPluginsPromise ??= loadSpecifiedNxPlugins(pluginsConfiguration, root)),
        ]);
        const errors = [];
        const defaultPlugins = [];
        const specifiedPlugins = [];
        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            if (result.status === 'fulfilled') {
                (i === 0 ? defaultPlugins : specifiedPlugins).push(...result.value);
            }
            else {
                errors.push(reasonToError(result.reason));
            }
        }
        if (errors.length > 0) {
            throw new AggregateError(errors, errors.map((e) => e.message).join('\n'));
        }
        const separatedPlugins = {
            specifiedPlugins,
            defaultPlugins,
        };
        // Commit only if we're still the registered load — so the hash and the
        // cached set are always written together and describe the same plugins.
        if (pendingSeparatedPlugins?.promise === loadPromise) {
            cachedSeparatedPlugins = separatedPlugins;
            currentPluginsConfigurationHash = pluginsConfigurationHash;
            loadedPlugins = specifiedPlugins.concat(defaultPlugins);
        }
        return separatedPlugins;
    })();
    pendingSeparatedPlugins = {
        hash: pluginsConfigurationHash,
        promise: loadPromise,
    };
    try {
        return await loadPromise;
    }
    finally {
        // Clear the in-flight marker, but only if it still points at our load —
        // a newer call may have already replaced it.
        if (pendingSeparatedPlugins?.promise === loadPromise) {
            pendingSeparatedPlugins = undefined;
        }
    }
}
/**
 * Stuff for default NX Plugins.
 */
let loadedDefaultPlugins;
let loadedDefaultPluginsHash;
let cleanupDefaultPlugins;
let pendingDefaultPluginPromise;
async function getOnlyDefaultPlugins(root = workspace_root_1.workspaceRoot) {
    const hash = root;
    // If the plugins configuration has not changed, reuse the current plugins
    if (loadedDefaultPlugins && hash === loadedDefaultPluginsHash) {
        return loadedDefaultPlugins;
    }
    // Cleanup current plugins before loading new ones
    if (cleanupDefaultPlugins) {
        cleanupDefaultPlugins();
    }
    pendingDefaultPluginPromise ??= loadDefaultNxPlugins(workspace_root_1.workspaceRoot);
    const [result, cleanupFn] = await pendingDefaultPluginPromise;
    cleanupDefaultPlugins = () => {
        loadedDefaultPlugins = undefined;
        pendingDefaultPluginPromise = undefined;
        cleanupFn();
    };
    loadedDefaultPlugins = result;
    loadedDefaultPluginsHash = hash;
    return result;
}
/**
 * The plugins from an in-flight load (whose workers may already be forked) or
 * the last committed one, without triggering a load. Undefined when neither
 * exists or plugins were cleaned up. After a plugins-config change the
 * committed set can be the previous, already-disposed one until the new load
 * commits, so callers must tolerate a disposed worker.
 */
function getPluginsIfLoadedOrLoading() {
    const separated = pendingSeparatedPlugins
        ? pendingSeparatedPlugins.promise
        : cachedSeparatedPlugins;
    if (!separated) {
        return undefined;
    }
    return Promise.resolve(separated).then(({ specifiedPlugins, defaultPlugins }) => specifiedPlugins.concat(defaultPlugins));
}
function cleanupPlugins() {
    cleanupSpecifiedPlugins?.();
    cleanupDefaultPlugins?.();
    pendingPluginsPromise = undefined;
    pendingDefaultPluginPromise = undefined;
    cachedSeparatedPlugins = undefined;
    // Drop the in-flight load too: clearing the marker flips its commit gate to
    // false, so a load resolving after teardown can't repopulate the torn-down cache.
    pendingSeparatedPlugins = undefined;
}
/**
 * Stuff for generic loading
 */
async function loadDefaultNxPlugins(root = workspace_root_1.workspaceRoot) {
    performance.mark('loadDefaultNxPlugins:start');
    const plugins = getDefaultPlugins(root);
    const cleanupFunctions = [];
    const results = await Promise.allSettled(plugins.map(async (plugin) => {
        performance.mark(`Load Nx Plugin: ${plugin} - start`);
        const [loadedPluginPromise, cleanup] = await (0, exports.loadingMethod)(plugin, root);
        cleanupFunctions.push(cleanup);
        const res = await loadedPluginPromise;
        performance.mark(`Load Nx Plugin: ${plugin} - end`);
        performance.measure(`Load Nx Plugin: ${plugin}`, `Load Nx Plugin: ${plugin} - start`, `Load Nx Plugin: ${plugin} - end`);
        return res;
    }));
    const defaultPluginResults = [];
    const errors = [];
    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled') {
            defaultPluginResults.push(result.value);
        }
        else {
            errors.push({
                pluginName: plugins[i],
                error: reasonToError(result.reason),
            });
        }
    }
    if (errors.length > 0) {
        for (const fn of cleanupFunctions) {
            fn();
        }
        const errorMessage = errors
            .map((e) => `  - ${e.pluginName}: ${e.error.message}`)
            .join('\n');
        throw new AggregateError(errors.map((e) => e.error), `Failed to load ${errors.length} default Nx plugin(s):\n${errorMessage}`);
    }
    const ret = [
        defaultPluginResults,
        () => {
            for (const fn of cleanupFunctions) {
                fn();
            }
            if ((0, transpiler_1.pluginTranspilerIsRegistered)()) {
                (0, transpiler_1.cleanupPluginTSTranspiler)();
            }
        },
    ];
    performance.mark('loadDefaultNxPlugins:end');
    performance.measure('loadDefaultNxPlugins', 'loadDefaultNxPlugins:start', 'loadDefaultNxPlugins:end');
    return ret;
}
async function loadSpecifiedNxPlugins(pluginsConfigurations, root = workspace_root_1.workspaceRoot) {
    // Returning existing plugins is handled by getPlugins,
    // so, if we are here and there are existing plugins, they are stale
    if (cleanupSpecifiedPlugins) {
        cleanupSpecifiedPlugins();
    }
    performance.mark('loadSpecifiedNxPlugins:start');
    pluginsConfigurations ??= [];
    // Drop the cached workspace-layout snapshot local-plugin resolution uses:
    // in a long-lived daemon it can predate a newly added local plugin and
    // resolve it to the workspace root. Runs only when the plugin set changed.
    (0, resolve_plugin_1.resetResolvePluginCache)();
    const cleanupFunctions = [];
    const results = await Promise.allSettled(pluginsConfigurations.map(async (plugin, index) => {
        const pluginPath = typeof plugin === 'string' ? plugin : plugin.plugin;
        performance.mark(`Load Nx Plugin: ${pluginPath} - start`);
        const [loadedPluginPromise, cleanup] = await (0, exports.loadingMethod)(plugin, root, index);
        cleanupFunctions.push(cleanup);
        const res = await loadedPluginPromise;
        performance.mark(`Load Nx Plugin: ${pluginPath} - end`);
        performance.measure(`Load Nx Plugin: ${pluginPath}`, `Load Nx Plugin: ${pluginPath} - start`, `Load Nx Plugin: ${pluginPath} - end`);
        return res;
    }));
    performance.mark('loadSpecifiedNxPlugins:end');
    performance.measure('loadSpecifiedNxPlugins', 'loadSpecifiedNxPlugins:start', 'loadSpecifiedNxPlugins:end');
    const plugins = [];
    const errors = [];
    for (let i = 0; i < results.length; i++) {
        const result = results[i];
        if (result.status === 'fulfilled') {
            plugins.push(result.value);
        }
        else {
            const pluginConfig = pluginsConfigurations[i];
            const pluginName = typeof pluginConfig === 'string' ? pluginConfig : pluginConfig.plugin;
            errors.push({
                pluginName,
                error: reasonToError(result.reason),
            });
        }
    }
    if (errors.length > 0) {
        for (const fn of cleanupFunctions) {
            fn();
        }
        const errorMessage = errors
            .map((e) => `  - ${e.pluginName}: ${e.error.message}`)
            .join('\n');
        throw new AggregateError(errors.map((e) => e.error), `Failed to load ${errors.length} Nx plugin(s):\n${errorMessage}`);
    }
    cleanupSpecifiedPlugins = () => {
        for (const fn of cleanupFunctions) {
            fn();
        }
        if ((0, transpiler_1.pluginTranspilerIsRegistered)()) {
            (0, transpiler_1.cleanupPluginTSTranspiler)();
        }
        pendingPluginsPromise = undefined;
    };
    return plugins;
}
function reasonToError(reason) {
    if (reason instanceof Error) {
        return reason;
    }
    if (typeof reason === 'object' && reason !== null && 'message' in reason) {
        const error = new Error(String(reason.message));
        if ('stack' in reason) {
            error.stack = String(reason.stack);
        }
        return error;
    }
    return new Error(String(reason));
}
function getDefaultPlugins(root) {
    return [
        (0, node_path_1.join)(__dirname, '../../plugins/js'),
        ...((0, angular_json_1.shouldMergeAngularProjects)(root, false)
            ? [(0, node_path_1.join)(__dirname, '../../adapter/angular-json')]
            : []),
        (0, node_path_1.join)(__dirname, '../../plugins/package-json'),
        (0, node_path_1.join)(__dirname, '../../plugins/project-json/build-nodes/project-json'),
    ];
}
