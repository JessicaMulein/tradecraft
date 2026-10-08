/** A single entry from yargs' `getCommandHandlers()`. */
export interface CommandHandler {
    description?: string | false;
    builder?: (yargs: any) => any;
}
export type CommandHandlers = Record<string, CommandHandler>;
/**
 * Reach into the yargs commandsObject to enumerate registered command
 * handlers. Lazy-required: nx-commands pulls in the full command tree
 * and is only needed on the slow path.
 *
 * Yargs only keys handlers by canonical name. We mirror each alias to its
 * canonical handler reference so lookups like `handlers['g']` resolve to
 * the same entry as `handlers['generate']`.
 */
export declare function getNxCommandHandlers(): CommandHandlers;
/** Subcommand name → description, visible-option name → description, and
 *  canonical option name → its yargs-declared aliases (e.g. projects → [p]). */
export interface BuilderIntrospection {
    subcommands: Map<string, string | undefined>;
    options: Map<string, string | undefined>;
    aliases: Map<string, string[]>;
}
/**
 * Run a yargs builder against a throwaway instance and return its declared
 * subcommands, visible options, and option-alias groups. Returns null if
 * the builder throws. Does NOT call `.argv` — would trigger parse and the
 * help-printing path we're avoiding.
 */
export declare function introspectBuilder(builder: (yargs: any) => any): BuilderIntrospection | null;
