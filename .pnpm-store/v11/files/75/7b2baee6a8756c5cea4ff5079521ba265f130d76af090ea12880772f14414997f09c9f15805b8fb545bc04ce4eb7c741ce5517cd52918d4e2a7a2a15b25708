import type { Socket } from 'net';
export declare const MESSAGE_HEADER_PREFIX = "NX_MSG_";
/**
 * Ceiling on a single message, in bytes. Payloads are buffered outside the V8
 * heap, so `--max-old-space-size` does not bound them and a peer that declares
 * a huge length would otherwise be allowed to stream until the machine gives
 * out. The default is four times the ~0.5GiB string ceiling that used to cap
 * every message, so it clears any payload that previously worked or was meant
 * to. Set `NX_MAX_MESSAGE_SIZE` to another byte count to change it, or to 0 to
 * remove the ceiling. The daemon reads it from the env it was spawned with —
 * clients do not reflect it (see DAEMON_ENV_VARS_EXCLUSIONS) — so changing it
 * needs a daemon restart (`nx reset`).
 */
export declare const DEFAULT_MAX_MESSAGE_SIZE: number;
export declare function getMaxMessageSize(): number;
export declare function frameHeader(payloadLength: number): Buffer;
/**
 * Writes a length-prefixed message. The header and payload are written
 * separately so a large payload is never copied to prepend its header.
 */
export declare function writeMessage(socket: Socket, payload: Buffer, callback?: (err?: Error) => void): void;
export declare class MessageFramingError extends Error {
    constructor(message: string);
}
export declare function consumeMessagesFromSocket(callback: (message: Buffer) => void, onError?: (error: MessageFramingError) => void): (data: Buffer) => void;
/**
 * v8-serialized payloads always begin with the 0xFF version header, which no
 * JSON document can start with.
 */
export declare function isJsonMessage(message: Buffer): boolean;
/**
 * Render part of a message for an error message. A v8 payload is binary rather
 * than utf8 text — its 0xFF header alone can never decode — so it is rendered
 * as hex instead of as U+FFFD-riddled mojibake.
 */
export declare function describeMessage(message: Buffer, { maxBytes, from }?: DescribeMessageOptions): string;
export interface DescribeMessageOptions {
    maxBytes?: number;
    from?: 'start' | 'end';
}
/**
 * Parse a message produced by `serialize()` in `daemon/socket-utils.ts`.
 */
export declare function parseMessage<T = unknown>(message: Buffer): T;
