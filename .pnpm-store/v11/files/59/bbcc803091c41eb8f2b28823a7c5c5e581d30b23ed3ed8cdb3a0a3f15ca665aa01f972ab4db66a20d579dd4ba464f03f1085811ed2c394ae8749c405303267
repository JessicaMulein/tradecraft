import { type PickOutcome } from './pick';
import type { MinReleaseAgePolicy } from './policy';
/**
 * Resolves an already catalog-dereferenced spec to a cooldown-compliant version
 * under the given policy: fetches the packument, then picks. Throws
 * MinReleaseAgeViolationError when the PM at this version would refuse to resolve.
 */
export declare function resolveCompliantVersion(packageName: string, spec: string, policy: MinReleaseAgePolicy): Promise<PickOutcome>;
