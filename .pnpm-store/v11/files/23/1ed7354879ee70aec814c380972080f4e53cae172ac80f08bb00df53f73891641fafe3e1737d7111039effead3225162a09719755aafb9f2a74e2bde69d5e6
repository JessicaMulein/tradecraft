import type { ChildProcess, Serializable } from 'child_process';
import type { TaskResult } from '../../config/misc-interfaces';
import { BatchResults } from '../batch/batch-messages';
export declare class BatchProcess {
    private childProcess;
    private executorName;
    private exitCallbacks;
    private batchResultsCallbacks;
    private taskResultsCallbacks;
    private outputCallbacks;
    /**
     * File holding all stdout/stderr held back from the live stream under log
     * grouping. It is rendered as a fold by a full-output run and by any batch
     * that reported a failed or stopped task (alongside per-task rendering), and
     * by any batch that crashed or was stopped before reporting (with redirect
     * lines — no per-task blocks exist there), so that a diagnostic no task
     * claimed — a crash, a config-phase error, a runner's summary — is not lost.
     * Only a batch whose every task succeeded on the default style discards it
     * unread. Crashiness is unknowable while capturing, so it is always written.
     *
     * It goes to disk rather than a string because a batch is long-lived (Gradle
     * runs one for the whole command) and its output has no bound. Accumulating
     * that in memory grows without limit and eventually exceeds the maximum
     * length of a JS string.
     */
    private capturedOutputPath;
    private capturedOutputFd;
    /**
     * Set once the capture is released. A chunk can still arrive after that —
     * stdout delivers past the exit event — and reopening then would mint a
     * second numbered file that nothing ever cleans up.
     */
    private capturedOutputDiscarded;
    /**
     * Set when writing the capture failed. Distinct from discarded: the bytes
     * already on disk are still the best record of the batch, so the file is kept
     * and rendered, while everything after the failure goes live to the terminal.
     */
    private capturedOutputFailed;
    private static capturedOutputCount;
    constructor(childProcess: ChildProcess, executorName: string);
    onExit(cb: (code: number) => void): void;
    onBatchResults(cb: (results: BatchResults) => void): void;
    onTaskResults(cb: (task: string, result: TaskResult) => void): void;
    onOutput(cb: (output: string) => void): void;
    private capture;
    /**
     * Path to the file holding everything held back from the live stream under
     * log grouping, or undefined if nothing was captured. Used to render the whole
     * batch as one fold, so output no task claimed is not lost.
     *
     * The file is deliberately left open rather than closed here. A worker's
     * stdout can deliver after its exit event — which is what `getResults()`
     * settles on — and leaving the fd open keeps such a chunk appending to this
     * same file instead of minting a second numbered one that nothing cleans up.
     * The caller reads the file once, synchronously, while rendering the fold, so
     * anything arriving after that read is not shown; writes are unbuffered, so
     * the read always sees a complete prefix of what has arrived by then.
     */
    getCapturedOutputPath(): string | undefined;
    /** Releases the capture file. Safe to call more than once. */
    discardCapturedOutput(): void;
    /**
     * Closes the fd and unlinks the file, leaving no path behind for a caller to
     * read. Tolerates a partially-initialized capture, since it also runs when
     * opening or writing the file is what failed.
     */
    private releaseCapturedOutput;
    /** Closes the fd, keeping the file and its path readable. */
    private closeCapturedOutput;
    getResults(): Promise<BatchResults>;
    send(message: Serializable): void;
    kill(signal?: NodeJS.Signals): Promise<void>;
}
