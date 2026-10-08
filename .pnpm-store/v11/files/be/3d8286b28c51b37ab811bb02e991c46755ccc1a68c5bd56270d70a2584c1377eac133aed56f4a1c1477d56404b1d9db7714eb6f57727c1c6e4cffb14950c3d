"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLUGIN_WORKER_SOCKET_REFUSED = exports.PLUGIN_WORKER_STARTUP_FAILURE = exports.IsolatedPlugin = void 0;
exports.getPluginWorkerSocketId = getPluginWorkerSocketId;
exports.connectToWorker = connectToWorker;
exports.describeWorkerExit = describeWorkerExit;
exports.isPluginWorkerStartupFailure = isPluginWorkerStartupFailure;
exports.isPluginWorkerSocketRefusal = isPluginWorkerSocketRefusal;
const child_process_1 = require("child_process");
const crypto_1 = require("crypto");
const net_1 = require("net");
const path = require("path");
const logger_1 = require("../../../daemon/logger");
const sandbox_socket_hint_1 = require("../../../daemon/sandbox-socket-hint");
const socket_refused_exit_code_1 = require("../../../utils/socket-refused-exit-code");
const socket_utils_1 = require("../../../daemon/socket-utils");
const consume_messages_from_socket_1 = require("../../../utils/consume-messages-from-socket");
const typescript_1 = require("../../../plugins/js/utils/typescript");
const installation_directory_1 = require("../../../utils/installation-directory");
const is_sandbox_1 = require("../../../utils/is-sandbox");
const logger_2 = require("../../../utils/logger");
const progress_topics_1 = require("../../../utils/progress-topics");
const wait_for_socket_connection_1 = require("../../../utils/wait-for-socket-connection");
const workspace_root_1 = require("../../../utils/workspace-root");
const resolve_plugin_1 = require("../resolve-plugin");
const messaging_1 = require("./messaging");
const plugin_lifecycle_manager_1 = require("./plugin-lifecycle-manager");
const PLUGIN_TIMEOUT_HINT_TEXT = 'As a last resort, you can set NX_PLUGIN_NO_TIMEOUTS=true to bypass this timeout.';
const MINUTES = 10;
const MAX_MESSAGE_WAIT = process.env.NX_PLUGIN_NO_TIMEOUTS === 'true'
    ? // Registering a timeout prevents the process from exiting
        // if the call to a plugin happens to be the only thing
        // keeping the process alive. As such, even if timeouts are disabled
        // we need to register one. 2147483647 is the max timeout
        // that Node.js allows, and is equivalent to 24.8 days.
        2147483647
    : 1000 * 60 * MINUTES;
