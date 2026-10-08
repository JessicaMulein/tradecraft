/**
 * Mirrors pnpm's getConfigDir. Hosts pnpm's global config.yaml and (v11+)
 * auth.ini.
 * See https://github.com/pnpm/pnpm/blob/b7195db5c8469c80908d625c648302b26c2f9977/config/reader/src/dirs.ts#L73-L92
 */
export declare function getPnpmConfigDir(env: NodeJS.ProcessEnv): string;
/**
 * Reads a pnpm YAML config file (pnpm-workspace.yaml or the global
 * config.yaml). An absent file returns null so callers can fall through to
 * lower surfaces; everything else returns 'unusable', which every caller turns
 * into a throw. pnpm's own reader tolerates ENOENT alone and rethrows the rest,
 * and it dies the same way on a document it cannot parse or that is not a
 * mapping, so the two failures need no separate states. Requiring an object
 * also keeps the sentinel out of the success domain: a returned string can only
 * ever mean unusable.
 */
export declare function readPnpmYamlConfig(path: string): Record<string, unknown> | 'unusable' | null;
