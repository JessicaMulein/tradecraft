"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isInteractive = isInteractive;
const devkit_internals_1 = require("nx/src/devkit-internals");
/**
 * Whether a generator may prompt at all. Requires a TTY, not CI, and the
 * caller having opted in via NX_INTERACTIVE.
 *
 * Generators that cannot ask still need an answer, so callers pair this with
 * the value to assume:
 *
 *     options.name = isInteractive() ? await textPrompt({ ... }) : undefined;
 */
function isInteractive() {
    return (!(0, devkit_internals_1.isCI)() && !!process.stdout.isTTY && process.env.NX_INTERACTIVE === 'true');
}
