import { NxJsonConfiguration, PluginConfiguration } from '../../config/nx-json';
import type { LoadedNxPlugin } from './loaded-nx-plugin';
export interface SeparatedPlugins {
    specifiedPlugins: LoadedNxPlugin[];
    defaultPlugins: LoadedNxPlugin[];
}
/** Exported for tests: the fallback latch is process-scoped by design. */
export declare function resetIsolationFallbackForTesting(): void;
/**
 * Loads a plugin in a worker, falling back to this process when the worker's
 * socket was refused.
 *
 * Isolation is preferred: it is what keeps two plugins with conflicting
 * TypeScript versions or module-level state apart. But a sandbox that has not
 * been told about the Nx socket root refuses the worker's socket, and failing
 * the whole command over that is worse than running the plugins here. The
 * fallback is narrow on purpose. It needs a failure to start or reach the
 * worker, plus either a detectable sandbox or the worker's own EPERM/EACCES
 * exit code under an AI agent — the second arm is what covers an agent whose
 * sandbox sets no variable `isSandbox()` reads. A plugin that loaded and then
 * threw is rethrown, because rerunning it in-process would bury its actual
 * error.
 */
export declare const loadingMethod: (plugin: PluginConfiguration, root: string, index?: number) => Promise<readonly [Promise<LoadedNxPlugin>, () => void]>;
/**
 * Returns all plugins (specified + default) as a flat list.
 * Specified plugins come first, followed by default plugins.
 */
export declare function getPlugins(nxJson: NxJsonConfiguration, root?: string): Promise<LoadedNxPlugin[]>;
/**
 * Returns specified plugins (from nx.json) and default plugins (project.json,
 * package.json, etc.) as separate arrays. This separation is needed for
 * two-phase project configuration processing where target defaults are
 * applied between specified and default plugin results.
 *
 * `nxJson` is required so callers control the snapshot of nx.json the plugin
 * loader uses. This matters for the daemon's freshness-gated recompute, where
 * the snap hash and the plugin set must reflect the same disk state.
 */
export declare function getPluginsSeparated(nxJson: NxJsonConfiguration, root?: string): Promise<SeparatedPlugins>;
export declare function getOnlyDefaultPlugins(root?: string): Promise<LoadedNxPlugin[]>;
/**
 * The plugins from an in-flight load (whose workers may already be forked) or
 * the last committed one, without triggering a load. Undefined when neither
 * exists or plugins were cleaned up. After a plugins-config change the
 * committed set can be the previous, already-disposed one until the new load
 * commits, so callers must tolerate a disposed worker.
 */
export declare function getPluginsIfLoadedOrLoading(): Promise<LoadedNxPlugin[]> | undefined;
export declare function cleanupPlugins(): void;
export declare function reasonToError(reason: unknown): Error;
