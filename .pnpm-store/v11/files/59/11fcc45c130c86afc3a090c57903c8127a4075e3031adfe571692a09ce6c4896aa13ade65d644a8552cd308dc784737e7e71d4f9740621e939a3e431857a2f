import type { Socket } from 'net';
export declare const isWindows: boolean;
/**
 * For IPC with the daemon server we use unix sockets or windows named pipes, depending on the user's operating system.
 *
 * See https://nodejs.org/dist/latest-v14.x/docs/api/net.html#net_identifying_paths_for_ipc_connections for a full breakdown
 * of OS differences between Unix domain sockets and named pipes.
 */
export declare const getFullOsSocketPath: () => string;
export declare const getForkedProcessOsSocketPath: (id: string) => string;
export declare const getPluginOsSocketPath: (id: string) => string;
export declare function getPluginSocketFileName(id: string): string;
export declare function killSocketOrPath(): void;
export declare function serializeResult(error: Error | null, serializedProjectGraph: string | null, serializedSourceMaps: string | null): string | null;
/**
 * Serialize using `preferred`, falling back to the other format when it throws.
 * Neither format subsumes the other: JSON cannot represent a BigInt and hits the
 * max string length far sooner, while v8 cannot clone a function.
 *
 * @param data Data to serialize
 * @param preferred Format to attempt first
 * @returns Serialized data as bytes ready to be framed onto a socket
 */
export declare function serializeWithFallback(data: any, preferred: 'v8' | 'json'): Buffer;
/**
 * Serialize data for IPC using the format the user configured.
 *
 * @param data Data to serialize
 * @param force Use this format without falling back. For callers whose data is
 *              known to be unrepresentable in the other format, where a fallback
 *              would only swap one failure for a less obvious one.
 * @returns Serialized data as bytes ready to be framed onto a socket
 */
export declare function serialize(data: any, force?: 'v8' | 'json'): Buffer;
/**
 * Serialize `data` and write it as one framed message.
 *
 * Lives here rather than in `writeMessage` so the framing stays a byte-level
 * primitive: `utils/consume-messages-from-socket` is shared by callers that
 * already hold bytes, and having it reach back into the daemon's serializer
 * would invert the dependency.
 */
export declare function sendMessage(socket: Socket, data: any, force?: 'v8' | 'json', callback?: (err?: Error) => void): void;
