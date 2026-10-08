export type DaemonMessage = {
    type: string;
    env?: Record<string, string>;
    /**
     * Stamped centrally by `DaemonSocketMessenger.sendMessage`, not by the ~30
     * sites that construct messages — hence optional. It can also be absent on a
     * message that predates the field, which is why `isForeignWorkspaceMessage`
     * treats `undefined` as "not foreign".
     */
    workspaceRoot?: string;
    data?: any;
};
export declare function isDaemonMessage(msg: unknown): msg is DaemonMessage;
/**
 * Any message carrying the sender's workspace root. Structural so the checks
 * below serve the daemon and the plugin worker without either importing the
 * other's message type. `type` is required only so the type is not all-optional,
 * which would accept `{}`.
 */
type WorkspaceScopedMessage = {
    type: string;
    workspaceRoot?: string;
};
/**
 * A message from a different workspace — two sharing an NX_SOCKET_DIR — must not
 * be processed. Roots are normalized first so that a workspace does not look
 * foreign to itself; see {@link normalizeWorkspaceRoot}.
 */
export declare function isForeignWorkspaceMessage(msg: WorkspaceScopedMessage, receiverWorkspaceRoot: string): boolean;
/**
 * Throws on a message this receiver must not act on. The daemon catches it and
 * responds with the mismatch; the plugin worker catches it and drops the
 * message. `receiverDescription` names whichever raised it.
 *
 * An unstamped message is deliberately accepted: this is accident detection,
 * not a control.
 */
export declare function assertNotForeignWorkspaceMessage(msg: WorkspaceScopedMessage, receiverWorkspaceRoot: string, receiverDescription?: string): void;
export {};
