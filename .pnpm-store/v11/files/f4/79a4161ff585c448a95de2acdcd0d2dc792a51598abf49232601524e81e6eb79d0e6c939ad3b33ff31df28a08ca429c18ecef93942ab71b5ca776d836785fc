import { Tree } from '../../generators/tree';
/**
 * Target defaults resolve to a single key rather than merging, so an executor
 * key hides the target name key entirely. Before Nx 23 a hidden `cache: true`
 * still took effect, because cacheability was also derived from target *names*
 * via `cacheableOperations`; Nx 23 removed that derivation and those targets
 * silently stopped being cacheable.
 *
 * Write the intent into the executor key so it no longer depends on the
 * deprecated fallback that restores the old behavior at run time.
 */
export default function update(tree: Tree): Promise<void>;