class IsolatedPlugin {
    /**
     * Creates and loads an isolated plugin worker.
     */
    static async load(plugin, root, index) {
        const moduleName = typeof plugin === 'string' ? plugin : plugin.plugin;
        const { name, pluginPath, shouldRegisterTSTranspiler } = await (0, resolve_plugin_1.resolveNxPlugin)(moduleName, root, (0, installation_directory_1.getNxRequirePaths)(root));
        const instance = new IsolatedPlugin(plugin, root, name, pluginPath, shouldRegisterTSTranspiler, index);
        const loadResult = await instance.spawnAndConnect();
        instance.setupHooks(loadResult);
        return instance;
    }
    constructor(plugin, root, name, pluginPath, shouldRegisterTSTranspiler, index) {
        this.index = index;
        // Worker state
        this.worker = null;
        this.socket = null;
        this._alive = false;
        this._connectPromise = null;
        this.txId = 0;
        this.pendingCount = 0;
        // Typed response handlers keyed by transaction ID
        this.responseHandlers = new Map();
        this.exitHandler = null;
        this.handleSocketData = (raw) => {
            let message;
            try {
                message = (0, consume_messages_from_socket_1.parseMessage)(raw);
            }
            catch (e) {
                // Runs inside a synchronous socket 'data' callback, so a throw here
                // becomes an uncaughtException in the host process rather than a failed
                // plugin call.
                logger_2.logger.error(`[plugin-client] "${this.name}" sent a message that could not be parsed: ${e instanceof Error ? e.message : e}\nReceived: ${(0, consume_messages_from_socket_1.describeMessage)(raw)}`);
                return;
            }
            if ((0, messaging_1.isPluginWorkerNotification)(message)) {
                handlePluginWorkerNotification(message);
                return;
            }
            if (!(0, messaging_1.isPluginWorkerResult)(message)) {
                return;
            }
            const pending = this.responseHandlers.get(message.tx);
            if (pending) {
                this.responseHandlers.delete(message.tx);
                pending.onMessage(message);
            }
        };
        this.plugin = plugin;
        this.root = root;
        this.name = name;
        this.pluginPath = pluginPath;
        this.shouldRegisterTSTranspiler = shouldRegisterTSTranspiler;
    }
    async spawnAndConnect() {
        const { worker, socket } = await startPluginWorker(this.name);
        this.worker = worker;
        this.socket = socket;
        this.registerProcessMetrics();
        this.exitHandler = (code, signal) => {
            this.markUnusable();
            this.failPendingRequests(new Error(`Plugin worker "${this.name}" exited unexpectedly ${describeWorkerExit(code, signal)}.`));
        };
        worker.on('exit', this.exitHandler);
        socket.on('data', (0, consume_messages_from_socket_1.consumeMessagesFromSocket)(this.handleSocketData, (err) => {
            // The worker may still be running here; it is the stream that failed, so
            // reporting this as an exit would send whoever reads it hunting for a
            // dead process.
            this.handleFramingFailure(socket, err);
        }));
        return this.sendLoadMessage();
    }
    /**
     * Drops the worker from service without judging why. The next hook call
     * respawns it through `ensureAlive`.
     */
    markUnusable() {
        this._alive = false;
        this._connectPromise = null;
        if (this.worker?.stdout) {
            this.worker.stdout.unpipe(process.stdout);
        }
        if (this.worker?.stderr) {
            this.worker.stderr.unpipe(process.stderr);
        }
    }
    failPendingRequests(error) {
        for (const { onError } of this.responseHandlers.values()) {
            onError(error);
        }
        this.responseHandlers.clear();
    }
    handleFramingFailure(socket, error) {
        const framingError = new Error(`Plugin worker "${this.name}" sent a message the host could not read, ` +
            `so its connection was dropped. ${error.message}`);
        this.markUnusable();
        socket.destroy();
        if (this.responseHandlers.size === 0) {
            console.error(framingError.message);
        }
        else {
            this.failPendingRequests(framingError);
        }
    }
    /**
     * Ensures the worker is alive, restarting it if necessary.
     * Called before each hook execution to handle plugins that were
     * eagerly shutdown (e.g., post-task-only plugins).
     *
     * Uses a stored promise to coalesce concurrent restart attempts
     * so that only one worker is ever spawned at a time.
     */
    async ensureAlive() {
        if (this._alive) {
            return;
        }
        if (!this._connectPromise) {
            logger_2.logger.verbose(`[plugin-client] restarting worker for "${this.name}"`);
            this._connectPromise = this.spawnAndConnect().catch((err) => {
                // Clear the cached promise so subsequent calls can retry
                // instead of re-awaiting a permanently-rejected promise.
                this._connectPromise = null;
                throw err;
            });
        }
        await this._connectPromise;
    }
    sendLoadMessage() {
        return new Promise((resolve, reject) => {
            const tx = this.generateTxId('load');
            const timeout = setTimeout(() => {
                this.responseHandlers.delete(tx);
                reject(new Error(`Loading "${typeof this.plugin === 'string' ? this.plugin : this.plugin.plugin}" timed out after ${MINUTES} minutes. ${PLUGIN_TIMEOUT_HINT_TEXT}`));
            }, MAX_MESSAGE_WAIT);
            this.responseHandlers.set(tx, {
                onMessage: (msg) => {
                    clearTimeout(timeout);
                    if (msg.type !== 'loadResult') {
                        reject(new Error(`Expected loadResult, got ${msg.type}`));
                        return;
                    }
                    const payload = msg.payload;
                    if (payload.success === false) {
                        reject(payload.error);
                    }
                    else {
                        this._alive = true;
                        resolve(payload);
                    }
                },
                onError: (error) => {
                    clearTimeout(timeout);
                    reject(error);
                },
            });
            (0, messaging_1.sendMessageOverSocket)(this.socket, {
                type: 'load',
                payload: {
                    plugin: this.plugin,
                    root: this.root,
                    name: this.name,
                    pluginPath: this.pluginPath,
                    shouldRegisterTSTranspiler: this.shouldRegisterTSTranspiler,
                },
                tx,
            });
        });
    }
    setupHooks(loadResult) {
        // These are set via Object.defineProperty to work around readonly
        this.name = loadResult.name;
        this.include = loadResult.include;
        this.exclude = loadResult.exclude;
        const registeredHooks = hooks(loadResult.createNodesPattern && 'createNodes', loadResult.hasCreateDependencies && 'createDependencies', loadResult.hasCreateMetadata && 'createMetadata', loadResult.hasPreTasksExecution && 'preTasksExecution', loadResult.hasPostTasksExecution && 'postTasksExecution');
        this.lifecycle = new plugin_lifecycle_manager_1.PluginLifecycleManager(registeredHooks);
        const shutdown = (hookName) => this.shutdownIfInactive(hookName);
        const wrap = (hook, hookFn) => this.lifecycle.wrapHook(hook, async (...args) => {
            await this.ensureAlive();
            return hookFn(...args);
        }, () => shutdown(hook));
        if (loadResult.createNodesPattern) {
            this.createNodes = [
                loadResult.createNodesPattern,
                wrap('createNodes', async (configFiles, ctx) => {
                    const result = await this.sendRequest('createNodes', {
                        configFiles,
                        context: ctx,
                    });
                    if (result.success === false) {
                        throw result.error;
                    }
                    return result.result;
                }),
            ];
        }
        if (loadResult.hasCreateDependencies) {
            this.createDependencies = wrap('createDependencies', async (ctx) => {
                const result = await this.sendRequest('createDependencies', {
                    context: ctx,
                });
                if (result.success === false) {
                    throw result.error;
                }
                return result.dependencies;
            });
        }
        if (loadResult.hasCreateMetadata) {
            this.createMetadata = wrap('createMetadata', async (graph, ctx) => {
                const result = await this.sendRequest('createMetadata', {
                    graph,
                    context: ctx,
                });
                if (result.success === false) {
                    throw result.error;
                }
                return result.metadata;
            });
        }
        if (loadResult.hasPreTasksExecution) {
            this.preTasksExecution = wrap('preTasksExecution', async (context) => {
                const result = await this.sendRequest('preTasksExecution', {
                    context,
                });
                if (result.success === false) {
                    throw result.error;
                }
                return result.mutations;
            });
        }
        if (loadResult.hasPostTasksExecution) {
            this.postTasksExecution = wrap('postTasksExecution', async (context) => {
                const result = await this.sendRequest('postTasksExecution', {
                    context,
                });
                if (result.success === false) {
                    throw result.error;
                }
            });
        }
        // Shut down immediately if no graph phase hooks
        if (this.lifecycle.shouldShutdownImmediately()) {
            this.shutdown();
        }
    }
    generateTxId(type) {
        return `${this.name}:${this.worker?.pid ?? ''}:${type}:${this.txId++}`;
    }
    sendRequest(type, payload) {
        const tx = this.generateTxId(type);
        this.pendingCount++;
        return new Promise((resolve, reject) => {
            const expectedResultType = `${type}Result`;
            const timeout = setTimeout(() => {
                this.responseHandlers.delete(tx);
                this.pendingCount--;
                reject(new Error(`${this.name} timed out after ${MINUTES} minutes during ${type}. ${PLUGIN_TIMEOUT_HINT_TEXT}`));
            }, MAX_MESSAGE_WAIT);
            this.responseHandlers.set(tx, {
                onMessage: (msg) => {
                    clearTimeout(timeout);
                    this.pendingCount--;
                    if (msg.type !== expectedResultType) {
                        reject(new Error(`Expected ${expectedResultType}, got ${msg.type}`));
                        return;
                    }
                    resolve(msg.payload);
                },
                onError: (error) => {
                    clearTimeout(timeout);
                    this.pendingCount--;
                    reject(error);
                },
            });
            (0, messaging_1.sendMessageOverSocket)(this.socket, {
                type,
                payload,
                tx,
            });
        });
    }
    shutdownIfInactive(hookName) {
        if (this.pendingCount > 0) {
            logger_2.logger.verbose(`[isolated-plugin] worker for "${this.name}" has ${this.pendingCount} pending request(s), not shutting down yet`);
            return;
        }
        logger_2.logger.verbose(`[isolated-plugin] shutting down worker for "${this.name}" after ${hookName}`);
        this.shutdown();
    }
    async setWorkerEnv(env) {
        if (!this._alive) {
            return;
        }
        const result = await this.sendRequest('setWorkerEnv', env);
        if (result.success === false) {
            throw result.error;
        }
    }
    notifyPhaseAborted(phase, lastCompletedHook) {
        if (this.lifecycle?.notifyPhaseAborted(phase, lastCompletedHook)) {
            this.shutdownIfInactive(lastCompletedHook);
        }
    }
    shutdown() {
        if (!this._alive)
            return;
        this._alive = false;
        this._connectPromise = null;
        if (this.worker && this.exitHandler) {
            this.worker.off('exit', this.exitHandler);
        }
        if (this.worker?.stdout) {
            this.worker.stdout.unpipe(process.stdout);
            this.worker.stdout.destroy();
        }
        if (this.worker?.stderr) {
            this.worker.stderr.unpipe(process.stderr);
            this.worker.stderr.destroy();
        }
        if (this.socket) {
            this.socket.end();
        }
        this.worker = null;
        this.socket = null;
        this.exitHandler = null;
    }
    registerProcessMetrics() {
        if (!this.worker?.pid)
            return;
        (async () => {
            try {
                const { isOnDaemon } = await require(require.resolve('../../../daemon/is-on-daemon'));
                if (!isOnDaemon()) {
                    const { getProcessMetricsService } = await require(require.resolve('../../../tasks-runner/process-metrics-service'));
                    getProcessMetricsService().registerMainCliSubprocess(this.worker.pid, `${this.name}${this.index !== undefined ? ` (${this.index})` : ''}`);
                }
            }
            catch {
                // Silently ignore - metrics collection is optional
            }
        })();
    }
}
exports.IsolatedPlugin = IsolatedPlugin;
// --- Worker Spawning Utilities ---
global.nxPluginWorkerCount ??= 0;
function getPluginWorkerSocketId() {
    const counter = global.nxPluginWorkerCount++;
    return `${process.pid}-${counter.toString(36)}-${(0, crypto_1.randomBytes)(4).toString('hex')}`;
}
async function startPluginWorker(name) {
    performance.mark(`start-plugin-worker:${name}`);
    const isWorkerTypescript = path.extname(__filename) === '.ts';
    const workerPath = path.join(__dirname, isWorkerTypescript ? 'plugin-worker.ts' : 'plugin-worker.js');
    const env = {
        ...process.env,
        ...(isWorkerTypescript
            ? {
                SWC_NODE_PROJECT: path.join(__dirname, '../../../../tsconfig.lib.json'),
            }
            : {}),
    };
    // Keep the host pid readable for diagnostics, the counter collision-free
    // within this process, and entropy for a reused pid across process runs. The
    // suffix is a base36 counter plus four random bytes: eleven characters after
    // the pid until the counter passes 36, and fixed-length where the
    // `performance.now()` stamp it replaced varied with process uptime. That
    // keeps the socket path inside the 95-character budget `assertValidSocketPath`
    // enforces.
    const ipcPath = (0, socket_utils_1.getPluginOsSocketPath)(getPluginWorkerSocketId());
    const worker = (0, child_process_1.spawn)(process.execPath, [
        // Spawn the worker with the same resolve conditions Nx uses for plugin
        // entries so the plugin's transitive workspace imports resolve to source.
        ...(0, typescript_1.getPluginResolveConditionNodeArgs)(),
        // swc transpiles without type-checking: ~7x faster to boot, and this is
        // paid once per worker spawn.
        ...(isWorkerTypescript ? ['--require', '@swc-node/register'] : []),
        workerPath,
        ipcPath,
        name,
        // The host's root. The worker validates against this rather than re-resolving,
        // so the two agree by construction.
        workspace_root_1.workspaceRoot,
    ], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env,
        detached: true,
        shell: false,
        windowsHide: true,
    });
    logger_2.logger.verbose(`[isolated-plugin] spawned worker for "${name}" (pid: ${worker.pid}, socket: ${ipcPath})`);
    const stdoutMaxListeners = process.stdout.getMaxListeners();
    const stderrMaxListeners = process.stderr.getMaxListeners();
    if (stdoutMaxListeners !== 0) {
        process.stdout.setMaxListeners(stdoutMaxListeners + 1);
    }
    if (stderrMaxListeners !== 0) {
        process.stderr.setMaxListeners(stderrMaxListeners + 1);
    }
    pipeAndUnrefChildStream(worker.stdout, process.stdout, 'stdout');
    pipeAndUnrefChildStream(worker.stderr, process.stderr, 'stderr');
    worker.unref();
    try {
        const socket = await connectToWorker(worker, ipcPath, name);
        return { worker, socket };
    }
    finally {
        performance.mark(`start-plugin-worker-end:${name}`);
        performance.measure(`start-plugin-worker:${name}`, `start-plugin-worker:${name}`, `start-plugin-worker-end:${name}`);
    }
}
async function connectToWorker(worker, ipcPath, name) {
    const abortController = new AbortController();
    let earlyExitError = null;
    // If the worker exits before we connect, abort polling immediately
    // rather than burning through attempts against a dead socket.
    worker.once('exit', (code, signal) => {
        if (!abortController.signal.aborted) {
            // The worker sets this code only after an EPERM/EACCES on its own bind,
            // so it is proof of a refusal rather than an inference from the
            // environment — the only evidence available under an agent whose sandbox
            // sets no variable `isSandbox()` reads.
            const refused = code === socket_refused_exit_code_1.SOCKET_REFUSED_EXIT_CODE;
            earlyExitError = markWorkerStartupFailure(new Error([
                `Plugin worker for "${name}" exited ${describeWorkerExit(code, signal)} before the connection was established.`,
                // The worker's own stderr may be lost with the process, so the
                // cause and the fix are repeated here.
                ...(refused || (0, is_sandbox_1.isSandbox)()
                    ? (0, sandbox_socket_hint_1.sandboxSocketHint)({ certain: refused })
                    : []),
            ].join('\n')), refused);
            abortController.abort();
        }
    });
    const socket = await (0, wait_for_socket_connection_1.waitForSocketConnection)(ipcPath, {
        signal: abortController.signal,
    });
    if (socket) {
        abortController.abort();
        socket.unref();
        logger_2.logger.verbose(`[isolated-plugin] connected to worker for "${name}" (pid: ${worker.pid})`);
        return socket;
    }
    if (earlyExitError) {
        throw earlyExitError;
    }
    throw markWorkerStartupFailure(new Error(`Failed to start plugin worker for plugin ${name}`));
}
/**
 * Marks a failure to *start or reach* a worker, as distinct from a plugin that
 * loaded and then threw. Only the former can be retried in-process: swallowing
 * the latter would rerun a plugin that already failed on its own merits and
 * bury the real error.
 */
