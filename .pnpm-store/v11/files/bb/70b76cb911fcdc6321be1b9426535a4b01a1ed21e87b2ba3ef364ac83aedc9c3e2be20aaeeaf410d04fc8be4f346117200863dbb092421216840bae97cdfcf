/**
 * Whether a generator may prompt at all. Requires a TTY, not CI, and the
 * caller having opted in via NX_INTERACTIVE.
 *
 * Generators that cannot ask still need an answer, so callers pair this with
 * the value to assume:
 *
 *     options.name = isInteractive() ? await textPrompt({ ... }) : undefined;
 */
export declare function isInteractive(): boolean;
