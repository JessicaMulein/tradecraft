/**
 * Why a directory was refused. Named rather than a boolean so a table entry
 * reads as its own reason: picking the wrong one tells a user their private
 * directory is a code-execution risk, which is the one claim here that most
 * needs to be true.
 */
export type SocketDirRefusal = 'shared-with-other-users' | 'nx-managed' | 'os-temp-root';
/**
 * Thrown when the socket dir resolves to a directory Nx will not accept.
 * Invalid configuration, not a recoverable failure.
 *
 * Three reasons, and they are not interchangeable. A directory other users can
 * reach is a security problem; the OS temp root is the user's own but holds
 * everything else that uses it, and Nx deletes the socket directory
 * recursively; an Nx container or cache root is refused because Nx manages what
 * lives there. Telling someone their own `0700` directory lets a local attacker
 * execute code would be false, which is why the reason is derived from the
 * directory rather than the platform.
 */
export declare class InvalidSocketDirConfigured extends Error {
    readonly dir: string;
    readonly reason: SocketDirRefusal;
    constructor(dir: string, reason: SocketDirRefusal);
}
export declare const DAEMON_DIR_FOR_CURRENT_WORKSPACE: string;
export declare const DAEMON_OUTPUT_LOG_FILE: string;
export declare const getDaemonSocketDir: () => string;
export declare function writeDaemonLogs(error?: string): string;
export declare function markDaemonAsDisabled(reason: string): void;
/**
 * Turns the daemon off for this process only, leaving no marker behind.
 *
 * For a cause that belongs to the environment rather than to the workspace: a
 * sandbox refusing the socket says nothing about the next run from an ordinary
 * terminal, and the marker `markDaemonAsDisabled` writes would follow the
 * checkout there. It would also survive the user doing exactly what Nx told
 * them to do, since nothing clears it but `nx reset`.
 */
export declare function disableDaemonForThisProcess(reason: string): void;
export declare function isDaemonDisabled(): boolean;
export declare function getSocketDir(): string;
/**
 * Plugin worker sockets get their own workspace-scoped directory rather than
 * sitting in the shared system temp dir, which cannot be locked down.
 */
export declare function getPluginSocketDir(): string;
/**
 * Exported for tests: both fallback warnings fire once per process, so a suite
 * that stages either fallback more than once has to clear the latches between
 * cases.
 */
export declare function resetSocketDirWarningsForTesting(): void;
export declare function getSocketDirFallbackCause(): unknown;
/**
 * The NX_SOCKET_DIR that was refused, if that is why we are in the fallback.
 * Reflects the most recent resolution only — both accessors are cleared at the
 * top of every `createOwnerOnlySocketDir` call, and the daemon and plugin socket
 * paths each drive one. Read it immediately after the call that produced the
 * path, which is what `assertValidSocketPath` does.
 */
export declare function getRefusedConfiguredSocketDir(): string | undefined;
export declare function removeSocketDir(): void;
