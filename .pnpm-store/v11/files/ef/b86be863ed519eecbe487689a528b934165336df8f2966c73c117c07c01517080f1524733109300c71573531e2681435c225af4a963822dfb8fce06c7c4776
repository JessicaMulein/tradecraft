"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.daemonClient = exports.DaemonClient = exports.WatcherFailedError = void 0;
exports.isDaemonEnabled = isDaemonEnabled;
exports.daemonPermissionException = daemonPermissionException;
exports.daemonProcessException = daemonProcessException;
const child_process_1 = require("child_process");
const net_1 = require("net");
const node_fs_1 = require("node:fs");
const path_1 = require("path");
const perf_hooks_1 = require("perf_hooks");
const configuration_1 = require("../../config/configuration");
const nx_json_1 = require("../../config/nx-json");
const native_1 = require("../../native");
const error_types_1 = require("../../project-graph/error-types");
const typescript_1 = require("../../plugins/js/utils/typescript");
const project_graph_1 = require("../../project-graph/project-graph");
const consume_messages_from_socket_1 = require("../../utils/consume-messages-from-socket");
const delayed_spinner_1 = require("../../utils/delayed-spinner");
const handle_import_1 = require("../../utils/handle-import");
const is_ci_1 = require("../../utils/is-ci");
const is_sandbox_1 = require("../../utils/is-sandbox");
const output_1 = require("../../utils/output");
const permission_errors_1 = require("../../utils/permission-errors");
const promised_based_queue_1 = require("../../utils/promised-based-queue");
const wait_for_socket_connection_1 = require("../../utils/wait-for-socket-connection");
const workspace_root_1 = require("../../utils/workspace-root");
const cache_1 = require("../cache");
const is_nx_version_mismatch_1 = require("../is-nx-version-mismatch");
const logger_1 = require("../logger");
const configure_ai_agents_1 = require("../message-types/configure-ai-agents");
const flush_sync_generator_changes_to_disk_1 = require("../message-types/flush-sync-generator-changes-to-disk");
const get_context_file_data_1 = require("../message-types/get-context-file-data");
const get_files_in_directory_1 = require("../message-types/get-files-in-directory");
const get_nx_workspace_files_1 = require("../message-types/get-nx-workspace-files");
const get_registered_sync_generators_1 = require("../message-types/get-registered-sync-generators");
const get_sync_generator_changes_1 = require("../message-types/get-sync-generator-changes");
const hash_glob_1 = require("../message-types/hash-glob");
const nx_console_1 = require("../message-types/nx-console");
const register_project_graph_listener_1 = require("../message-types/register-project-graph-listener");
const run_tasks_execution_hooks_1 = require("../message-types/run-tasks-execution-hooks");
const streaming_messages_1 = require("../message-types/streaming-messages");
const task_history_1 = require("../message-types/task-history");
const update_workspace_context_1 = require("../message-types/update-workspace-context");
const tmp_dir_1 = require("../tmp-dir");
const sandbox_socket_hint_1 = require("../sandbox-socket-hint");
const socket_refused_exit_code_1 = require("../../utils/socket-refused-exit-code");
const daemon_socket_messenger_1 = require("./daemon-socket-messenger");
const daemon_environment_1 = require("./daemon-environment");
var DaemonStatus;
(function (DaemonStatus) {
    DaemonStatus[DaemonStatus["CONNECTING"] = 0] = "CONNECTING";
    DaemonStatus[DaemonStatus["DISCONNECTED"] = 1] = "DISCONNECTED";
    DaemonStatus[DaemonStatus["CONNECTED"] = 2] = "CONNECTED";
})(DaemonStatus || (DaemonStatus = {}));
const WAIT_FOR_SERVER_CONFIG = {
    delayMs: 10,
    maxAttempts: 6000, // 6000 * 10ms = 60 seconds
};
/**
 * The daemon's workspace watcher died. Nothing it serves will see file changes
 * again, so a watching client has to restart rather than keep waiting.
 */
class WatcherFailedError extends Error {
    constructor(message) {
        super(message);
        this.name = 'WatcherFailedError';
        Object.setPrototypeOf(this, WatcherFailedError.prototype);
    }
}
exports.WatcherFailedError = WatcherFailedError;
/**
 * A framing failure repeats on every redial, so the watcher channels stop
 * re-dialing once this many land back to back without a message in between.
 */
