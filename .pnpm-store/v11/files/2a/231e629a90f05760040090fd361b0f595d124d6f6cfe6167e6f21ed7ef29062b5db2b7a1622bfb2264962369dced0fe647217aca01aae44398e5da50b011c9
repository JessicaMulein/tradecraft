import type { FileWatcherCallback } from './watcher';
/**
 * The error a native outputs watcher failure delivered, if one has. Such an
 * error is terminal (the native watch loop exits after delivering it), so the
 * gitignored dotenv edits only that watcher reports stop arriving and a warm
 * graph would go stale silently. The server fails requests closed on it, like
 * a workspace watcher error.
 */
export declare function getOutputsWatcherTerminalError(): Error | undefined;
export declare const handleOutputsChanges: FileWatcherCallback;
