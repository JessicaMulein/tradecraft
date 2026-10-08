import { type Tree, logger as devkitLogger } from 'nx/src/devkit-exports';
import type { BatchConversionSession } from './batch-conversion-session';
type Logger = typeof devkitLogger;
/**
 * Batch finalize: the deferred equivalent of Phase 3's hoist + cleanup and
 * Phase 4's verification, run once over every plan the batch session staged.
 * Planning happens on a clone of the final `nx.json`; a single combined
 * verification inference pass (all trusted plugin registrations, in final
 * order) supplies the ownership oracle and the per-pair equivalence inputs;
 * only then is the accepted outcome applied to the Tree as a precomputed byte
 * write-set.
 *
 * Finalization is optional deduplication: the Tree already holds each child's
 * conservative full-residual output. Any failure here (including an apply
 * failure, after restoring the write-set's snapshots) is caught, reported as
 * a single warning, and swallowed so the batch's callbacks still run.
 */
export declare function finalizeBatchConversion(tree: Tree, session: BatchConversionSession, logger?: Logger): Promise<void>;
export {};
