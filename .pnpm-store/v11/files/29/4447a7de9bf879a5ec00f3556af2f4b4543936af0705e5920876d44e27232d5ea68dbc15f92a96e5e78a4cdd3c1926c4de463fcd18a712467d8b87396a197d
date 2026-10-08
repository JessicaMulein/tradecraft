import { WriteStream } from 'tty';
import type { TaskStatus } from '../tasks-runner/tasks-runner';
/**
 * The statuses whose output can be collapsed to a single line: the task did the
 * work, or the cache stood in for it.
 */
export type CollapsibleTaskStatus = Extract<TaskStatus, 'success' | 'local-cache' | 'local-cache-kept-existing' | 'remote-cache'>;
/**
 * `static-failures-only` is `static` with successful tasks collapsed to a single
 * line. They select the same life cycle and differ only in what it prints, so
 * everywhere the life cycle is chosen, the TUI is ruled out, or output is
 * routed, the two behave identically.
 */
export declare function isStaticOutputStyle(outputStyle: string | undefined): boolean;
/**
 * Whether a run prints every task's output in full rather than collapsing the
 * ones that succeeded. Both static life cycles and the batch renderer have to
 * agree on this, so they read it from here rather than each deriving it.
 *
 * Exactly one style collapses, and it is also what a run that named no style
 * gets. Every other style prints in full because it was asked for explicitly,
 * so none may quietly withhold output. Note the static life cycles serve more
 * styles than the static-sounding ones: `shouldUseDynamicLifeCycle` bails on
 * `isCI()` before it looks at the style at all, so in CI `dynamic` and `tui`
 * land here too. This is written as a deny-list for that reason — a new style
 * prints in full until someone decides otherwise, rather than silently
 * collapsing because an allow-list did not list it.
 *
 * Resolving the absent case here rather than assigning `outputStyle` upstream is
 * deliberate: the value is also read by the orchestrator to decide whether a
 * task streams, and naming the default there stops `shouldStreamOutput` from
 * ever being consulted — including for the continuous tasks that must stream.
 */
export declare function printsFullTaskOutput(args: {
    verbose?: boolean;
    outputStyle?: string;
}): boolean;
/**
 * Whether task output should be wrapped in collapsible log groups. Grouping
 * requires each task's output to be written as one contiguous block, which is
 * why batch mode's implicit streaming backs off when this is on. It does not
 * govern streaming in general — an explicit `--output-style`, the TUI, and
 * long running tasks all still stream.
 */
export declare function isLogGroupingEnabled(): boolean;
/**
 * Whether a batch task's output should be held back from the live stream and
 * rendered inside a fold instead. A batch worker writes to stdout/stderr live,
 * so forwarding that copy would put its bytes outside the group and defeat the
 * fold; what is held back is written to a file and rendered by the orchestrator.
 *
 * Note it is the captured file, not each task's `terminalOutput`, that makes
 * this lossless. A worker is free to write bytes it attributes to no task —
 * `@nx/maven`'s exit-code dump, `@nx/gradle`'s configuration phase — and those
 * appear in no `terminalOutput` at all, so the fold has to be able to fall back
 * to the file. See `TaskOrchestrator.printGroupedBatchOutput` for when it does.
 *
 * This is only worth doing when grouping is on and the user has not asked to
 * stream — an explicit stream style (which sets NX_STREAM_OUTPUT) wants the
 * live copy, folds or not.
 */
export declare function shouldGroupBatchOutput(): boolean;
export interface CLIErrorMessageConfig {
    title: string;
    bodyLines?: string[];
    slug?: string;
}
export interface CLIWarnMessageConfig {
    title: string;
    bodyLines?: string[];
    slug?: string;
}
export interface CLINoteMessageConfig {
    title: string;
    bodyLines?: string[];
}
export interface CLISuccessMessageConfig {
    title: string;
    bodyLines?: string[];
}
/**
 * Custom orange color using ANSI 256-color code 214.
 * picocolors does not support keyword-based colors like chalk,
 * so orange is implemented manually.
 */
