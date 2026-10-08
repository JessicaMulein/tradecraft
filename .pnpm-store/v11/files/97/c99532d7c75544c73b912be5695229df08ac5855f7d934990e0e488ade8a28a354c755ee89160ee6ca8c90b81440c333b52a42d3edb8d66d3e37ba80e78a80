import { ChildProcess } from 'child_process';
import { FileData, ProjectGraph } from '../../config/project-graph';
import { Task, TaskGraph } from '../../config/task-graph';
import { Hash } from '../../hasher/task-hasher';
import { NxWorkspaceFiles, TaskRun, TaskTarget } from '../../native';
import { PostTasksExecutionContext, PreTasksExecutionContext } from '../../project-graph/plugins/public-api';
import { ConfigurationSourceMaps } from '../../project-graph/utils/project-configuration/source-maps';
import type { FlushSyncGeneratorChangesResult, SyncGeneratorRunResult } from '../../utils/sync-generators';
import { type ConfigureAiAgentsStatusResponse } from '../message-types/configure-ai-agents';
import { type NxConsoleStatusResponse, type SetNxConsolePreferenceAndInstallResponse } from '../message-types/nx-console';
/** A refused connect: the errno, and the path it was made against. */
type ConnectRefusal = {
    error: NodeJS.ErrnoException;
    socketPath: string;
};
export type UnregisterCallback = () => void;
export type ChangedFile = {
    path: string;
    type: 'create' | 'update' | 'delete';
};
/**
 * The daemon's workspace watcher died. Nothing it serves will see file changes
 * again, so a watching client has to restart rather than keep waiting.
 */
export declare class WatcherFailedError extends Error {
    constructor(message: string);
}
export declare class DaemonClient {
    private readonly nxJson;
    constructor();
    private queue;
    private socketMessenger;
    private currentMessage;
    private currentResolve;
    private currentReject;
    private currentSpinner;
    private _enabled;
    private _daemonStatus;
    private _waitForDaemonReady;
    private _daemonReady;
    private fileWatcherMessenger;
    private fileWatcherReconnecting;
    private fileWatcherFramingFailures;
    private fileWatcherCallbacks;
    private fileWatcherConfigs;
    private projectGraphListenerMessenger;
    private projectGraphListenerReconnecting;
    private projectGraphListenerFramingFailures;
    private projectGraphListenerCallbacks;
    enabled(): boolean;
    reset(): void;
    private getSocketPath;
    requestShutdown(): Promise<void>;
    getProjectGraphAndSourceMaps(): Promise<{
        projectGraph: ProjectGraph;
        sourceMaps: ConfigurationSourceMaps;
    }>;
    getAllFileData(): Promise<FileData[]>;
    hashTasks(runnerOptions: any, tasks: Task[], taskGraph: TaskGraph, perTaskEnvs: Record<string, NodeJS.ProcessEnv>, cwd: string, collectInputs?: boolean): Promise<Hash[]>;
    registerFileWatcher(config: {
        watchProjects: string[] | 'all';
        includeGlobalWorkspaceFiles?: boolean;
        includeDependencies?: boolean;
        allowPartialGraph?: boolean;
    }, callback: (error: Error | null | 'reconnecting' | 'reconnected' | 'closed', data: {
        changedProjects: string[];
        changedFiles: ChangedFile[];
    } | null) => void): Promise<UnregisterCallback>;
    private reconnectFileWatcher;
    registerProjectGraphRecomputationListener(callback: (error: Error | null | 'reconnecting' | 'reconnected' | 'closed', data: {
        projectGraph: ProjectGraph;
        sourceMaps: ConfigurationSourceMaps;
        error: Error | null;
    } | null) => void): Promise<UnregisterCallback>;
    private reconnectProjectGraphListener;
    processInBackground(requirePath: string, data: any): Promise<any>;
    recordOutputsHashBatch(entries: {
        outputs: string[];
        hash: string;
    }[]): Promise<any>;
    outputsHashesMatchBatch(entries: {
        outputs: string[];
        hash: string;
    }[]): Promise<boolean[]>;
    glob(globs: string[], exclude?: string[]): Promise<string[]>;
    multiGlob(globs: string[], exclude?: string[]): Promise<string[][]>;
    getWorkspaceContextFileData(): Promise<FileData[]>;
    getWorkspaceFiles(projectRootMap: Record<string, string>): Promise<NxWorkspaceFiles>;
    getFilesInDirectory(dir: string): Promise<string[]>;
    hashGlob(globs: string[], exclude?: string[]): Promise<string>;
    hashMultiGlob(globGroups: string[][]): Promise<string[]>;
    getFlakyTasks(hashes: string[]): Promise<string[]>;
    getEstimatedTaskTimings(targets: TaskTarget[]): Promise<Record<string, number>>;
    recordTaskRuns(taskRuns: TaskRun[]): Promise<void>;
    getSyncGeneratorChanges(generators: string[]): Promise<SyncGeneratorRunResult[]>;
    flushSyncGeneratorChangesToDisk(generators: string[]): Promise<FlushSyncGeneratorChangesResult>;
    getRegisteredSyncGenerators(): Promise<{
        globalGenerators: string[];
        taskGenerators: string[];
    }>;
    updateWorkspaceContext(createdFiles: string[], updatedFiles: string[], deletedFiles: string[]): Promise<void>;
    runPreTasksExecution(context: PreTasksExecutionContext): Promise<NodeJS.ProcessEnv[]>;
    runPostTasksExecution(context: PostTasksExecutionContext): Promise<void>;
    getNxConsoleStatus(): Promise<NxConsoleStatusResponse>;
    setNxConsolePreferenceAndInstall(preference: boolean): Promise<SetNxConsolePreferenceAndInstallResponse>;
    getConfigureAiAgentsStatus(): Promise<ConfigureAiAgentsStatusResponse>;
    resetConfigureAiAgentsStatus(): Promise<{
        success: boolean;
    }>;
    /**
     * The pre-start probe, returning why it failed rather than leaving it on the
     * instance: `_daemonStatus` does not serialize `isServerAvailable`'s five
     * public callers against `startDaemonIfNecessary`.
     */
    private probeServer;
    isServerAvailable(): Promise<boolean>;
    private startDaemonIfNecessary;
    private sendToDaemonViaQueue;
    private setUpConnection;
    private handleConnectionError;
    private establishConnection;
    /**
     * Wait for daemon server to be available.
     * Used for reconnection - throws VersionMismatchError if daemon version differs.
     */
    private waitForServerToBeAvailable;
    private envReflectionSent;
    private sendMessageToDaemon;
    private registerDaemonProcessWithMetricsService;
    private handleMessage;
    /**
     * @param probeRefusal what the caller's pre-start probe saw. The only evidence
     *        when a daemon refuses us and then exits — the poll cannot reproduce it
     *        once the process json is gone. `nx daemon --start` passes nothing.
     */
    startInBackground(probeRefusal?: ConnectRefusal): Promise<ChildProcess['pid']>;
    stop(): Promise<void>;
}
export declare const daemonClient: DaemonClient;
export declare function isDaemonEnabled(): boolean;
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
export declare function daemonPermissionException(socketPath: string, cause: string): Error;
/**
 * Exported for testing: the `internalDaemonError` tag decides whether a daemon
 * failure degrades to a daemonless graph build or aborts the command.
 */
export declare function daemonProcessException(message: string): Error;
export {};
