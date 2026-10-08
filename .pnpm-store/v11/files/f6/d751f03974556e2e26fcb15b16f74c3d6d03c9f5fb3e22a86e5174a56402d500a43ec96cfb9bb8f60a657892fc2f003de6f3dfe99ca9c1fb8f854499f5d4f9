import { Socket } from 'net';
export declare let registeredFileWatcherSockets: {
    socket: Socket;
    config: {
        watchProjects: string[] | 'all';
        includeGlobalWorkspaceFiles: boolean;
        includeDependencies: boolean;
    };
}[];
export declare function removeRegisteredFileWatcherSocket(socket: Socket): void;
export declare function hasRegisteredFileWatcherSockets(): boolean;
/**
 * The workspace watcher has died; no further change events will ever arrive.
 * Registered clients are passive, so without this push they wait forever.
 */
export declare function notifyFileWatcherSocketsOfError(error: Error): void;
export declare function notifyFileWatcherSockets(createdFiles: string[] | null, updatedFiles: string[], deletedFiles: string[]): void;