export declare function orange(text: string): string;
declare class CLIOutput {
    cliName: string;
    formatCommand: (taskId: string) => string;
    /**
     * Longer dash character which forms more of a continuous line when place side to side
     * with itself, unlike the standard dash character
     */
    private get VERTICAL_SEPARATOR();
    /**
     * Expose some color and other utility functions so that other parts of the codebase that need
     * more fine-grained control of message bodies are still using a centralized
     * implementation.
     */
    colors: {
        gray: import("picocolors/types").Formatter;
        green: import("picocolors/types").Formatter;
        red: import("picocolors/types").Formatter;
        cyan: import("picocolors/types").Formatter;
        white: import("picocolors/types").Formatter;
        orange: typeof orange;
    };
    bold: import("picocolors/types").Formatter;
    underline: import("picocolors/types").Formatter;
    dim: import("picocolors/types").Formatter;
    /**
     * Whether the terminal is positioned at the start of a line. Task output does
     * not reliably end in a newline, so writers that must begin on a fresh line
     * ask for one via {@link ensureLineStart} rather than guessing.
     *
     * Holding that true means a writer that can leave the cursor mid-line has to
     * be routed through this class or declared to it. The ones that exist today:
     *
     * - This class's own writes, via {@link writeToStream}.
     * - A batch worker's live output, via {@link writeTaskOutputChunk}.
     * - `nx:run-commands`, which is the only executor that runs in the main
     *   process (`task-orchestrator.ts` gates that on the executor name), and
     *   whose raw writes go through {@link writeTaskOutputChunk} for this reason.
     *   Its `addColorAndPrefix` splits on newlines without ever appending one, so
     *   its chunks routinely end mid-line.
     * - A pseudo-terminal task, which cannot be routed: the native side writes to
     *   this process's stdout from Rust, at arbitrary PTY read boundaries. It
     *   declares itself via {@link noteExternalWrite} instead, which is why that
     *   exists.
     *
     * Two bypasses are deliberate and safe, both because they re-emit output a
     * whole line at a time via `formatPrefixedLines`, which appends `EOL` to every
     * line it writes: forked task streaming through
     * `NodeChildProcessWithNonDirectOutput`'s `addPrefixTransformer`, and
     * `writePrefixedLines` for a main-process `nx:run-commands` under
     * `NX_PREFIX_OUTPUT`.
     *
     * One bypass is known and is NOT safe. With `NX_NATIVE_COMMAND_RUNNER=false`,
     * `forkProcessLegacy` forks with inherited stdio and yields
     * `NodeChildProcessWithDirectOutput`, whose child writes straight to this
     * process's fd 1 at arbitrary boundaries — unroutable and undeclarable from
     * here. Line tracking is simply wrong on that path; it degrades to the
     * pre-tracking behavior of a glued marker rather than to anything new. Do not
     * read this list as closed: it is what is known, and the way to tell you are
     * adding to it is that you are writing to stdout during a run without going
     * through {@link writeToStream}, {@link writeTaskOutputChunk} or
     * {@link noteExternalWrite}.
     */
    private atLineStart;
    private writeToStream;
    /**
     * Forwards a chunk of a task's output live, keeping {@link atLineStart}
     * accurate. Batch workers write raw chunks that routinely end mid-line, and a
     * collapsed summary line must not be glued onto one.
     *
     * @internal Not part of the output API plugins may rely on.
     */
    writeTaskOutputChunk(chunk: string | Buffer, stream?: WriteStream): void;
    /**
     * Declares output this class could not route — a pseudo-terminal task's, which
     * the native side writes straight to our stdout — so the next writer needing a
     * fresh line asks for one instead of trusting a stale position.
     *
     * The chunk is inspected rather than assumed mid-line, so output that did end
     * on a line boundary does not cost a blank line. PTY chunks often end in an
     * escape sequence after the newline, and that reads as mid-line, which is the
     * safe direction to be wrong in: a spare newline, never a glued one.
     */
    noteExternalWrite(chunk?: string | Buffer): void;
    private ensureLineStart;
    overwriteLine(lineText?: string): void;
    private writeOutputTitle;
    private writeOptionalOutputBody;
    applyNxPrefix(color: string, text: string): string;
    addNewline(stream?: WriteStream): void;
    addVerticalSeparator(color?: string): void;
    addVerticalSeparatorWithoutNewLines(color?: string): void;
    getVerticalSeparatorLines(color?: string): string[];
    private getVerticalSeparator;
    error({ title, slug, bodyLines }: CLIErrorMessageConfig): void;
    warn({ title, slug, bodyLines }: CLIWarnMessageConfig): void;
    note({ title, bodyLines }: CLINoteMessageConfig): void;
    success({ title, bodyLines }: CLISuccessMessageConfig): void;
    logSingleLine(message: string): void;
    logRawLine(message: string): void;
    logCommand(message: string, taskStatus?: TaskStatus): void;
    logCommandOutput(message: string, taskStatus: TaskStatus, output: string): void;
    /**
     * A single line standing in for a task's full output, used when the output
     * itself carries no information worth printing (a success, or a cache hit).
     * Statuses that carry a diagnosable body are deliberately not accepted here.
     */
    logCommandSummary(message: string, taskStatus: CollapsibleTaskStatus): void;
    /**
     * A one-line stand-in for a task whose full output is shown elsewhere — used
     * for the tasks of a batch rendered as a single log group rather than per
     * task. `note` points the reader at that group.
     */
    logCommandRedirect(message: string, taskStatus: Exclude<TaskStatus, 'skipped'>, note: string): void;
    /**
     * Prints a batch's combined output as one log group. A batch runner's
     * diagnostics — a crash, a config-phase error, a runner summary — belong to no
     * single task, so the group is labelled with the batch rather than a task.
     *
     * The batch's own output is copied straight from the file it was captured
     * into, so an arbitrarily long log costs a fixed amount of memory here.
     * Nothing is withheld: this rendering is chosen because the whole log was
     * asked for, because no task claimed any of it, or because a task failed or
     * was stopped — in which case repeating claimed bytes beside the per-task
     * blocks is deliberate (see TaskOrchestrator.printGroupedBatchOutput).
     */
    logBatchGroup(label: string, body: {
        capturedOutputPath?: string;
        trailer?: string;
    }, taskStatus: TaskStatus): void;
    /**
     * Copies a file to stdout a chunk at a time. Reading it into one string would
     * reintroduce the unbounded growth that writing it to disk avoided, and a
     * long batch log can exceed the maximum length of a JS string.
     */
    private copyFileToStream;
    private getCommandWithStatus;
    private getStatusIcon;
    private normalizeMessage;
    private addTaskStatus;
    log({ title, bodyLines, color }: CLIWarnMessageConfig & {
        color?: string;
    }): void;
    drain(): Promise<void>;
}
export declare const output: CLIOutput;
export {};