const MAX_CONSECUTIVE_FRAMING_FAILURES = 3;
class DaemonClient {
    constructor() {
        // Tracks the spinner owned by the in-flight request so streamed
        // progress updates are routed to the caller's spinner instead of
        // mutating the process-wide globalSpinner (which may belong to an
        // unrelated command).
        this.currentSpinner = null;
        this._daemonStatus = DaemonStatus.DISCONNECTED;
        this._waitForDaemonReady = null;
        this._daemonReady = null;
        this.fileWatcherReconnecting = false;
        this.fileWatcherFramingFailures = 0;
        this.fileWatcherCallbacks = new Map();
        this.fileWatcherConfigs = new Map();
        this.projectGraphListenerReconnecting = false;
        this.projectGraphListenerFramingFailures = 0;
        this.projectGraphListenerCallbacks = new Map();
        this.envReflectionSent = false;
        try {
            this.nxJson = (0, configuration_1.readNxJson)();
        }
        catch (e) {
            this.nxJson = null;
        }
        this.reset();
    }
    enabled() {
        if (this._enabled === undefined) {
            const useDaemonProcessOption = this.nxJson?.useDaemonProcess;
            const env = process.env.NX_DAEMON;
            // env takes precedence
            // option=true,env=false => no daemon
            // option=false,env=undefined => no daemon
            // option=false,env=false => no daemon
            // option=undefined,env=undefined => daemon
            // option=true,env=true => daemon
            // option=false,env=true => daemon
            // CI=true,env=undefined => no daemon
            // CI=true,env=false => no daemon
            // CI=true,env=true => daemon
            // docker=true,env=undefined => no daemon
            // docker=true,env=false => no daemon
            // docker=true,env=true => daemon
            // WASM => no daemon because file watching does not work
            // version mismatch => no daemon because the installed nx version differs from the running one
            if ((0, is_nx_version_mismatch_1.isNxVersionMismatch)() ||
                (((0, is_ci_1.isCI)() || isDocker()) && env !== 'true') ||
                (0, tmp_dir_1.isDaemonDisabled)() ||
                nxJsonIsNotPresent() ||
                (useDaemonProcessOption === undefined && env === 'false') ||
                (useDaemonProcessOption === true && env === 'false') ||
                (useDaemonProcessOption === false && env === undefined) ||
                (useDaemonProcessOption === false && env === 'false')) {
                this._enabled = false;
            }
            else if (native_1.IS_WASM) {
                output_1.output.warn({
                    title: 'The Nx Daemon is unsupported in WebAssembly environments. Some things may be slower than or not function as expected.',
                });
                this._enabled = false;
            }
            else {
                this._enabled = true;
            }
        }
        return this._enabled;
    }
    reset() {
        this.socketMessenger?.close();
        this.socketMessenger = null;
        this.queue = new promised_based_queue_1.PromisedBasedQueue();
        this.currentMessage = null;
        this.currentResolve = null;
        this.currentReject = null;
        this._enabled = undefined;
        // Clean up file watcher and project graph listener connections
        this.fileWatcherMessenger?.close();
        this.fileWatcherMessenger = undefined;
        this.projectGraphListenerMessenger?.close();
        this.projectGraphListenerMessenger = undefined;
        this._daemonStatus = DaemonStatus.DISCONNECTED;
        this._waitForDaemonReady = new Promise((resolve) => (this._daemonReady = resolve));
    }
    getSocketPath() {
        const daemonProcessJson = (0, cache_1.readDaemonProcessJsonCache)();
        if (daemonProcessJson?.socketPath) {
            return daemonProcessJson.socketPath;
        }
        else {
            throw daemonProcessException('Unable to connect to daemon: no socket path available');
        }
    }
    async requestShutdown() {
        return this.sendToDaemonViaQueue({ type: 'REQUEST_SHUTDOWN' });
    }
    async getProjectGraphAndSourceMaps() {
        (0, project_graph_1.preventRecursionInGraphConstruction)();
        let spinner;
        // If the graph takes a while to load, we want to show a spinner.
        spinner = new delayed_spinner_1.DelayedSpinner('Calculating the project graph on the Nx Daemon');
        this.currentSpinner = spinner;
        try {
            const response = await this.sendToDaemonViaQueue({
                type: 'REQUEST_PROJECT_GRAPH',
            });
            return {
                projectGraph: response.projectGraph,
                sourceMaps: response.sourceMaps,
            };
        }
        catch (e) {
            if (e.name === error_types_1.DaemonProjectGraphError.name) {
                throw error_types_1.ProjectGraphError.fromDaemonProjectGraphError(e);
            }
            else {
                throw e;
            }
        }
        finally {
            spinner?.cleanup();
            this.currentSpinner = null;
        }
    }
    async getAllFileData() {
        return await this.sendToDaemonViaQueue({ type: 'REQUEST_FILE_DATA' });
    }
    hashTasks(runnerOptions, tasks, taskGraph, perTaskEnvs, cwd, collectInputs) {
        // Task results get written back onto these task objects as the run
        // progresses — hash/hashDetails/timestamps by hashing and the
        // orchestrator, terminalOutput by the Nx Cloud life cycle (untyped) —
        // so a later message would otherwise re-ship every earlier result.
        const trimmedTasks = {};
        for (const [id, t] of Object.entries(taskGraph.tasks)) {
            const { hash, hashDetails, startTime, endTime, terminalOutput, ...strippedTask } = t;
            trimmedTasks[id] = strippedTask;
        }
        return this.sendToDaemonViaQueue({
            type: 'HASH_TASKS',
            runnerOptions,
            perTaskEnvs,
            tasks: tasks.map((t) => trimmedTasks[t.id]),
            taskGraph: { ...taskGraph, tasks: trimmedTasks },
            cwd,
            collectInputs,
        });
    }
    async registerFileWatcher(config, callback) {
        try {
            await this.getProjectGraphAndSourceMaps();
        }
        catch (e) {
            if (config.allowPartialGraph && e instanceof error_types_1.ProjectGraphError) {
                // we are fine with partial graph
            }
            else {
                throw e;
            }
        }
        // Generate unique ID for this callback
        const callbackId = Math.random().toString(36).substring(2, 11);
        // Store callback and config for reconnection
        this.fileWatcherCallbacks.set(callbackId, callback);
        this.fileWatcherConfigs.set(callbackId, config);
        await this.queue.sendToQueue(async () => {
            // If we already have a connection, just register the new config
            if (this.fileWatcherMessenger) {
                this.fileWatcherMessenger.sendMessage({
                    type: 'REGISTER_FILE_WATCHER',
                    config,
                });
                return;
            }
            await this.startDaemonIfNecessary();
            const socketPath = this.getSocketPath();
            this.fileWatcherMessenger = new daemon_socket_messenger_1.DaemonSocketMessenger((0, net_1.connect)(socketPath)).listen((message) => {
                try {
                    const parsedMessage = (0, consume_messages_from_socket_1.parseMessage)(message);
                    // A delivered message means the stream is healthy again.
                    this.fileWatcherFramingFailures = 0;
                    if (parsedMessage?.watcherError) {
                        const error = new WatcherFailedError(parsedMessage.watcherError);
                        for (const cb of this.fileWatcherCallbacks.values()) {
                            cb(error, null);
                        }
                        return;
                    }
                    // Notify all callbacks
                    for (const cb of this.fileWatcherCallbacks.values()) {
                        cb(null, parsedMessage);
                    }
                }
                catch (e) {
                    for (const cb of this.fileWatcherCallbacks.values()) {
                        cb(e, null);
                    }
                }
            }, () => {
                // Connection closed - trigger reconnection
                logger_1.clientLogger.log(`[FileWatcher] Socket closed, triggering reconnection`);
                this.fileWatcherMessenger = undefined;
                for (const cb of this.fileWatcherCallbacks.values()) {
                    cb('reconnecting', null);
                }
                this.reconnectFileWatcher();
            }, (err) => {
                if (err instanceof daemon_socket_messenger_1.VersionMismatchError) {
                    for (const cb of this.fileWatcherCallbacks.values()) {
                        cb('closed', null);
                    }
                    process.exit(1);
                }
                for (const cb of this.fileWatcherCallbacks.values()) {
                    cb(err, null);
                }
                if (err instanceof consume_messages_from_socket_1.MessageFramingError) {
                    this.fileWatcherFramingFailures++;
                }
                // Close so 'close' fires and the reconnect path runs; a framing
                // failure would otherwise leave this channel silent forever.
                this.fileWatcherMessenger?.close();
            });
            this.fileWatcherMessenger.sendMessage({
                type: 'REGISTER_FILE_WATCHER',
                config,
            });
        });
        // Return unregister function
        return () => {
            this.fileWatcherCallbacks.delete(callbackId);
            this.fileWatcherConfigs.delete(callbackId);
            // If no more callbacks, close the connection
            if (this.fileWatcherCallbacks.size === 0) {
                this.fileWatcherMessenger?.close();
                this.fileWatcherMessenger = undefined;
            }
        };
    }
    async reconnectFileWatcher() {
        // Guard against concurrent reconnection attempts
        if (this.fileWatcherReconnecting) {
            return;
        }
        // The concurrency guard above is cleared before this method recurses, so it
        // bounds overlap rather than iterations. A framing failure is deterministic
        // — re-dialing replays it — so without this the channel would reconnect and
        // re-fail forever. Reaching a payload over NX_MAX_MESSAGE_SIZE does exactly
        // that on every notification.
        if (this.fileWatcherFramingFailures >= MAX_CONSECUTIVE_FRAMING_FAILURES) {
            logger_1.clientLogger.log(`[FileWatcher] Giving up after ${this.fileWatcherFramingFailures} consecutive framing failures`);
            this.fileWatcherReconnecting = false;
            for (const cb of this.fileWatcherCallbacks.values()) {
                cb('closed', null);
            }
            return;
        }
        if (this.fileWatcherCallbacks.size === 0) {
            return; // No callbacks to reconnect
        }
        this.fileWatcherReconnecting = true;
        logger_1.clientLogger.log(`[FileWatcher] Starting reconnection for ${this.fileWatcherCallbacks.size} callbacks`);
        // Wait for daemon server to be available before trying to reconnect
        let serverAvailable;
        try {
            ({ available: serverAvailable } = await this.waitForServerToBeAvailable({
                ignoreVersionMismatch: false,
            }));
        }
        catch (err) {
            // Version mismatch - pass error to callbacks so they can handle it
            logger_1.clientLogger.log(`[FileWatcher] Error during reconnection: ${err.message}`);
            this.fileWatcherReconnecting = false;
            for (const cb of this.fileWatcherCallbacks.values()) {
                cb(err, null);
            }
            return;
        }
        if (!serverAvailable) {
            // Failed to reconnect after all attempts - notify as closed
            logger_1.clientLogger.log(`[FileWatcher] Failed to reconnect - server unavailable`);
            this.fileWatcherReconnecting = false;
            for (const cb of this.fileWatcherCallbacks.values()) {
                cb('closed', null);
            }
            return;
        }
        try {
            // Try to reconnect
            const socketPath = this.getSocketPath();
            this.fileWatcherMessenger = new daemon_socket_messenger_1.DaemonSocketMessenger((0, net_1.connect)(socketPath)).listen((message) => {
                try {
                    const parsedMessage = (0, consume_messages_from_socket_1.parseMessage)(message);
                    // A delivered message means the stream is healthy again.
                    this.fileWatcherFramingFailures = 0;
                    for (const cb of this.fileWatcherCallbacks.values()) {
                        cb(null, parsedMessage);
                    }
                }
                catch (e) {
                    for (const cb of this.fileWatcherCallbacks.values()) {
                        cb(e, null);
                    }
                }
            }, () => {
                // Connection closed - trigger reconnection again
                this.fileWatcherMessenger = undefined;
                // Reset reconnection flag before triggering reconnection
                this.fileWatcherReconnecting = false;
                for (const cb of this.fileWatcherCallbacks.values()) {
                    cb('reconnecting', null);
                }
                this.reconnectFileWatcher();
            }, (err) => {
                if (err instanceof daemon_socket_messenger_1.VersionMismatchError) {
                    for (const cb of this.fileWatcherCallbacks.values()) {
                        cb('closed', null);
                    }
                    process.exit(1);
                }
                if (err instanceof consume_messages_from_socket_1.MessageFramingError) {
                    this.fileWatcherFramingFailures++;
                }
                // The retry loop is driven by 'close', which a framing failure does
                // not emit, so close explicitly to hand off to it.
                this.fileWatcherMessenger?.close();
            });
            // Re-register all stored configs
            for (const cfg of this.fileWatcherConfigs.values()) {
                this.fileWatcherMessenger.sendMessage({
                    type: 'REGISTER_FILE_WATCHER',
                    config: cfg,
                });
            }
            // Successfully reconnected - notify callbacks
            logger_1.clientLogger.log(`[FileWatcher] Reconnected successfully`);
            for (const cb of this.fileWatcherCallbacks.values()) {
                cb('reconnected', null);
            }
            this.fileWatcherReconnecting = false;
        }
        catch (e) {
            // Failed to reconnect - notify as closed
            logger_1.clientLogger.log(`[FileWatcher] Reconnection failed: ${e.message}`);
            this.fileWatcherReconnecting = false;
            for (const cb of this.fileWatcherCallbacks.values()) {
                cb('closed', null);
            }
        }
    }
    async registerProjectGraphRecomputationListener(callback) {
        // Generate unique ID for this callback
        const callbackId = Math.random().toString(36).substring(2, 11);
        // Store callback
        this.projectGraphListenerCallbacks.set(callbackId, callback);
        await this.queue.sendToQueue(async () => {
            // If we already have a connection, just send the registration
            if (this.projectGraphListenerMessenger) {
                this.projectGraphListenerMessenger.sendMessage({
                    type: register_project_graph_listener_1.REGISTER_PROJECT_GRAPH_LISTENER,
                });
                return;
            }
            await this.startDaemonIfNecessary();
            const socketPath = this.getSocketPath();
            this.projectGraphListenerMessenger = new daemon_socket_messenger_1.DaemonSocketMessenger((0, net_1.connect)(socketPath)).listen((message) => {
                try {
                    const parsedMessage = (0, consume_messages_from_socket_1.parseMessage)(message);
                    // A delivered message means the stream is healthy again.
                    this.projectGraphListenerFramingFailures = 0;
                    // Notify all callbacks
                    for (const cb of this.projectGraphListenerCallbacks.values()) {
                        cb(null, parsedMessage);
                    }
                }
                catch (e) {
                    for (const cb of this.projectGraphListenerCallbacks.values()) {
                        cb(e, null);
                    }
                }
            }, () => {
                // Connection closed - trigger reconnection
                logger_1.clientLogger.log(`[ProjectGraphListener] Socket closed, triggering reconnection`);
                this.projectGraphListenerMessenger = undefined;
                for (const cb of this.projectGraphListenerCallbacks.values()) {
                    cb('reconnecting', null);
                }
                this.reconnectProjectGraphListener();
            }, (err) => {
                if (err instanceof daemon_socket_messenger_1.VersionMismatchError) {
                    for (const cb of this.projectGraphListenerCallbacks.values()) {
                        cb('closed', null);
                    }
                    process.exit(1);
                }
                for (const cb of this.projectGraphListenerCallbacks.values()) {
                    cb(err, null);
                }
                if (err instanceof consume_messages_from_socket_1.MessageFramingError) {
                    this.projectGraphListenerFramingFailures++;
                }
                this.projectGraphListenerMessenger?.close();
            });
            this.projectGraphListenerMessenger.sendMessage({
                type: register_project_graph_listener_1.REGISTER_PROJECT_GRAPH_LISTENER,
            });
        });
        // Return unregister function
        return () => {
            this.projectGraphListenerCallbacks.delete(callbackId);
            // If no more callbacks, close the connection
            if (this.projectGraphListenerCallbacks.size === 0) {
                this.projectGraphListenerMessenger?.close();
                this.projectGraphListenerMessenger = undefined;
            }
        };
    }
    async reconnectProjectGraphListener() {
        // Guard against concurrent reconnection attempts
        if (this.projectGraphListenerReconnecting) {
            return;
        }
        // See reconnectFileWatcher: a framing failure repeats on every redial, so
        // the concurrency guard alone cannot bound it.
        if (this.projectGraphListenerFramingFailures >=
            MAX_CONSECUTIVE_FRAMING_FAILURES) {
            logger_1.clientLogger.log(`[ProjectGraphListener] Giving up after ${this.projectGraphListenerFramingFailures} consecutive framing failures`);
            this.projectGraphListenerReconnecting = false;
            for (const cb of this.projectGraphListenerCallbacks.values()) {
                cb('closed', null);
            }
            return;
        }
        if (this.projectGraphListenerCallbacks.size === 0) {
            return; // No callbacks to reconnect
        }
        this.projectGraphListenerReconnecting = true;
        logger_1.clientLogger.log(`[ProjectGraphListener] Starting reconnection for ${this.projectGraphListenerCallbacks.size} callbacks`);
        // Wait for daemon server to be available before trying to reconnect
        let serverAvailable;
        try {
            ({ available: serverAvailable } = await this.waitForServerToBeAvailable({
                ignoreVersionMismatch: false,
            }));
        }
        catch (err) {
            // Version mismatch - pass error to callbacks so they can handle it
            logger_1.clientLogger.log(`[ProjectGraphListener] Error during reconnection: ${err.message}`);
            this.projectGraphListenerReconnecting = false;
            for (const cb of this.projectGraphListenerCallbacks.values()) {
                cb(err, null);
            }
            return;
        }
        if (!serverAvailable) {
            // Failed to reconnect after all attempts - notify as closed
            logger_1.clientLogger.log(`[ProjectGraphListener] Failed to reconnect - server unavailable`);
            this.projectGraphListenerReconnecting = false;
            for (const cb of this.projectGraphListenerCallbacks.values()) {
                cb('closed', null);
            }
            return;
        }
        try {
            const socketPath = this.getSocketPath();
            // Try to reconnect
            this.projectGraphListenerMessenger = new daemon_socket_messenger_1.DaemonSocketMessenger((0, net_1.connect)(socketPath)).listen((message) => {
                try {
                    const parsedMessage = (0, consume_messages_from_socket_1.parseMessage)(message);
                    // A delivered message means the stream is healthy again.
                    this.projectGraphListenerFramingFailures = 0;
                    for (const cb of this.projectGraphListenerCallbacks.values()) {
                        cb(null, parsedMessage);
                    }
                }
                catch (e) {
                    for (const cb of this.projectGraphListenerCallbacks.values()) {
                        cb(e, null);
                    }
                }
            }, () => {
                // Connection closed - trigger reconnection again
                this.projectGraphListenerMessenger = undefined;
                // Reset reconnection flag before triggering reconnection
                this.projectGraphListenerReconnecting = false;
                for (const cb of this.projectGraphListenerCallbacks.values()) {
                    cb('reconnecting', null);
                }
                this.reconnectProjectGraphListener();
            }, (err) => {
                if (err instanceof daemon_socket_messenger_1.VersionMismatchError) {
                    for (const cb of this.projectGraphListenerCallbacks.values()) {
                        cb('closed', null);
                    }
                    process.exit(1);
                }
                if (err instanceof consume_messages_from_socket_1.MessageFramingError) {
                    this.projectGraphListenerFramingFailures++;
                }
                // The retry loop is driven by 'close', which a framing failure does
                // not emit, so close explicitly to hand off to it.
                this.projectGraphListenerMessenger?.close();
            });
            // Re-register
            this.projectGraphListenerMessenger.sendMessage({
                type: register_project_graph_listener_1.REGISTER_PROJECT_GRAPH_LISTENER,
            });
            // Successfully reconnected - notify callbacks
            logger_1.clientLogger.log(`[ProjectGraphListener] Reconnected successfully`);
            for (const cb of this.projectGraphListenerCallbacks.values()) {
                cb('reconnected', null);
            }
            this.projectGraphListenerReconnecting = false;
        }
        catch (e) {
            // Failed to reconnect - notify as closed
            logger_1.clientLogger.log(`[ProjectGraphListener] Reconnection failed: ${e.message}`);
            this.projectGraphListenerReconnecting = false;
            for (const cb of this.projectGraphListenerCallbacks.values()) {
                cb('closed', null);
            }
        }
    }
    processInBackground(requirePath, data) {
        return this.sendToDaemonViaQueue({
            type: 'PROCESS_IN_BACKGROUND',
            requirePath,
            data,
        }, 
        // This method is sometimes passed data that cannot be serialized with v8
        // so we force JSON serialization here
        'json');
    }
    recordOutputsHashBatch(entries) {
        return this.sendToDaemonViaQueue({
            type: 'RECORD_OUTPUTS_HASH_BATCH',
            data: entries,
        });
    }
    outputsHashesMatchBatch(entries) {
        return this.sendToDaemonViaQueue({
            type: 'OUTPUTS_HASHES_MATCH_BATCH',
            data: entries,
        });
    }
    glob(globs, exclude) {
        const message = {
            type: 'GLOB',
            globs,
            exclude,
        };
        return this.sendToDaemonViaQueue(message);
    }
    multiGlob(globs, exclude) {
        const message = {
            type: 'MULTI_GLOB',
            globs,
            exclude,
        };
        return this.sendToDaemonViaQueue(message);
    }
    getWorkspaceContextFileData() {
        const message = {
            type: get_context_file_data_1.GET_CONTEXT_FILE_DATA,
        };
        return this.sendToDaemonViaQueue(message);
    }
    getWorkspaceFiles(projectRootMap) {
        const message = {
            type: get_nx_workspace_files_1.GET_NX_WORKSPACE_FILES,
            projectRootMap,
        };
        return this.sendToDaemonViaQueue(message);
    }
    getFilesInDirectory(dir) {
        const message = {
            type: get_files_in_directory_1.GET_FILES_IN_DIRECTORY,
            dir,
        };
        return this.sendToDaemonViaQueue(message);
    }
    hashGlob(globs, exclude) {
        const message = {
            type: hash_glob_1.HASH_GLOB,
            globs,
            exclude,
        };
        return this.sendToDaemonViaQueue(message);
    }
    hashMultiGlob(globGroups) {
        const message = {
            type: hash_glob_1.HASH_MULTI_GLOB,
            globGroups: globGroups,
        };
        return this.sendToDaemonViaQueue(message);
    }
    getFlakyTasks(hashes) {
        const message = {
            type: task_history_1.GET_FLAKY_TASKS,
            hashes,
        };
        return this.sendToDaemonViaQueue(message);
    }
    async getEstimatedTaskTimings(targets) {
        const message = {
            type: task_history_1.GET_ESTIMATED_TASK_TIMINGS,
            targets,
        };
        return this.sendToDaemonViaQueue(message);
    }
    recordTaskRuns(taskRuns) {
        const message = {
            type: task_history_1.RECORD_TASK_RUNS,
            taskRuns,
        };
        return this.sendToDaemonViaQueue(message);
    }
    getSyncGeneratorChanges(generators) {
        const message = {
            type: get_sync_generator_changes_1.GET_SYNC_GENERATOR_CHANGES,
            generators,
        };
        return this.sendToDaemonViaQueue(message);
    }
    flushSyncGeneratorChangesToDisk(generators) {
        const message = {
            type: flush_sync_generator_changes_to_disk_1.FLUSH_SYNC_GENERATOR_CHANGES_TO_DISK,
            generators,
        };
        return this.sendToDaemonViaQueue(message);
    }
    getRegisteredSyncGenerators() {
        const message = {
            type: get_registered_sync_generators_1.GET_REGISTERED_SYNC_GENERATORS,
        };
        return this.sendToDaemonViaQueue(message);
    }
    updateWorkspaceContext(createdFiles, updatedFiles, deletedFiles) {
        const message = {
            type: update_workspace_context_1.UPDATE_WORKSPACE_CONTEXT,
            createdFiles,
            updatedFiles,
            deletedFiles,
        };
        return this.sendToDaemonViaQueue(message);
    }
    async runPreTasksExecution(context) {
        const message = {
            type: run_tasks_execution_hooks_1.PRE_TASKS_EXECUTION,
            context,
        };
        return this.sendToDaemonViaQueue(message);
    }
    async runPostTasksExecution(context) {
        const message = {
            type: run_tasks_execution_hooks_1.POST_TASKS_EXECUTION,
            context,
        };
        return this.sendToDaemonViaQueue(message);
    }
    getNxConsoleStatus() {
        const message = {
            type: nx_console_1.GET_NX_CONSOLE_STATUS,
        };
        return this.sendToDaemonViaQueue(message);
    }
    setNxConsolePreferenceAndInstall(preference) {
        const message = {
            type: nx_console_1.SET_NX_CONSOLE_PREFERENCE_AND_INSTALL,
            preference,
        };
        return this.sendToDaemonViaQueue(message);
    }
    getConfigureAiAgentsStatus() {
        const message = {
            type: configure_ai_agents_1.GET_CONFIGURE_AI_AGENTS_STATUS,
        };
        return this.sendToDaemonViaQueue(message);
    }
    resetConfigureAiAgentsStatus() {
        const message = {
            type: configure_ai_agents_1.RESET_CONFIGURE_AI_AGENTS_STATUS,
        };
        return this.sendToDaemonViaQueue(message);
    }
    /**
     * The pre-start probe, returning why it failed rather than leaving it on the
     * instance: `_daemonStatus` does not serialize `isServerAvailable`'s five
     * public callers against `startDaemonIfNecessary`.
     */
    async probeServer() {
        return new Promise((resolve, reject) => {
            try {
                const socketPath = this.getSocketPath();
                if (!socketPath) {
                    resolve({ available: false });
                    return;
                }
                const socket = (0, net_1.connect)(socketPath, () => {
                    socket.destroy();
                    resolve({ available: true });
                });
                socket.once('error', (err) => {
                    // The only place the errno for "the socket is there but refuses us"
                    // is produced, and the only thing separating it from "no daemon yet".
                    resolve({ available: false, refusal: { error: err, socketPath } });
                });
            }
            catch (err) {
                if (err instanceof daemon_socket_messenger_1.VersionMismatchError) {
                    reject(err); // Let version mismatch bubble up
                }
                resolve({ available: false });
            }
        });
    }
    async isServerAvailable() {
        return (await this.probeServer()).available;
    }
    async startDaemonIfNecessary() {
        if (this._daemonStatus == DaemonStatus.CONNECTED) {
            return;
        }
        // Ensure daemon is running and socket path is available
        if (this._daemonStatus == DaemonStatus.DISCONNECTED) {
            this._daemonStatus = DaemonStatus.CONNECTING;
            let daemonPid = null;
            let probe;
            try {
                probe = await this.probeServer();
            }
            catch (err) {
                // Version mismatch - treat as server not available, start new one
                if (err instanceof daemon_socket_messenger_1.VersionMismatchError) {
                    probe = { available: false };
                }
                else {
                    throw err;
                }
            }
            if (!probe.available) {
                // Carried as a value so no other caller's probe can substitute for it.
                daemonPid = await this.startInBackground(probe.refusal);
            }
            this.setUpConnection();
            this._daemonStatus = DaemonStatus.CONNECTED;
            this._daemonReady();
            daemonPid ??= (0, cache_1.getDaemonProcessIdSync)();
            // Fire-and-forget - don't block daemon connection by waiting for metrics registration
            this.registerDaemonProcessWithMetricsService(daemonPid);
        }
        else if (this._daemonStatus == DaemonStatus.CONNECTING) {
            await this._waitForDaemonReady;
            const daemonPid = (0, cache_1.getDaemonProcessIdSync)();
            // Fire-and-forget - don't block daemon connection by waiting for metrics registration
            this.registerDaemonProcessWithMetricsService(daemonPid);
        }
    }
    async sendToDaemonViaQueue(messageToDaemon, parser) {
        return this.queue.sendToQueue(async () => {
            // Set currentSpinner inside the queued function so it's only
            // active while this specific message is in flight — preventing
            // concurrent callers from overwriting each other's spinner
            // reference before their turn arrives.
            return await this.sendMessageToDaemon(messageToDaemon, parser);
        });
    }
    setUpConnection() {
        const socketPath = this.getSocketPath();
        const socket = (0, net_1.connect)(socketPath);
        // Unref the socket so it doesn't keep the process alive. The
        // sendMessageToDaemon method uses a keep-alive setTimeout to
        // explicitly hold the event loop open while awaiting a response.
        socket.unref();
        this.socketMessenger = new daemon_socket_messenger_1.DaemonSocketMessenger(socket).listen((message) => this.handleMessage(message), () => {
            // it's ok for the daemon to terminate if the client doesn't wait on
            // any messages from the daemon
            if (this.queue.isEmpty()) {
                this.reset();
            }
            else {
                // Connection closed while we had pending work - try to reconnect
                this._daemonStatus = DaemonStatus.DISCONNECTED;
                this.handleConnectionError(daemonProcessException('Daemon process terminated and closed the connection'));
            }
        }, (err) => {
            // Every recovery path below is keyed on the socket 'close' event, and a
            // framing failure emits neither 'close' nor 'error'. Without the
            // teardown at the end of this handler the connection stays open and
            // permanently deaf, and the next request waits out the keep-alive.
            if (!err.message) {
                this.currentReject(daemonProcessException(err.toString()));
                this.socketMessenger?.close();
                return;
            }
            let error;
            if ((0, permission_errors_1.isPermissionDenied)(err)) {
                // Checked before the ENOENT branch so a refusal can never be read as
                // an absent socket. The 0700 dir and 0600 socket mean the OS refuses
                // this rather than the connect silently succeeding.
                error = daemonPermissionException(socketPath, err.message);
            }
            else if (err.code === 'ENOENT') {
                error = daemonProcessException([
                    'The Daemon Server is not running',
                    // A denied bind leaves no socket file behind, so the client sees
                    // a missing socket rather than a refused connection. Outside a
                    // sandbox this is just the ordinary "not started yet" case.
                    ...((0, is_sandbox_1.isSandbox)() ? (0, sandbox_socket_hint_1.sandboxSocketHint)() : []),
                ].join('\n'));
            }
            else if (err.message.startsWith('connect ECONNREFUSED')) {
                error = daemonProcessException(`A server instance had not been fully shut down. Please try running the command again.`);
            }
            else if (err.message.startsWith('read ECONNRESET')) {
                error = daemonProcessException(`Unable to connect to the daemon process.`);
            }
            else {
                error = daemonProcessException(err.toString());
            }
            this.currentReject(error);
            this.socketMessenger?.close();
        });
    }
    async handleConnectionError(error) {
        logger_1.clientLogger.log(`[Reconnect] Connection error detected: ${error.message}`);
        // Create a new ready promise for new requests to wait on
        this._waitForDaemonReady = new Promise((resolve) => (this._daemonReady = resolve));
        // Set status to CONNECTING so new requests will wait for reconnection
        this._daemonStatus = DaemonStatus.CONNECTING;
        let serverAvailable;
        try {
            ({ available: serverAvailable } = await this.waitForServerToBeAvailable({
                ignoreVersionMismatch: false,
            }));
        }
        catch (err) {
            if (err instanceof daemon_socket_messenger_1.VersionMismatchError) {
                // New daemon has different version - reject with error so caller can handle
                if (this.currentReject) {
                    this.currentReject(err);
                }
                return;
            }
            throw err;
        }
        if (serverAvailable) {
            logger_1.clientLogger.log(`[Reconnect] Reconnection successful, re-establishing connection`);
            // Server is back up, establish connection and signal ready
            this.establishConnection();
            // Resend the pending message if one exists
            if (this.currentMessage && this.currentResolve && this.currentReject) {
                // Retry the message directly (not through the queue) to resolve the
                // pending promise that the original queue entry is waiting on.
                // This allows the original queue entry to complete naturally.
                const msg = this.currentMessage;
                const res = this.currentResolve;
                const rej = this.currentReject;
                this.sendMessageToDaemon(msg).then(res, rej);
            }
        }
        else {
            // Failed to reconnect after all attempts, reject the pending request
            if (this.currentReject) {
                this.currentReject(error);
            }
        }
    }
    establishConnection() {
        this._daemonStatus = DaemonStatus.DISCONNECTED;
        this.setUpConnection();
        this._daemonStatus = DaemonStatus.CONNECTED;
        this._daemonReady();
    }
    /**
     * Wait for daemon server to be available.
     * Used for reconnection - throws VersionMismatchError if daemon version differs.
     */
    async waitForServerToBeAvailable(options) {
        logger_1.clientLogger.log(`[Client] Waiting for server (max: ${WAIT_FOR_SERVER_CONFIG.maxAttempts} attempts, ${WAIT_FOR_SERVER_CONFIG.delayMs}ms interval)`);
        // Poll-scoped, not instance state: reconnect paths have their own flags, so
        // several attempts can be in flight and a shared slot would let one report
        // another's socket.
        let stoppedOnRefusal = false;
        let refusal;
        const socket = await (0, wait_for_socket_connection_1.waitForSocketConnection)(() => {
            try {
                return this.getSocketPath();
            }
            catch (err) {
                if (err instanceof daemon_socket_messenger_1.VersionMismatchError) {
                    if (!options.ignoreVersionMismatch) {
                        throw err;
                    }
                }
                // Socket path not available yet — keep polling
                return null;
            }
        }, {
            maxAttempts: WAIT_FOR_SERVER_CONFIG.maxAttempts,
            delayMs: WAIT_FOR_SERVER_CONFIG.delayMs,
            onConnectError: (error, socketPath) => {
                refusal = { error, socketPath };
                // A refusal is not expected to become an acceptance, so polling the
                // full 60s budget only delays the same answer. Not absolute:
                // `server.ts` binds before it chmods to 0600, so under a umask that
                // strips owner write a same-user connect can lose a microsecond race
                // and see EACCES. That costs a specific error rather than a retry — a
                // better trade than a 60s hang.
                return (stoppedOnRefusal = (0, permission_errors_1.isPermissionDenied)(error));
            },
        });
        if (socket) {
            socket.destroy();
            logger_1.clientLogger.log(`[Client] Server available`);
            return { available: true };
        }
        // Keyed on the early exit taken, not on whether an errno was recorded:
        // every failed connect records one, including an ordinary cold start's
        // ENOENT.
        logger_1.clientLogger.log(stoppedOnRefusal
            ? `[Client] Server refused the connection (${refusal?.error.code}), stopped polling`
            : `[Client] Server not available after ${WAIT_FOR_SERVER_CONFIG.maxAttempts} attempts`);
        return { available: false, refusal };
    }
    async sendMessageToDaemon(message, force) {
        // the first message sent to the daemon includes an env prop
        // that updates the process.env values on the daemon.
        if (!this.envReflectionSent && !global.NX_PLUGIN_WORKER) {
            message.env = (0, daemon_environment_1.getDaemonEnv)();
            this.envReflectionSent = true;
        }
        await this.startDaemonIfNecessary();
        let keepAlive;
        return new Promise((resolve, reject) => {
            perf_hooks_1.performance.mark('sendMessageToDaemon-start');
            // An open promise isn't enough to keep the event loop
            // alive, so we set a timeout here and clear it when we hear
            // back. This **must** be longer than the message timeout used
            // in the plugin isolation messages, or the daemon will timeout before
            // a plugin worker would, and that can result in odd exit behavior.
            keepAlive = setTimeout(() => {
                reject(new Error('The daemon timed out while processing ' + message.type));
            }, 20 * 60 * 1000);
            this.currentMessage = message;
            this.currentResolve = resolve;
            this.currentReject = reject;
            this.socketMessenger.sendMessage(message, force);
        }).finally(() => {
            clearTimeout(keepAlive);
        });
    }
    async registerDaemonProcessWithMetricsService(daemonPid) {
        if (!daemonPid) {
            return;
        }
        try {
            const { getProcessMetricsService } = await (0, handle_import_1.handleImport)('../../tasks-runner/process-metrics-service.js', __dirname);
            getProcessMetricsService().registerDaemonProcess(daemonPid);
        }
        catch {
            // don't error, this is a secondary concern that should not break task execution
        }
    }
    handleMessage(serializedResult) {
        try {
            perf_hooks_1.performance.mark('result-parse-start-' + this.currentMessage.type);
            const parsedResult = (0, consume_messages_from_socket_1.parseMessage)(serializedResult);
            perf_hooks_1.performance.mark('result-parse-end-' + this.currentMessage.type);
            perf_hooks_1.performance.measure('deserialize daemon response - ' + this.currentMessage.type, 'result-parse-start-' + this.currentMessage.type, 'result-parse-end-' + this.currentMessage.type);
            // Streaming messages fire side-effects on the client but do not
            // resolve the pending request promise — the daemon can push several
            // of these before finally sending the real response. Progress
            // updates route through the in-flight request's own spinner so
            // we don't stomp on unrelated commands' spinner text.
            if ((0, streaming_messages_1.isUpdateProgressMessage)(parsedResult)) {
                this.currentSpinner?.setMessage(parsedResult.message);
                return;
            }
            if ((0, streaming_messages_1.isEmitLogMessage)(parsedResult)) {
                console[parsedResult.level](parsedResult.message);
                return;
            }
            if (parsedResult.error) {
                this.currentReject(parsedResult.error);
            }
            else {
                perf_hooks_1.performance.measure(`${this.currentMessage.type} round trip`, 'sendMessageToDaemon-start', 'result-parse-end-' + this.currentMessage.type);
                return this.currentResolve(parsedResult);
            }
        }
        catch (e) {
            const endOfResponse = (0, consume_messages_from_socket_1.describeMessage)(serializedResult, {
                from: 'end',
            });
            this.currentReject(daemonProcessException([
                'Could not deserialize response from Nx daemon.',
                `Message: ${e.message}`,
                '\n',
                `Received:`,
                endOfResponse,
                '\n',
            ].join('\n')));
        }
    }
    /**
     * @param probeRefusal what the caller's pre-start probe saw. The only evidence
     *        when a daemon refuses us and then exits — the poll cannot reproduce it
     *        once the process json is gone. `nx daemon --start` passes nothing.
     */
    async startInBackground(probeRefusal) {
        if (global.NX_PLUGIN_WORKER) {
            throw new Error('Fatal Error: Something unexpected has occurred. Plugin Workers should not start a new daemon process. Please report this issue.');
        }
        (0, node_fs_1.mkdirSync)(tmp_dir_1.DAEMON_DIR_FOR_CURRENT_WORKSPACE, { recursive: true });
        if (!(0, node_fs_1.existsSync)(tmp_dir_1.DAEMON_OUTPUT_LOG_FILE)) {
            (0, node_fs_1.writeFileSync)(tmp_dir_1.DAEMON_OUTPUT_LOG_FILE, '');
        }
        // Redirect the detached daemon's stdout/stderr into the log file. The
        // child dup's these descriptors at spawn, so we close ours right after
        // instead of holding them for the life of this process (Node >=26 turns a
        // file descriptor closed during garbage collection into a fatal error).
        const outFd = (0, node_fs_1.openSync)(tmp_dir_1.DAEMON_OUTPUT_LOG_FILE, 'a');
        const errFd = (0, node_fs_1.openSync)(tmp_dir_1.DAEMON_OUTPUT_LOG_FILE, 'a');
        logger_1.clientLogger.log(`[Client] Starting new daemon server in background`);
        const backgroundProcess = (0, child_process_1.spawn)(process.execPath, [
            // Spawn with the same resolve conditions Nx uses for plugin entries so a
            // source-loaded plugin's transitive workspace imports resolve to source.
            ...(0, typescript_1.getPluginResolveConditionNodeArgs)(),
            (0, path_1.join)(__dirname, `../server/start.js`),
        ], {
            cwd: workspace_root_1.workspaceRoot,
            stdio: ['ignore', outFd, errFd],
            detached: true,
            windowsHide: true,
            shell: false,
            env: (0, daemon_environment_1.getDaemonSpawnEnv)(),
        });
        // The child now owns dup'd copies of the descriptors, so release ours.
        (0, node_fs_1.closeSync)(outFd);
        (0, node_fs_1.closeSync)(errFd);
        // A refused bind leaves no socket, so the poll below sees only ENOENT and
        // cannot tell a sandbox refusal from a daemon that has not come up yet. The
        // server exits with SOCKET_REFUSED_EXIT_CODE when its own bind hits
        // EPERM/EACCES, which is the only way that errno reaches this process.
        // Attached before `unref` so the listener is registered before the child can
        // exit; `unref` only stops the child holding the event loop open.
        let daemonRefusedSocket = false;
        backgroundProcess.once('exit', (code) => {
            daemonRefusedSocket = code === socket_refused_exit_code_1.SOCKET_REFUSED_EXIT_CODE;
        });
        // if this process is the process that spawned the daemon,
        // the daemon env is already up to date
        this.envReflectionSent = true;
        backgroundProcess.unref();
        /**
         * Ensure the server is actually available to connect to via IPC before resolving
         */
        const { available, refusal: polled } = await this.waitForServerToBeAvailable({ ignoreVersionMismatch: true });
        if (available) {
            logger_1.clientLogger.log(`[Client] Daemon server started, pid=${backgroundProcess.pid}`);
            return backgroundProcess.pid;
        }
        else {
            // A permission refusal from either source wins, then the poll's errno,
            // then the probe's. Recency alone would report a daemon's ENOENT over the
            // EACCES the probe saw a moment earlier, losing the diagnosis.
            const refusal = [polled, probeRefusal].find((r) => r && (0, permission_errors_1.isPermissionDenied)(r.error)) ??
                polled ??
                probeRefusal;
            if (refusal && (0, permission_errors_1.isPermissionDenied)(refusal.error)) {
                // Reported here rather than as a generic startup failure, so it degrades
                // without disabling the daemon until `nx reset`. Both operands come from
                // the refusal: resolving a path here instead would throw once a daemon
                // that failed to bind has unlinked its process json.
                throw daemonPermissionException(refusal.socketPath, refusal.error.message);
            }
            throw daemonProcessException([
                'Failed to start or connect to the Nx Daemon process.',
                // The daemon can fail to start for many reasons, so the guidance is
                // withheld unless its own errno proved a refusal or the environment
                // already says a sandbox is in play. The errno arm is what reaches an
                // agent whose sandbox `isSandbox()` cannot see, such as Copilot CLI.
                ...(daemonRefusedSocket || (0, is_sandbox_1.isSandbox)()
                    ? (0, sandbox_socket_hint_1.sandboxSocketHint)({ certain: daemonRefusedSocket })
                    : []),
            ].join('\n'));
        }
    }
    async stop() {
        try {
            const pid = (0, cache_1.getDaemonProcessIdSync)();
            if (pid) {
                process.kill(pid, 'SIGTERM');
            }
        }
        catch (err) {
            if (err.code !== 'ESRCH') {
                output_1.output.error({
                    title: err?.message ||
                        'Something unexpected went wrong when stopping the daemon server',
                });
            }
        }
        (0, tmp_dir_1.removeSocketDir)();
    }
}
exports.DaemonClient = DaemonClient;
exports.daemonClient = new DaemonClient();
function isDaemonEnabled() {
    return exports.daemonClient.enabled();
}
function isDocker() {
    try {
        (0, node_fs_1.statSync)('/.dockerenv');
        return true;
    }
    catch {
        try {
            return (0, node_fs_1.readFileSync)('/proc/self/cgroup', 'utf8')?.includes('docker');
        }
        catch { }
        return false;
    }
}
function nxJsonIsNotPresent() {
    return !(0, nx_json_1.hasNxJson)(workspace_root_1.workspaceRoot);
}
/**
 * The operating system refused the connection. Most often the socket belongs to
 * another user, which is the guarantee the owner-only socket directory buys —
 * but a sandbox that denies unix-socket connects produces the same errno, so the
 * message does not assert which. Either way it is an environment condition
 * rather than a defect in Nx, and it deliberately does not
 * carry `internalDaemonError`: that tag tells the user to file an issue and
 * disables the daemon until `nx reset`, which would outlast the stale socket
 * that caused it.
 *
 * It also skips the daemon log that `daemonProcessException` appends. The log
 * belongs to *our* daemon; the process holding this socket is someone else's, so
 * quoting it would describe an unrelated run.
 */
