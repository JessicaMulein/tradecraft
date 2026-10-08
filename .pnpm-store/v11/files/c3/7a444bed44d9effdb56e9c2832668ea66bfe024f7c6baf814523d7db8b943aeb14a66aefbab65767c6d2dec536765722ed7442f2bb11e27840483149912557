/**
 * Records a file for `formatInitWrites`. Only for files a formatter handles -
 * `.gitignore` and the vendored `.nx` scripts are left out rather than
 * filtered later.
 *
 * Two recording helpers are shared with `nx import`, which drains before each
 * commit amend; draining after one would leave the formatting uncommitted.
 * The drain is a no-op when empty.
 */
export declare function recordInitWrite(filePath: string): void;
/**
 * Formats what init just wrote and nothing else: an existing repo's other
 * files are not init's to reformat.
 *
 * Never fatal - the repo is already initialised, so a formatter that cannot
 * run costs a `nx format` the user can run themselves, not their setup.
 */
export declare function formatInitWrites(repoRoot: string, command?: string): Promise<void>;
