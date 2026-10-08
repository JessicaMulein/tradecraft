import { AgentDefinition, DetectedInstalledAgent } from './types';
/**
 * Probes each given agent definition for an installed binary on the user's
 * machine. PATH is checked first via `which` (which handles Windows PATHEXT),
 * then the per-agent well-known fallback paths. Probes run in parallel.
 *
 * Returns only the agents that were found, preserving the order of the input
 * `definitions` argument for callers that rely on it for picker presentation.
 */
export declare function detectInstalledAgents(definitions: readonly AgentDefinition[]): Promise<DetectedInstalledAgent[]>;
