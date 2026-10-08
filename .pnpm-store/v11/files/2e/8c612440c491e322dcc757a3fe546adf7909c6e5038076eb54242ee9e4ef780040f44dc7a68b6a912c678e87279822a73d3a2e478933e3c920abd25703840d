import { type ExecOptions, type ExecSyncOptions, type SpawnSyncOptions } from 'child_process';
import { PackageManagerCommands } from './package-manager';
import { ChildProcess } from '../native';
export declare function getRunNxBaseCommand(packageManagerCommand?: PackageManagerCommands, cwd?: string): string;
/**
 * Locate an nx entry point to spawn for the workspace at `root`, so a caller
 * can run it directly instead of going through a shell. `findInstalledNxBin`
 * decides which one.
 *
 * Null means nothing may be spawned directly, leaving the caller to fall back
 * to `getRunNxBaseCommand`. Null is therefore always safe: it costs the
 * argument fidelity a direct spawn buys, never the ability to run.
 */
export declare function getNxBin(root?: string): string | null;
/**
 * The entry point the nx installed directly under `dir` names, with no ascent
 * to `dir`'s ancestors. For an installation that declares nx itself, such as
 * the temp CLI `nx migrate` builds, an ancestor's nx is never the right answer.
 */
export declare function readInstalledNxBin(dir: string): string | null;
/**
 * Run a nx command, passing the arguments through as an argv array.
 *
 * When `getNxBin` names an entry point, the child is spawned directly with no
 * shell in between, so every argument reaches the child exactly as provided:
 * shell metacharacters (`(`, `%`, `^`, spaces, quotes) are data, not syntax.
 * Otherwise falls back to the package-manager + shell path, where every
 * argument goes through `quoteShellArg` and the Windows limits it documents
 * apply.
 */
export declare function runNxArgvSync(argv: string[], options?: SpawnSyncOptions & {
    cwd?: string;
    nxBin?: string;
}): void;
export declare function runNxSync(cmd: string, options?: ExecSyncOptions & {
    cwd?: string;
    packageManagerCommand?: PackageManagerCommands;
}): void;
export declare function runNxAsync(cmd: string, options?: ExecOptions & {
    cwd?: string;
    silent?: boolean;
    packageManagerCommand?: PackageManagerCommands;
}): Promise<void>;
export declare class PseudoTtyProcess {
    private childProcess;
    isAlive: boolean;
    exitCallbacks: any[];
    constructor(childProcess: ChildProcess);
    onExit(callback: (code: number) => void): void;
    onOutput(callback: (message: string) => void): void;
    kill(): void;
}
