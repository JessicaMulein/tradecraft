import { ChildProcess } from 'child_process';
import { Socket } from 'net';
import type { PluginConfiguration } from '../../../config/nx-json';
import type { ProjectGraph } from '../../../config/project-graph';
import type { RawProjectGraphDependency } from '../../project-graph-builder';
import { LoadedNxPlugin } from '../loaded-nx-plugin';
import type { CreateDependenciesContext, CreateMetadataContext, CreateNodesContext, CreateNodesResult, PostTasksExecutionContext, PreTasksExecutionContext, ProjectsMetadata } from '../public-api';
import type { PluginWorkerLoadResult } from './messaging';
import { Hook, Phase } from './plugin-lifecycle-manager';
export type LoadResultPayload = Extract<PluginWorkerLoadResult['payload'], {
    success: true;
}>;
export declare class IsolatedPlugin implements LoadedNxPlugin {
    readonly index?: number;
    readonly name: string;
    readonly include?: string[];
    readonly exclude?: string[];
    readonly createNodes?: [
        filePattern: string,
        fn: (matchedFiles: string[], context: CreateNodesContext) => Promise<Array<readonly [plugin: string, file: string, result: CreateNodesResult]>>
    ];
    readonly createDependencies?: (context: CreateDependenciesContext) => Promise<RawProjectGraphDependency[]>;
    readonly createMetadata?: (graph: ProjectGraph, context: CreateMetadataContext) => Promise<ProjectsMetadata>;
    readonly preTasksExecution?: (context: PreTasksExecutionContext) => Promise<NodeJS.ProcessEnv>;
    readonly postTasksExecution?: (context: PostTasksExecutionContext) => Promise<void>;
    private worker;
    private socket;
    private _alive;
    private _connectPromise;
    private txId;
    private pendingCount;
    private responseHandlers;
    private readonly plugin;
    private readonly root;
    private readonly pluginPath;
    private readonly shouldRegisterTSTranspiler;
    private lifecycle;
    private exitHandler;
    /**
     * Creates and loads an isolated plugin worker.
     */
    static load(plugin: PluginConfiguration, root: string, index?: number): Promise<IsolatedPlugin>;
    private constructor();
    private spawnAndConnect;
    /**
     * Drops the worker from service without judging why. The next hook call
     * respawns it through `ensureAlive`.
     */
    private markUnusable;
    private failPendingRequests;
    private handleFramingFailure;
    /**
     * Ensures the worker is alive, restarting it if necessary.
     * Called before each hook execution to handle plugins that were
     * eagerly shutdown (e.g., post-task-only plugins).
     *
     * Uses a stored promise to coalesce concurrent restart attempts
     * so that only one worker is ever spawned at a time.
     */
    private ensureAlive;
    private handleSocketData;
    private sendLoadMessage;
    private setupHooks;
    private generateTxId;
    private sendRequest;
    private shutdownIfInactive;
    setWorkerEnv(env: Record<string, string>): Promise<void>;
    notifyPhaseAborted(phase: Phase, lastCompletedHook: Hook): void;
    shutdown(): void;
    private registerProcessMetrics;
}
export declare function getPluginWorkerSocketId(): string;
export declare function connectToWorker(worker: ChildProcess, ipcPath: string, name: string): Promise<Socket>;
/**
 * Marks a failure to *start or reach* a worker, as distinct from a plugin that
 * loaded and then threw. Only the former can be retried in-process: swallowing
 * the latter would rerun a plugin that already failed on its own merits and
 * bury the real error.
 */
export declare const PLUGIN_WORKER_STARTUP_FAILURE: unique symbol;
/**
 * Set when the worker exited with the socket-refused code. Narrower than
 * {@link PLUGIN_WORKER_STARTUP_FAILURE}, which covers every way a worker can
 * fail to come up, and is what lets the caller degrade on a refusal without
 * also degrading for an OOM kill or a broken install.
 */
export declare const PLUGIN_WORKER_SOCKET_REFUSED: unique symbol;
/**
 * Describes how a worker died for an error message. A `null` code with a signal
 * is an outside kill rather than anything the worker chose, and SIGKILL is what
 * an out-of-memory kill looks like, so both are called out by name.
 */
export declare function describeWorkerExit(code: number | null, signal: NodeJS.Signals | null): string;
export declare function isPluginWorkerStartupFailure(error: unknown): boolean;
export declare function isPluginWorkerSocketRefusal(error: unknown): boolean;
