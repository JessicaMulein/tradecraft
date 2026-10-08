"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// Must be the first import — see enable-compile-cache.ts.
require("../../../utils/enable-compile-cache");
const node_perf_hooks_1 = require("node:perf_hooks");
node_perf_hooks_1.performance.mark(`plugin worker ${process.pid} code loading -- start`);
const consume_messages_from_socket_1 = require("../../../utils/consume-messages-from-socket");
const logger_1 = require("../../../utils/logger");
const serializable_error_1 = require("../../../utils/serializable-error");
const daemon_message_1 = require("../../../daemon/message-types/daemon-message");
const messaging_1 = require("./messaging");
const worker_streaming_1 = require("./worker-streaming");
const fs_1 = require("fs");
const net_1 = require("net");
const analytics_1 = require("../../../analytics");
const daemon_environment_1 = require("../../../daemon/client/daemon-environment");
const sandbox_socket_hint_1 = require("../../../daemon/sandbox-socket-hint");
const permission_errors_1 = require("../../../utils/permission-errors");
const socket_refused_exit_code_1 = require("../../../utils/socket-refused-exit-code");
const is_sandbox_1 = require("../../../utils/is-sandbox");
require("../../../utils/perf-logging");
const environment = process.env;
(0, analytics_1.startAnalytics)();
node_perf_hooks_1.performance.mark(`plugin worker ${process.pid} code loading -- end`);
node_perf_hooks_1.performance.measure(`plugin worker ${process.pid} code loading`, `plugin worker ${process.pid} code loading -- start`, `plugin worker ${process.pid} code loading -- end`);
global.NX_GRAPH_CREATION = true;
global.NX_PLUGIN_WORKER = true;
let plugin;
const socketPath = process.argv[2];
const expectedPluginName = process.argv[3];
// The host's root, passed explicitly rather than re-resolved: a host that set
// its root at runtime would resolve a different one here and drop every
// legitimate message as foreign.
const hostWorkspaceRoot = process.argv[4];
// Positional, so inserting an argument host-side shifts all of them — and the
// symptom is silent and total: an undefined hostWorkspaceRoot makes every
// message look foreign while the host waits out its plugin timeout.
if (!socketPath || !expectedPluginName || !hostWorkspaceRoot) {
    console.error(`[plugin-worker] started with an incomplete argument list ` +
        `(socketPath=${socketPath}, pluginName=${expectedPluginName}, hostWorkspaceRoot=${hostWorkspaceRoot}). ` +
        `This is an Nx bug — please report it at https://github.com/nrwl/nx/issues.`);
    process.exit(1);
}
const CONNECT_TIMEOUT_MS = 30_000;
let connectErrorTimeout = setErrorTimeout(CONNECT_TIMEOUT_MS, `The plugin worker for ${expectedPluginName} is exiting as it was not connected to within ${CONNECT_TIMEOUT_MS / 1000} seconds. ` +
    'Plugin workers expect to receive a socket connection from the parent process shortly after being started. ' +
    'If you are seeing this issue, please report it to the Nx team at https://github.com/nrwl/nx/issues.');
