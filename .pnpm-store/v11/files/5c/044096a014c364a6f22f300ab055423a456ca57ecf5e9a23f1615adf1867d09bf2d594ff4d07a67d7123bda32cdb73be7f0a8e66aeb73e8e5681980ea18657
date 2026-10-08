import type { NxJsonConfiguration } from '../config/nx-json';
/**
 * The workspace's analytics identity: the Nx Cloud id when the workspace has
 * one (most stable — it survives repo moves and renames), else the repo key.
 * Null when neither is available, in which case nothing is reported.
 */
export declare function generateWorkspaceId(root: string, nxJson: NxJsonConfiguration | null): string | null;
/**
 * Derive the stable, unsalted key identifying this workspace in the
 * repoTelemetry registry: `sha256(<repo identity> + '#' + <workspace path
 * relative to the git root>)`.
 *
 * The repo identity is the normalized `domain/slug` from the git remote
 * (protocol-independent: ssh, https, and token-authenticated URLs of the
 * same repo produce the same key), falling back to the first-commit SHA
 * when no remote exists. Returns null when no identity is derivable — not
 * a git repository, or a shallow clone without a remote.
 */
export declare function deriveRepoKey(directory: string): string | null;
export declare function computeRepoKey(identity: string, relativePath: string): string;
