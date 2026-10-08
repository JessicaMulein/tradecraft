import { type Tree } from '@nx/devkit';
/**
 * Hybrid migration paired with `convert-to-flat-config.md`. The deterministic
 * half reuses the `@nx/eslint:convert-to-flat-config` generator to convert
 * JSON/YAML eslintrc configs to flat config (the version bump is owned by
 * `packageJsonUpdates`, so it runs with `keepExistingVersions`). It then returns
 * `agentContext` describing the work the generator could not do deterministically
 * (JavaScript-based configs, removed output formatters, the passing-state
 * baseline) so the paired prompt's agent can finish the job and keep the
 * workspace lint-passing.
 */
export default function update(tree: Tree): Promise<{
    agentContext: string[];
    nextSteps: string[];
} | void>;
