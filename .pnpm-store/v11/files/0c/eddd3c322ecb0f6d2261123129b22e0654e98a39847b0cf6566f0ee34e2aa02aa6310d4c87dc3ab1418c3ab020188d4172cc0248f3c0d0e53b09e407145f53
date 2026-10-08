import { type Tree } from '@nx/devkit';
/**
 * Adds the workspace-root pnpm install settings sources to the `inputs` of
 * build targets that emit the pruned pnpm deploy output. The build approvals
 * and `supportedArchitectures` those outputs carry reach no lockfile, so
 * without these a revoked approval leaves the task hash unchanged and a cached
 * run replays an output that still grants it. Inferred targets are covered by
 * the `@nx/webpack` and `@nx/rspack` plugins themselves; this migration covers
 * the explicitly configured executor targets, plus overlays of inferred
 * targets (a project-level entry, under the exact name or a glob-pattern key
 * matching it, or a matching `targetDefaults` entry) whose replacing `inputs`
 * array discards the plugin-generated one.
 */
export default function update(tree: Tree): Promise<void>;
