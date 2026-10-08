import { type Tree } from '@nx/devkit';
/**
 * Reconciles converted flat configs with angular-eslint v22's breaking changes so
 * they load again. The converter carries the removed `plugin:@angular-eslint/*`
 * configs as FlatCompat shims in two shapes: a bare `...compat.extends(...)` for
 * top-level extends, and a `...compat.config({ extends }).map(...)` for per-override
 * extends. This handles both: shared configs become their flat-native
 * `angular.configs.*` counterparts, and `process-inline-templates` becomes a
 * `processor` block. The per-override shape drops that block when `flat/angular`
 * already applies the processor; the top-level shape keeps it. It also drops the
 * removed `no-conflicting-lifecycle` rule, injects the `angular-eslint` import
 * (and dependency) when it introduces `angular.*` references, and removes the
 * FlatCompat scaffolding left unused afterwards.
 *
 * Gated on angular-eslint v22+: the shims resolve on v18-v21, so rewriting them
 * there would be churn, and only the v22 flat exports are known here. Does not
 * format; the caller owns formatting.
 */
export declare function migrateAngularEslintV22FlatConfig(tree: Tree): Promise<void>;
export declare function resolveAngularEslintVersion(tree: Tree): string;
