import type { Source, Transform } from "./types.js";
export declare function tap<T>(fn: (chunk: T) => void | Promise<void>): Transform<T, T>;
export declare function finalize<T>(fn: () => void | Promise<void>): Transform<T, T>;
export declare function abortable<T>(source: Source<T>, signal: AbortSignal): Source<T>;
export declare function batch<T>(size: number, timeoutMs?: number): Transform<T, T[]>;
export declare function merge<T>(...sources: Source<T>[]): Source<T>;
export declare function concat<T>(...sources: Source<T>[]): Source<T>;
export interface FlatMapOptions {
    /** Max sub-sources to pull concurrently. Default: 1 (sequential). */
    concurrency?: number;
}
export declare function flatMap<I, O>(fn: (item: I) => Source<O>, options?: FlatMapOptions): Transform<I, O>;
export type BufferStrategy = "suspend" | "drop" | "slide" | "error";
export declare function buffer<T>(size: number, strategy?: BufferStrategy): Transform<T, T>;
//# sourceMappingURL=operators.d.ts.map