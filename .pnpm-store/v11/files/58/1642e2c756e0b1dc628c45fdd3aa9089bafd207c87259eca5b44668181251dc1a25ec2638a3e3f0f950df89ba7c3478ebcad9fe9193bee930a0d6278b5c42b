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
export declare function appendMinimumReleaseAgeExcludes(root: string, entries: string[]): string[];
