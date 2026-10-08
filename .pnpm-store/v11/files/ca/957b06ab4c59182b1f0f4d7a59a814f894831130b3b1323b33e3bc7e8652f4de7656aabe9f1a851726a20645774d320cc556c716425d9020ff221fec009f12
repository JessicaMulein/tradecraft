import { type Tree } from '@nx/devkit';
/**
 * The linters Nx generators can set up for a project.
 *
 * Canonical home. `@nx/eslint` re-exports this for back-compat. Two standalone
 * copies exist because neither package can depend on `@nx/js`: `@nx/workspace`
 * (which `@nx/js` itself depends on) and `LINTERS` in `create-nx-workspace`.
 * The assertion below pins the first; `create-nx-workspace` has no edge to
 * assert across, so that one is still kept in sync by hand.
 */
export type LinterType = 'eslint' | 'oxlint' | 'none';
/**
 * Every linter the workspace has installed, most-preferred first — so `[0]` is
 * the one a generator should follow when it was not told which to set up, and
 * `.includes(x)` answers whether the workspace uses `x` at all. Those differ in
 * a workspace part-way through a migration: it has both, and a project
 * generated for Oxlint still lives under the root ESLint config.
 *
 * Oxlint sorts first when both are present. A workspace with both has adopted
 * Oxlint alongside its existing ESLint setup, and new projects should follow
 * the direction of travel rather than the setup being migrated away from.
 *
 * Empty means the workspace opted out of linting; callers that need a concrete
 * answer should read that as `none` rather than inferring ESLint for it.
 *
 * Reads the tree, never the generator's own module resolution: `eslint` is a
 * peer dependency of several first-party plugins, so it resolves from disk in
 * workspaces that do not use it.
 */
export declare function detectLinters(tree: Tree): Exclude<LinterType, 'none'>[];
