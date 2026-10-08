import type { EventDimensions } from '../native';
export declare const customDimensions: EventDimensions;
export type EventParameters = Partial<Record<EventDimensions[keyof EventDimensions], string | number | boolean>>;
/**
 * Fraction of sessions that report perf spans. Stamping this rate on a
 * measure's detail (as the sampleRate dimension) opts it into sampling; see
 * is_sampled_in in native/telemetry/service.rs. Multiply GA counts by 1/rate.
 */
export declare const PERF_SPAN_SAMPLE_RATE = 0.1;
export declare function startAnalytics(): Promise<void>;
export declare function reportNxAddCommand(packageName: string, version: string): void;
export declare function reportNxGenerateCommand(generator: string): void;
export declare function reportCommandRunEvent(command: string, parameters?: Record<string, any>, args?: Record<string, any>): void;
export declare function reportEvent(name: string, eventParameters?: EventParameters): void;
export declare function argsToQueryString(args: Record<string, any>): string;
export declare function flushAnalytics(): void;
