import { Socket } from 'net';
/**
 * Polls an IPC socket path until a connection succeeds or the attempt
 * limit / abort signal is reached.
 *
 * @param socketPath - A fixed path string, or a function that resolves
 *   the path on each attempt (useful when the server hasn't written its
 *   socket file yet).
 * @returns The connected socket, or `null` if polling was exhausted or aborted.
 */
export declare function waitForSocketConnection(socketPath: string | (() => string | null), options?: {
    signal?: AbortSignal;
    maxAttempts?: number;
    delayMs?: number;
    /**
     * Called with the errno of each failed connect and the path it was made
     * against. Return `true` to stop polling: a permission refusal does not
     * heal by retrying, and without a way out the caller waits the full budget
     * and then cannot say why.
     *
     * The path is passed rather than left to the caller to recompute — with a
     * resolver it can differ per attempt, and the caller that reports the
     * refusal may no longer be able to resolve one at all.
     */
    onConnectError?: (error: NodeJS.ErrnoException, socketPath: string) => boolean | void;
}): Promise<Socket | null>;
