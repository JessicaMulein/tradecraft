export interface SandboxSocketHintOptions {
    /**
     * Pass `true` only when an errno proves the operating system refused the
     * socket (`EPERM`/`EACCES` on a bind or connect). Most callers reach this
     * hint holding a failure that denied permission only explains — a worker
     * that died before it reported anything, an internal daemon error — and for
     * those the lead line offers the cause rather than asserting it.
     */
    certain?: boolean;
}
/**
 * Guidance for a unix socket Nx was not allowed to use. The lead line names
 * denied permission, which is the part Nx can observe; a sandbox is the most
 * common source but not the only one, so which remedy applies is left to the
 * list rather than decided in the first sentence.
 *
 * Every sandbox-shaped line — the `configure-ai-agents` remediation, the
 * per-agent setting, the knowledge base link — is dropped unless a sandbox is
 * actually running. A root-owned socket dir on a plain workstation reaches this
 * hint too, and there the permission line is the whole truth, so it is stated
 * outright rather than offered as the one item of a list.
 *
 * Lives in its own module (rather than the daemon client) so that plugin
 * workers and the plugin host can use it without pulling in the daemon
 * client's module-level `DaemonClient` singleton.
 */
export declare function sandboxSocketHint({ certain, }?: SandboxSocketHintOptions): string[];
