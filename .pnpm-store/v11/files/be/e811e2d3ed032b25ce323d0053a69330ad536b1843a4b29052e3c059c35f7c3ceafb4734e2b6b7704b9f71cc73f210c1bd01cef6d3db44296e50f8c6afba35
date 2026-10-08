"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sortMigrations = sortMigrations;
const semver_1 = require("semver");
const types_1 = require("./agentic/types");
const version_utils_1 = require("./version-utils");
/**
 * Sorts in place (like `Array.prototype.sort`) and returns the same array.
 *
 * `hoistHandoffGitignore` is set for agentic runs, which write scratch under
 * `.nx/migrate-runs`; see `agentic/handoff-gitignore.ts` for why the v23
 * gitignore migration must run first there.
 */
function sortMigrations(migrations, opts) {
    return migrations.sort((a, b) => {
        if (opts.hoistHandoffGitignore) {
            if ((0, types_1.isHandoffGitignoreMigration)(a))
                return -1;
            if ((0, types_1.isHandoffGitignoreMigration)(b))
                return 1;
        }
        if (a.name === '15-7-0-split-configuration-into-project-json-files') {
            return -1;
        }
        if (b.name === '15-7-0-split-configuration-into-project-json-files') {
            return 1;
        }
        return (0, semver_1.lt)((0, version_utils_1.normalizeVersion)(a.version), (0, version_utils_1.normalizeVersion)(b.version))
            ? -1
            : 1;
    });
}
