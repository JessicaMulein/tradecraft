import type { JsonParseOptions, JsonSerializeOptions } from './json';
import { PathLike } from 'node:fs';
export interface JsonReadOptions extends JsonParseOptions {
    /**
     * mutable field recording whether JSON ends with new line
     * @default false
     */
    endsWithNewline?: boolean;
}
export interface JsonWriteOptions extends JsonSerializeOptions {
    /**
     * whether to append new line at the end of JSON file
     * @default false
     */
    appendNewLine?: boolean;
}
/**
 * Reads a JSON file and returns the object the JSON content represents.
 *
 * @param path A path to a file.
 * @param options JSON parse options
 * @returns Object the JSON content of the file represents
 */
export declare function readJsonFile<T extends object = any>(path: string, options?: JsonReadOptions): T;
interface YamlReadOptions {
    /**
     * Compatibility with JSON.parse behaviour. If true, then duplicate keys in a mapping will override values rather than throwing an error.
     */
    json?: boolean;
    /**
     * Resolves only the tags every YAML parser must support, so every scalar stays
     * a string instead of `true` or `12`.
     */
    failsafe?: boolean;
}
/**
 * Reads a YAML file and returns the object the YAML content represents.
 *
 * @param path A path to a file.
 * @returns
 */
export declare function readYamlFile<T extends object = any>(path: string, options?: YamlReadOptions): T;
/**
 * Serializes the given data to JSON and writes it to a file.
 *
 * @param path A path to a file.
 * @param data data which should be serialized to JSON and written to the file
 * @param options JSON serialize options
 */
export declare function writeJsonFile<T extends object = object>(path: string, data: T, options?: JsonWriteOptions): void;
/**
 * Serializes the given data to JSON and writes it to a file asynchronously.
 *
 * @param path A path to a file.
 * @param data data which should be serialized to JSON and written to the file
 * @param options JSON serialize options
 */
export declare function writeJsonFileAsync<T extends object = object>(path: string, data: T, options?: JsonWriteOptions): Promise<void>;
/**
 * Check if a directory exists
 * @param path Path to directory
 */
export declare function directoryExists(path: PathLike): boolean;
/**
 * Check if a file exists.
 * @param path Path to file
 */
export declare function fileExists(path: PathLike): boolean;
export declare function createDirectory(path: PathLike): void;
export declare function isRelativePath(path: string): boolean;
export declare function readFileIfExisting(path: string): string;
export {};