exports.PLUGIN_WORKER_STARTUP_FAILURE = Symbol.for('nx.pluginWorkerStartupFailure');
/**
 * Set when the worker exited with the socket-refused code. Narrower than
 * {@link PLUGIN_WORKER_STARTUP_FAILURE}, which covers every way a worker can
 * fail to come up, and is what lets the caller degrade on a refusal without
 * also degrading for an OOM kill or a broken install.
 */
exports.PLUGIN_WORKER_SOCKET_REFUSED = Symbol.for('nx.pluginWorkerSocketRefused');
/**
 * Describes how a worker died for an error message. A `null` code with a signal
 * is an outside kill rather than anything the worker chose, and SIGKILL is what
 * an out-of-memory kill looks like, so both are called out by name.
 */
function describeWorkerExit(code, signal) {
    if (signal) {
        return signal === 'SIGKILL'
            ? `(killed by ${signal}, commonly an out-of-memory kill)`
            : `(killed by ${signal})`;
    }
    if (code !== null) {
        return `(exit code ${code})`;
    }
    return '(no exit code or signal reported)';
}
function markWorkerStartupFailure(error, refused = false) {
    error[exports.PLUGIN_WORKER_STARTUP_FAILURE] = true;
    if (refused) {
        error[exports.PLUGIN_WORKER_SOCKET_REFUSED] = true;
    }
    return error;
}
function isPluginWorkerStartupFailure(error) {
    return Boolean(error?.[exports.PLUGIN_WORKER_STARTUP_FAILURE]);
}
function isPluginWorkerSocketRefusal(error) {
    return Boolean(error?.[exports.PLUGIN_WORKER_SOCKET_REFUSED]);
}
function getTypeName(u) {
    if (u === null)
        return 'null';
    if (u === undefined)
        return 'undefined';
    if (typeof u !== 'object')
        return typeof u;
    if (Array.isArray(u)) {
        const innerTypes = u.map((el) => getTypeName(el));
        return `Array<${Array.from(new Set(innerTypes)).join('|')}>`;
    }
    return u.constructor?.name ?? 'unknown object';
}
function detectAlternativeRuntime() {
    if ('Bun' in globalThis && typeof globalThis.Bun !== 'undefined') {
        return 'bun';
    }
    if ('Deno' in globalThis && typeof globalThis.Deno !== 'undefined') {
        return 'deno';
    }
    return null;
}
function pipeAndUnrefChildStream(source, destination, streamName) {
    if (!source) {
        return;
    }
    source.pipe(destination);
    if (source instanceof net_1.Socket) {
        source.unref();
        return;
    }
    if (typeof source.unref === 'function') {
        source.unref();
        return;
    }
    const runtime = detectAlternativeRuntime();
    if (runtime) {
        console.warn(`[NX] worker.${streamName} does not support unref() in ${runtime}. ` +
            `This may cause the process to hang when waiting for plugin workers to exit. ` +
            `This is a known limitation of ${runtime}'s Node.js compatibility layer.`);
    }
    else {
        console.warn(`[NX] worker.${streamName} is not a net.Socket and does not have an unref() method. ` +
            `Expected Socket, got ${getTypeName(source)}. ` +
            `This may cause the process to hang when waiting for plugin workers to exit.`);
    }
}
function hooks(...array) {
    return array.filter((v) => !!v);
}
// When the host process is the daemon, broadcast the log notification
// to every client subscribed to the graph-construction topic so the
// line surfaces in their terminal. When the host is the direct CLI
// there is no client to notify, so the log line goes straight to
// stdout/stderr.
function handlePluginWorkerNotification(notification) {
    if (global.NX_DAEMON) {
        logger_1.serverLogger.logToClient(progress_topics_1.ProgressTopics.GraphConstruction, notification.message, notification.level);
        return;
    }
    console[notification.level](notification.message);
}
