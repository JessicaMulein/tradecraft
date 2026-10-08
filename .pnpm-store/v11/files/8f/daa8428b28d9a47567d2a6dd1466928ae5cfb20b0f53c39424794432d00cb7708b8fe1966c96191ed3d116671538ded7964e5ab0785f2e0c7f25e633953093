"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = default_1;
const tslib_1 = require("tslib");
const consolidate_release_tag_config_1 = tslib_1.__importDefault(require("../update-22-0-0/consolidate-release-tag-config"));
/**
 * The deprecated releaseTag* flat properties were removed in Nx 23. Re-run the
 * v22 consolidation for any workspaces that still have the legacy keys (e.g.,
 * configs added manually after the v22 migration ran). Runs automatically as
 * part of `nx migrate` and is also triggered by `nx repair` when the runtime
 * detects legacy keys still present in `nx.json`.
 */
// TODO(v24): remove this migration (along with its registration in
// migrations.json) and the LEGACY_RELEASE_TAG_PATTERN_PROPERTIES_DETECTED
// runtime error path in packages/nx/src/command-line/release/config/config.ts.
async function default_1(tree) {
    return (0, consolidate_release_tag_config_1.default)(tree);
}
