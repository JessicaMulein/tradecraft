/**
 * Translates NodeJS signals to numeric exit code
 * @param signal
 */
export declare function signalToCode(signal: NodeJS.Signals | null): number;
/**
 * Translates numeric exit codes to NodeJS signals
 */
export declare function codeToSignal(code: number): NodeJS.Signals;
export declare const EXPECTED_TERMINATION_SIGNALS: Set<number>;
/**
 * Translates a pty exit message (e.g. "Terminated by Interrupt") to a numeric exit code.
 * Handles both Linux exact-match and macOS strsignal formats (e.g. "Terminated by Hangup: 1").
 */
export declare function messageToCode(message: string): number;
/**
 * Ends the process the way an interrupted process ends: by SIGINT, not by
 * exiting with its conventional code.
 *
 * A shell reports 130 either way, but a parent using waitpid sees
 * `signal: 'SIGINT'` rather than `code: 130`, which is what tools wrapping nx
 * check to tell "the user pressed Ctrl+C" from "the command failed".
 */
export declare function exitAsInterrupted(): never;
