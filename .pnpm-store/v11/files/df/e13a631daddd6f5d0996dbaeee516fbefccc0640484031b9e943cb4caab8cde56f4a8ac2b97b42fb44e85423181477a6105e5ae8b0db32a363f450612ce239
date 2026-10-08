"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectInstalledAgents = detectInstalledAgents;
const tslib_1 = require("tslib");
const promises_1 = require("fs/promises");
const which_1 = tslib_1.__importDefault(require("which"));
const logger_1 = require("../../../utils/logger");
async function isExecutable(path) {
    try {
        await (0, promises_1.access)(path, promises_1.constants.X_OK);
        return true;
    }
    catch (err) {
        // EACCES on an existing path means "this looks installed but we can't
        // execute it" — surface so the user can answer "why isn't my agent
        // detected?" without grep-debugging the filesystem.
        const code = err?.code;
        if (code && code !== 'ENOENT') {
            logger_1.logger.verbose(`Agent detection: cannot probe ${path} (${code}).`);
        }
        return false;
    }
}
async function findOnPath(binaryNames) {
    for (const name of binaryNames) {
        // `{ nothrow: true }` avoids the throw-per-missing-binary overhead;
        // EACCES on existing-but-unexecutable paths is handled by `isExecutable`.
        const found = await (0, which_1.default)(name, { nothrow: true });
        if (typeof found === 'string') {
            return found;
        }
    }
    return null;
}
async function detectOne(definition) {
    const onPath = await findOnPath(definition.binaryNames);
    if (onPath) {
        return {
            id: definition.id,
            displayName: definition.displayName,
            binary: onPath,
            source: 'path',
        };
    }
    for (const candidate of definition.wellKnownPaths()) {
        if (await isExecutable(candidate)) {
            return {
                id: definition.id,
                displayName: definition.displayName,
                binary: candidate,
                source: 'well-known',
            };
        }
    }
    return null;
}
/**
 * Probes each given agent definition for an installed binary on the user's
 * machine. PATH is checked first via `which` (which handles Windows PATHEXT),
 * then the per-agent well-known fallback paths. Probes run in parallel.
 *
 * Returns only the agents that were found, preserving the order of the input
 * `definitions` argument for callers that rely on it for picker presentation.
 */
async function detectInstalledAgents(definitions) {
    const results = await Promise.all(definitions.map(detectOne));
    return results.filter((result) => result !== null);
}
