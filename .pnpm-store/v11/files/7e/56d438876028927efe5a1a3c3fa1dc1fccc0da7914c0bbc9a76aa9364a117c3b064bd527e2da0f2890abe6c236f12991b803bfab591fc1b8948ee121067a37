/**
 * Canonical list of agent ids for the migrate agentic flow. Used by the yargs
 * layer for `--agentic` validation and by the runtime as the source of truth
 * for the {@link AgentId} union.
 */
export declare const AGENT_IDS: readonly ['claude-code', 'codex', 'opencode'];
export type AgentId = (typeof AGENT_IDS)[number];
/**
 * Shape-only normalization of `--agentic`; validation of agent-id strings is
 * done upstream in the yargs `.check()` chain.
 */
export declare function coerceAgenticArg(value: unknown): string | boolean | undefined;