function daemonPermissionException(socketPath, cause) {
    const error = new Error([
        `The operating system refused the connection to the Nx Daemon socket (${cause}).`,
        '',
        `Socket: ${socketPath}`,
        '',
        'Most often the socket belongs to a different user: a daemon left behind by running Nx under `sudo`, a different uid inside a container, or a working copy shared between accounts. If the socket is your own, a sandbox is refusing the connection instead.',
        'If it belongs to another user, delete the socket above or set NX_SOCKET_DIR to a directory only your user can reach. If you are in a sandbox, allow unix sockets under the Nx socket root: `nx configure-ai-agents` writes that for Claude Code, and the per-agent setting is listed at https://nx.dev/docs/kb/nx-sandbox-unix-sockets',
    ].join('\n'));
    error.daemonPermissionError = true;
    return error;
}
/**
 * Exported for testing: the `internalDaemonError` tag decides whether a daemon
 * failure degrades to a daemonless graph build or aborts the command.
 */
function daemonProcessException(message) {
    // The log is an enrichment, not the classifier: it is absent on a first run,
    // which is exactly when the daemon is most likely to fail to start.
    let body = message;
    try {
        let log = (0, node_fs_1.readFileSync)(tmp_dir_1.DAEMON_OUTPUT_LOG_FILE).toString().split('\n');
        if (log.length > 20) {
            log = log.slice(log.length - 20);
        }
        body = [
            message,
            '',
            'Messages from the log:',
            ...log,
            '\n',
            `More information: ${tmp_dir_1.DAEMON_OUTPUT_LOG_FILE}`,
        ].join('\n');
    }
    catch { }
    const error = new Error(body);
    error.internalDaemonError = true;
    return error;
}
