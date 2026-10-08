import { AgentId, ResolvedAgentic } from './types';
/** Possible values for `--agentic` after yargs normalization. */
export type AgenticArg = undefined | boolean | AgentId;
export interface ResolveAgenticInput {
    agentic: AgenticArg;
    migrations: ReadonlyArray<{
        prompt?: string;
    }>;
    /** The `--interactive` flag; `false` (`--no-interactive`) disables all prompting. */
    interactive?: boolean;
}
/**
 * Callers resolve this once per run-phase invocation and reuse the result for
 * every migration it covers.
 */
export declare function resolveAgentic(input: ResolveAgenticInput): Promise<ResolvedAgentic>;
/**
 * No warning when `--validate` is passed with the agentic flow off: validation
 * requires an active agent session by definition.
 */
export declare function resolveShouldRunValidation(args: {
    validate: boolean | undefined;
    agenticKind: ResolvedAgentic['kind'];
}): boolean;
