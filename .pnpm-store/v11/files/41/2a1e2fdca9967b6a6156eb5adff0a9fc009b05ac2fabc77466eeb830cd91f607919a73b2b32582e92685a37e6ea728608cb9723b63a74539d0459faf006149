export interface DroppedAgentContextInput {
    migration: {
        package: string;
        name: string;
        prompt?: string;
    };
    agentContext: string[];
}
export declare function formatDroppedAgentContextForOuterAgent(input: DroppedAgentContextInput): string;
export declare function escapeXmlAttr(value: string): string;
/**
 * Both the classic loop and the single-migration worker call this only under
 * `agentic.kind === 'inside-agent'`. Under `enabled` the inner agent step
 * consumes `agentContext` through the prompt builders; under `disabled` the
 * run is human-driven and agent-targeted context is only noise.
 */
export declare function printDroppedAgentContextForOuterAgent(input: DroppedAgentContextInput): void;
