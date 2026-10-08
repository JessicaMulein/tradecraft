/**
 * Check if a string contains shell metacharacters that require quoting.
 * These characters have special meaning in shell and would be interpreted
 * incorrectly if not quoted (e.g., | for pipe, & for background, etc.)
 */
export declare function needsShellQuoting(str: string): boolean;
/**
 * Check if a string is already wrapped in matching quotes (single or double).
 */
export declare function isAlreadyQuoted(str: string): boolean;
/**
 * Quote a string so it survives being interpolated into a shell command line
 * as a single argument.
 *
 * On Windows the safety boundary is one unbroken double-quoted run: it keeps
 * `^`, `&`, `|`, `<` and `>` literal through cmd.exe's parse and a `.cmd`
 * shim's re-parse of `%*`, but not `%`, which cmd.exe expands inside double
 * quotes too.
 *
 * @throws on Windows when the argument contains a double quote, which ends that
 * run, since cmd.exe recognizes no backslash escape. Carrying one means
 * caret-escaping every metacharacter instead, doubled for a `.cmd` shim, which
 * this path does not implement.
 */
export declare function quoteShellArg(arg: string): string;
