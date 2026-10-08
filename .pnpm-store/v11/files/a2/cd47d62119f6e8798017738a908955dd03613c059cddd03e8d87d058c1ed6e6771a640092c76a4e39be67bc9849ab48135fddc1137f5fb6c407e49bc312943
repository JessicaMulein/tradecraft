import { ProjectGraph, ProjectGraphExternalNode, ProjectGraphProjectNode } from '../../../config/project-graph';
import { ProjectGraphBuilder } from '../../../project-graph/project-graph-builder';
import { PackageJson } from '../../../utils/package-json';
import { PackageManager } from '../../../utils/package-manager';
/**
 * Prune project graph's external nodes and their dependencies
 * based on the pruned package.json
 */
export declare function pruneProjectGraph(graph: ProjectGraph, prunedPackageJson: PackageJson, workspaceRootPath?: string, packageManager?: PackageManager): ProjectGraph;
/**
 * A `file:` (local tarball or directory) or `link:` specifier resolves to a
 * single local package. pnpm records its path relative to the workspace root in
 * the lockfile, while the manifest records it relative to the declaring package,
 * so the two never match by string.
 */
export declare function isLocalPathSpecifier(versionExpr: string): boolean;
/**
 * The external node for a `file:`/`link:` local-path dependency.
 *
 * The target path is what identifies one: an aliased dependency (`"alias":
 * "file:libs/x"`) is keyed in the lockfile by the target's real package name, so
 * the manifest's own name matches nothing. A manifest the pruned output already
 * rewrote carries a workspace-root-relative path, relocated under the shipped
 * output directory, which strips back to the path the lockfile records.
 *
 * A manifest that was not rewritten records the path relative to the declaring
 * package instead, and this has no way to resolve that against the workspace
 * root, so it falls back to the package name. Two local-path packages sharing a
 * name cannot be told apart by it, so that throws rather than risking a match to
 * the wrong one.
 */
export declare function findLocalPathNode(graph: ProjectGraph, packageName: string, versionExpr: string): ProjectGraphExternalNode | undefined;
export declare function findNodeMatchingVersion(graph: ProjectGraph, packageName: string, versionExpr: string): ProjectGraphExternalNode;
export declare function addNodesAndDependencies(graph: ProjectGraph, packageJsonDeps: Record<string, string>, workspacePackages: Map<string, ProjectGraphProjectNode>, builder: ProjectGraphBuilder): void;
export declare function rehoistNodes(graph: ProjectGraph, packageJsonDeps: Record<string, string>, builder: ProjectGraphBuilder): void;
