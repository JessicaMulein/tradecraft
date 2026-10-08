/**
 * The directory holding bun's global config files (.bunfig.toml and, for bun's
 * npmrc support, .npmrc): $XDG_CONFIG_HOME when set, else the home dir (bun's
 * getHomeConfigPath). Null when neither is set, where bun reads no global
 * config.
 */
export declare function getBunGlobalConfigBase(env: NodeJS.ProcessEnv): string | null;
/**
 * Parses a bunfig.toml: null when absent, 'unreadable' when it cannot be read
 * (bun skips it and resolves on, so most callers collapse the two), 'invalid'
 * when bun's own TOML parser would reject it (bun hard-errors there, so no
 * resolution is left for a caller to reproduce).
 */
export declare function readBunfigRaw(path: string): Record<string, unknown> | 'unreadable' | 'invalid' | null;
