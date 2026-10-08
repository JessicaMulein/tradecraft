"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBunGlobalConfigBase = getBunGlobalConfigBase;
exports.readBunfigRaw = readBunfigRaw;
const fs_1 = require("fs");
/**
 * The directory holding bun's global config files (.bunfig.toml and, for bun's
 * npmrc support, .npmrc): $XDG_CONFIG_HOME when set, else the home dir (bun's
 * getHomeConfigPath). Null when neither is set, where bun reads no global
 * config.
 */
function getBunGlobalConfigBase(env) {
    // bun's getenvZ treats a set-but-empty var as present, so an exported empty
    // XDG_CONFIG_HOME still short-circuits HOME (bun: `XDG_CONFIG_HOME orelse HOME`).
    if (env.XDG_CONFIG_HOME !== undefined) {
        return env.XDG_CONFIG_HOME;
    }
    // Mirrors bun's platform-specific HOME accessor (env_var.zig).
    const home = process.platform === 'win32' ? env.USERPROFILE : env.HOME;
    return home ?? null;
}
/**
 * Parses a bunfig.toml: null when absent, 'unreadable' when it cannot be read
 * (bun skips it and resolves on, so most callers collapse the two), 'invalid'
 * when bun's own TOML parser would reject it (bun hard-errors there, so no
 * resolution is left for a caller to reproduce).
 */
function readBunfigRaw(path) {
    // Outside the try because a parser that will not load is a broken
    // installation, not a corrupt bunfig.
    const { parse } = require('smol-toml');
    let raw;
    try {
        raw = (0, fs_1.readFileSync)(path, 'utf-8');
    }
    catch (error) {
        // ENOTDIR (a path through a non-directory) is another shape of absent, the
        // same way the .npmrc reader classifies it.
        return error?.code === 'ENOENT' || error?.code === 'ENOTDIR'
            ? null
            : 'unreadable';
    }
    try {
        return parse(raw);
    }
    catch {
        return 'invalid';
    }
}
