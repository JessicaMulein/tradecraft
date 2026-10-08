interface MigrationShape {
    prompt?: string;
    implementation?: string;
    factory?: string;
}
/** A migration entry as written into the plan (migrations.json). */
export interface PlannedMigration extends MigrationShape {
    package: string;
    name: string;
    version: string;
    description?: string;
    documentation?: string;
}
export declare function isPromptOnlyMigration(m: MigrationShape): boolean;
export declare function isHybridMigration(m: MigrationShape): boolean;
export {};