const server = (0, net_1.createServer)((socket) => {
    connectErrorTimeout?.clear();
    // Make the host-facing socket available to plugin code running in this
    // worker so it can emit log / progress notifications without having
    // the socket threaded through every call site.
    (0, worker_streaming_1.setPluginWorkerHostSocket)(socket);
    logger_1.logger.verbose(`[plugin-worker] "${expectedPluginName}" (pid: ${process.pid}) connected`);
    // This handles cases where the host process was killed
    // after the worker connected but before the worker was
    // instructed to load the plugin.
    let loadErrorTimeout = setErrorTimeout(10_000, `Plugin Worker for ${expectedPluginName} is exiting as it did not receive a load message within 10 seconds of connecting. ` +
        'This likely indicates that the host process was terminated before the worker could be instructed to load the plugin. ' +
        'If you are seeing this issue, please report it to the Nx team at https://github.com/nrwl/nx/issues.');
    socket.on('data', (0, consume_messages_from_socket_1.consumeMessagesFromSocket)((raw) => {
        const message = (0, consume_messages_from_socket_1.parseMessage)(raw);
        if (!(0, messaging_1.isPluginWorkerMessage)(message)) {
            return;
        }
        // Same check the daemon applies to its own socket. Dropped rather than thrown:
        // a stray foreign message must not kill a worker serving its host. The daemon
        // has a response channel and surfaces it to the client instead.
        try {
            (0, daemon_message_1.assertNotForeignWorkspaceMessage)(message, hostWorkspaceRoot, `The Nx plugin worker "${expectedPluginName}" (pid: ${process.pid})`);
        }
        catch (e) {
            logger_1.logger.verbose(`[plugin-worker] ignored a "${message.type}" message: ${e instanceof Error ? e.message : e}`);
            return;
        }
        return (0, messaging_1.consumeMessage)(socket, message, {
            load: async ({ plugin: pluginConfiguration, root, name, pluginPath, shouldRegisterTSTranspiler, }) => {
                loadErrorTimeout?.clear();
                process.chdir(root);
                return withErrorHandling(async () => {
                    const { loadResolvedNxPluginAsync } = await Promise.resolve(require(require.resolve('../load-resolved-plugin')));
                    // Register the ts-transpiler if we are pointing to a
                    // plain ts file that's not part of a plugin project
                    if (shouldRegisterTSTranspiler) {
                        require('../transpiler').registerPluginTSTranspiler();
                    }
                    plugin = await loadResolvedNxPluginAsync(pluginConfiguration, pluginPath, name);
                    logger_1.logger.verbose(`[plugin-worker] "${name}" (pid: ${process.pid}) loaded successfully`);
                    return {
                        name: plugin.name,
                        include: plugin.include,
                        exclude: plugin.exclude,
                        createNodesPattern: plugin.createNodes?.[0],
                        hasCreateDependencies: 'createDependencies' in plugin && !!plugin.createDependencies,
                        hasProcessProjectGraph: 'processProjectGraph' in plugin &&
                            !!plugin.processProjectGraph,
                        hasCreateMetadata: 'createMetadata' in plugin && !!plugin.createMetadata,
                        hasPreTasksExecution: 'preTasksExecution' in plugin && !!plugin.preTasksExecution,
                        hasPostTasksExecution: 'postTasksExecution' in plugin && !!plugin.postTasksExecution,
                        success: true,
                    };
                });
            },
            createNodes: async ({ configFiles, context }) => withErrorHandling(async () => {
                const result = await plugin.createNodes[1](configFiles, context);
                return { result, success: true };
            }),
            createDependencies: async ({ context }) => withErrorHandling(async () => {
                const result = await plugin.createDependencies(context);
                return { dependencies: result, success: true };
            }),
            createMetadata: async ({ graph, context }) => withErrorHandling(async () => {
                const result = await plugin.createMetadata(graph, context);
                return { metadata: result, success: true };
            }),
            preTasksExecution: async ({ context }) => withErrorHandling(async () => {
                const mutations = await plugin.preTasksExecution?.(context);
                return { success: true, mutations };
            }),
            postTasksExecution: async ({ context }) => withErrorHandling(() => plugin.postTasksExecution?.(context)),
            setWorkerEnv: (env) => withErrorHandling(() => {
                (0, daemon_environment_1.applyDaemonEnvFromClient)(env);
            }),
        });
    }, (err) => {
        // The host link cannot resynchronize. Exit so the host's 'exit' handler
        // rejects the pending hooks instead of waiting on a reply that the
        // framing failure guarantees will never arrive.
        console.error(err.message);
        socket.destroy();
        process.exit(1);
    }));
    // When the host disconnects, clean up and exit.
    socket.on('end', () => {
        socket.destroySoon();
        try {
            (0, fs_1.unlinkSync)(socketPath);
        }
        catch (e) { }
        process.exit(0);
    });
});
server.on('error', (err) => {
    // Without this the host only sees "exited before the connection was
    // established"; the errno distinguishes a denied bind from EADDRINUSE.
    console.error(`[plugin-worker] "${expectedPluginName}" (pid: ${process.pid}) failed to listen on ${socketPath}: ${err.message}`);
    // A bind can fail for reasons permission does not explain (EADDRINUSE from a
    // leftover socket, ENOENT from a reaped socket dir), so print the hint only
    // when the errno proves a refusal or the environment says a sandbox is here.
    const refusedByOs = (0, permission_errors_1.isPermissionDenied)(err);
    if (refusedByOs || (0, is_sandbox_1.isSandbox)()) {
        console.error((0, sandbox_socket_hint_1.sandboxSocketHint)({ certain: refusedByOs }).join('\n'));
    }
    // The host cannot see this errno, and stderr may be lost with the process, so
    // the exit code is what tells it a refusal happened rather than a crash.
    process.exit(refusedByOs ? socket_refused_exit_code_1.SOCKET_REFUSED_EXIT_CODE : 1);
});
// A worker killed without its 'end' handler leaves the socket behind. Colliding
// takes a recycled host pid landing on the same counter *and* the same 4 random
// bytes; the random component is what this unlink rests on, and on Windows it is
// the only barrier, since the endpoint is a namespace object and the mode never
// applies. A failed bind surfaces through the error handler above.
try {
    (0, fs_1.unlinkSync)(socketPath);
}
catch { }
server.listen(socketPath, () => {
    logger_1.logger.verbose(`[plugin-worker] "${expectedPluginName}" (pid: ${process.pid}) listening on ${socketPath}`);
});
async function withErrorHandling(cb) {
    try {
        const result = await cb();
        return result ?? { success: true };
    }
    catch (e) {
        return {
            success: false,
            error: (0, serializable_error_1.createSerializableError)(e),
        };
    }
}
function setErrorTimeout(timeoutMs, errorMessage) {
    if (environment.NX_PLUGIN_NO_TIMEOUTS === 'true') {
        return;
    }
    let cleared = false;
    const timeout = setTimeout(() => {
        if (!cleared) {
            console.error(errorMessage);
            process.exit(1);
        }
    }, timeoutMs).unref();
    return {
        clear: () => {
            cleared = true;
            clearTimeout(timeout);
        },
    };
}
const cleanup = () => {
    server.close();
    try {
        (0, fs_1.unlinkSync)(socketPath);
    }
    catch (e) { }
};
const events = ['SIGINT', 'SIGTERM', 'SIGQUIT'];
events.forEach((event) => process.once(event, () => {
    cleanup();
    process.exit(0);
}));
// Cleanup only: process.exit() here would override the real exit code.
process.once('exit', cleanup);
const fatalHandler = (error) => {
    // Registering this handler suppresses Node's default reporting.
    console.error(error);
    cleanup();
    process.exit(1);
};
process.once('uncaughtException', fatalHandler);
process.once('unhandledRejection', fatalHandler);
