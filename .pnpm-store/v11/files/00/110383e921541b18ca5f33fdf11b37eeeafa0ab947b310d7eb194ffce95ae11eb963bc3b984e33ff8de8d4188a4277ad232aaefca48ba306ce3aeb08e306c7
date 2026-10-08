/** Slow-path entry point. Returns true if anything was emitted. */
export declare function tryCommandSurfaceCompletion(argv?: readonly string[]): boolean;
/** Top-level command names. Unions yargs handlers with the completion
 *  registry's single-token paths (infix targets). */
export declare function getTopLevelCommands(current: string, withDesc: boolean): string[] | null;
/**
 * Enumerates subcommands + options of a matched top-level command. Returns
 * null when no top-level command name is matched in `args`.
 */
export declare function getCommandCompletions(current: string, args: string[]): string[] | null;
/** value\tdescription separator. TAB because completion values can contain
 *  colons (`my-app:build`); descriptions get TABs collapsed. */
export declare const DESC_SEPARATOR = "\t";
/** Strip the y18n marker yargs prepends to its built-in --help / --version
 *  descriptions, and collapse stray TABs so they can't forge the
 *  value/description separator. */
export declare function formatDescription(raw: string | undefined): string;
/** zsh (compadd -d) and fish (complete -a) parse `value\tdescription`. */
export declare function shellRendersDescriptions(): boolean;
