/**
 * Lines are kept unjoined all the way here on purpose. Joining them and
 * splitting them back turns an injected break into its own entry before this
 * module sees it, indistinguishable from a line the caller meant to write, and
 * nothing downstream can undo that.
 */
export interface AgentMessage {
    title: string;
    bodyLines?: string[];
}
/**
 * The safe form of a set of lines. Exported so a caller that needs the same
 * text twice, once for a human and once inside a block payload, derives both
 * from one array instead of sanitizing one copy and not the other.
 */
export declare function safeLines(lines: readonly string[]): string[];
export declare function logToAgent(message: AgentMessage): void;
export declare function warnToAgent(message: AgentMessage): void;
export declare function emitStepBlock(runId: string, stepId: string, action: string, payload: object): void;
export declare function emitPromptBlock(migrationId: string, payload: object): void;
