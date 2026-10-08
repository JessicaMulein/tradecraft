import { ChildProcess, ExecFileSyncOptions, SpawnOptions } from 'child_process';
/**
 * Spawn a binary that may be a Windows `.cmd`/`.bat` shim, without letting its
 * arguments become shell syntax.
 *
 * Off Windows, and for a `.exe`, no shell is involved at all. Where one is —
 * a shim or a bare name — the binary and every argument are quoted for cmd.exe.
 *
 * Not a complete guarantee: cmd.exe expands `%VAR%` in the binary or any
 * argument whether or not it is quoted, so a caller with untrusted arguments
 * inherits that gap (NXC-4798). See the note on `LINE_BREAK` above.
 *
 * @throws on Windows when the binary or an argument contains a line break, or a
 * literal `"` (via `quoteShellArg`). Those are the only refusals — the `%`
 * expansion above is not one of them.
 */
export declare function safeSpawn(binary: string, args: readonly string[], options?: Omit<SpawnOptions, 'shell'>): ChildProcess;
/**
 * Synchronous {@link safeSpawn}, returning the child's stdout.
 *
 * Carries the same Windows caveats: `%VAR%` is expanded quoted or not
 * (NXC-4798), and a line break or literal `"` throws.
 */
export declare function safeExecFileSync(binary: string, args: readonly string[], options?: Omit<ExecFileSyncOptions, 'encoding' | 'shell'>): string;
