import { SpawnOptions } from 'child_process';
import { AgentDefinition, DetectedInstalledAgent, HandoffOutcome, InvocationContext } from './types';
export interface RunAgenticArgs {
    detected: DetectedInstalledAgent;
    definition: AgentDefinition;
    invocationContext: InvocationContext;
    handoffFilePath: string;
    /** Override the handoff-file poll interval (test seam). */
    handoffPollIntervalMs?: number;
    /** Override the SIGINT-to-SIGTERM grace period (test seam). */
    gracefulExitMs?: number;
    /** Override the post-force-kill safety bound (test seam). */
    forceKillWaitMs?: number;
}
/**
 * Spawns the selected agent with `stdio: 'inherit'`, swallows SIGINT while the
 * child is alive, waits for it to exit, and resolves the run's outcome from
 * the handoff file (or the user when the file is missing).
 */
export declare function runAgentic(args: RunAgenticArgs): Promise<HandoffOutcome>;
/**
 * Node's `spawn` cannot directly execute `.cmd` / `.bat` shims on Windows;
 * `which` resolves to those when an agent was installed via npm. Wrap them in
 * a `cmd.exe /d /s /c` invocation with `windowsVerbatimArguments` so quoting
 * follows the cmd.exe convention rather than Node's default cooking.
 *
 * On non-Windows or for non-shim binaries this is a passthrough.
 */
export declare function adaptSpawnForWindowsShim(binary: string, args: readonly string[], options: SpawnOptions): {
    binary: string;
    args: string[];
    options: SpawnOptions;
};
