/**
 * Collapses every character a reader could take for a line break, so a value
 * cannot break out of the line it is rendered on. The driving agent scans the
 * same stdout for `<nx_migrate_*>` blocks, which are framed by a bare newline,
 * so a value carrying its own break could open a forged one at a line start.
 *
 * The set is the line terminators and nothing else. U+0085, U+2028 and U+2029
 * are in it because "line start" is the reader's notion, not this process's: a
 * JavaScript `^` under `/m` treats the latter two as terminators, and Nx does
 * not know what parses its output. Quoting is not a substitute either, since
 * `JSON.stringify` leaves all three literal.
 *
 * Deliberately not every control character. Some of this text is already
 * colored when it arrives, and stripping ESC would leave the rest of the
 * escape sequence behind as visible noise without closing anything: only a
 * real terminator can put a value at the start of a line.
 */
export declare function singleLine(value: string): string;
