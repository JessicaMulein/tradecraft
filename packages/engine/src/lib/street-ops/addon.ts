/**
 * The street-ops add-on bundle.
 *
 * Disabled, nothing is registered and no street-ops code runs. Enabled, the
 * bundle is on the registry. Actions land in later tasks.
 */

import type { ScenarioConfig } from '../config/scenario-config.js';
import { createExtensionRegistry, type AddOn, type ExtensionRegistry } from '../extension/registry.js';
import { bindStreetRuntime, driveActions, runtimeFromScenario, type StreetOpsRuntime } from './drive.js';
import { SMUGGLE_OBJECTIVE } from './passenger.js';
import { STREET_REACTIONS_HOOK } from './hooks.js';

export const STREET_OPS_ID = 'street-ops';
export const STREET_OPS_VERSION = '0.1.0';

export function streetOpsAddOn(runtime: StreetOpsRuntime): AddOn {
  return {
    id: STREET_OPS_ID,
    version: STREET_OPS_VERSION,
    actions: driveActions(runtime),
    state: [],
    truth: [],
    objectives: [{ kind: SMUGGLE_OBJECTIVE }],
    hooks: [{ id: STREET_REACTIONS_HOOK }],
  };
}

/** Register the bundle only when the scenario turns the add-on on. */
export function registerStreetOps(
  registry: ExtensionRegistry,
  scenario: ScenarioConfig,
  runtime?: StreetOpsRuntime,
): void {
  if (scenario.streetOps?.enabled !== true) return;
  const bound = runtime ?? runtimeFromScenario(scenario);
  bindStreetRuntime(registry, bound);
  registry.register(streetOpsAddOn(bound));
}

/** The registry for a scenario, or undefined when street-ops is off or absent. */
export function streetOpsRegistry(
  scenario: ScenarioConfig,
  runtime?: StreetOpsRuntime,
): ExtensionRegistry | undefined {
  if (scenario.streetOps?.enabled !== true) return undefined;
  const registry = createExtensionRegistry();
  registerStreetOps(registry, scenario, runtime);
  return registry;
}
