import { TargetDependencyConfig } from '../config/workspace-json-project-json';
type LegacyValue = 'self' | 'dependencies';
type LegacyEntry = TargetDependencyConfig & {
    projects: LegacyValue;
};
export interface LegacyDependsOnViolation {
    index: number;
    originalEntry: LegacyEntry;
}
export interface LegacyDependsOnLocation {
    ownerTarget?: string;
    index?: number;
    legacyViolations?: LegacyDependsOnViolation[];
}
export declare function warnLegacyDependsOnMagicString(currentProject: string | undefined, dependencyConfig: TargetDependencyConfig, location: LegacyDependsOnLocation | undefined): void;
export declare function flushLegacyDependsOnViolations(project: string, ownerTarget: string, violations: LegacyDependsOnViolation[], projectRoot: string | undefined): void;
export declare function __resetForTests(): void;
export {};
