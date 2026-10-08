import { Socket } from 'net';
import { FileMap, ProjectGraph } from '../../config/project-graph';
import { NxWorkspaceFilesExternals } from '../../native';
import { FileMapCache } from '../../project-graph/nx-deps-cache';
import { ConfigurationSourceMaps } from '../../project-graph/utils/project-configuration/source-maps';
interface SerializedProjectGraph {
    error: Error | null;
    projectGraph: ProjectGraph | null;
    projectFileMapCache: FileMapCache | null;
    serializedProjectGraph: string | null;
    serializedSourceMaps: string | null;
    sourceMaps: ConfigurationSourceMaps | null;
    rustReferences: NxWorkspaceFilesExternals | null;
}
export declare let fileMapWithFiles: {
    fileMap: FileMap;
    rustReferences: NxWorkspaceFilesExternals;
} | undefined;
export declare let currentProjectFileMapCache: FileMapCache | undefined;
export declare let currentProjectGraph: ProjectGraph | undefined;
export declare let currentSourceMaps: ConfigurationSourceMaps | undefined;
export declare function getCachedSerializedProjectGraphPromise(socket?: Socket): Promise<SerializedProjectGraph>;
export declare function scheduleProjectGraphRecomputation(createdFiles: string[], updatedFiles: string[], deletedFiles: string[]): void;
export declare function registerProjectGraphRecomputationListener(listener: (projectGraph: ProjectGraph, sourceMaps: ConfigurationSourceMaps, error: Error | null) => void): void;
/**
 * Discards the cached graph when a graph input outside the file watcher's view
 * (e.g. the daemon env) changes. Clearing the cached promise makes the next
 * request trigger a fresh computation; the generation bump marks any in-flight
 * compute stale so it chains to that successor instead of committing, because
 * a compute passing its chainToLatest checks would serve a graph built under
 * the old input to whoever already awaits it.
 */
export declare function invalidateGraphCache(): void;
/**
 * The current recomputation generation, stamped on queued dotenv events so
 * the pre-serve drain can prove whether a computation started before an
 * event arrived.
 */
export declare function getRecomputationGeneration(): number;
/**
 * Whether the ignore-filtered workspace file map knows `path`. The workspace
 * watcher applies the same ignore rules, so a change to a known file also
 * reaches scheduleProjectGraphRecomputation; an unknown file is either
 * ignored, or created since the last recompute committed.
 */
export declare function isKnownWorkspaceFile(path: string): boolean;
export {};
