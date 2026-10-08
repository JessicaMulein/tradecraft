import { type NpmConfigEnv } from './utils';
import type { PackageManager } from '../package-manager';
export type { NpmConfigEnv } from './utils';
export { getPackageScope, mergeNpmConfigEnv, ignoresNpmConfigEnv, } from './utils';
/**
 * Computes the npm_config_* environment entries a spawned `npm view`/`npm pack`
 * (or a pre-v11 `pnpm view`, which passes through to npm) needs so its registry,
 * auth and TLS resolution reproduces what the workspace's package manager would
 * do for `packageName`. Returns an empty object when nothing needs bridging (npm
 * workspaces, or config npm already resolves identically on its own) and when
 * resolution fails, which is warned about rather than thrown.
 */
export declare function getNpmSpawnRegistryEnv(packageName: string, root: string, packageManager: PackageManager, packageManagerVersion: string | null): NpmConfigEnv;
