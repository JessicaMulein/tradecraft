"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appendMinimumReleaseAgeExcludes = appendMinimumReleaseAgeExcludes;
const fs_1 = require("fs");
const path_1 = require("path");
const yaml_1 = require("yaml");
const EXCLUDE_KEY = 'minimumReleaseAgeExclude';
/**
 * Appends `<name>@<version>` entries to `minimumReleaseAgeExclude` in
 * pnpm-workspace.yaml, mirroring what pnpm's loose-mode policy handler writes at
 * install time (deduped, existing order preserved, new entries appended). The
 * edit is comment-preserving (yaml document API); the file is created when
 * absent. Returns the entries that were newly added (empty when all were
 * already present or `entries` is empty).
 *
 * Each entry must already be in `<name>@<version>` form. The caller is
 * responsible for building it from the resolved package name and version.
 */
function appendMinimumReleaseAgeExcludes(root, entries) {
    const deduped = [...new Set(entries)].filter(Boolean);
    if (deduped.length === 0) {
        return [];
    }
    const path = (0, path_1.join)(root, 'pnpm-workspace.yaml');
    const raw = (0, fs_1.existsSync)(path) ? (0, fs_1.readFileSync)(path, 'utf-8') : '';
    const parsed = (0, yaml_1.parseDocument)(raw);
    // A present root that isn't a mapping (a bare scalar or sequence) is malformed
    // for pnpm; bail rather than overwrite the file with just the exclude key and
    // drop the user's content. Empty/comments-only files have null contents and
    // fall through to a fresh mapping document below.
    if (parsed.contents != null && !(parsed.contents instanceof yaml_1.YAMLMap)) {
        return [];
    }
    const doc = parsed.contents instanceof yaml_1.YAMLMap ? parsed : new yaml_1.Document(new yaml_1.YAMLMap());
    const seq = doc.get(EXCLUDE_KEY);
    const existingSeq = seq instanceof yaml_1.YAMLSeq ? seq : undefined;
    const existing = new Set(seqStringValues(existingSeq));
    const added = deduped.filter((entry) => !existing.has(entry));
    if (added.length === 0) {
        return [];
    }
    if (existingSeq) {
        for (const entry of added) {
            existingSeq.add(entry);
        }
    }
    else {
        doc.set(EXCLUDE_KEY, added);
    }
    (0, fs_1.writeFileSync)(path, doc.toString());
    return added;
}
function seqStringValues(seq) {
    if (!seq) {
        return [];
    }
    return seq.items.map((item) => item instanceof yaml_1.Scalar ? String(item.value) : String(item));
}
