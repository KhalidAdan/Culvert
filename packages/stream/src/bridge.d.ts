import type { Source, Sink } from "./types.js";
export declare function toReadableStream<T>(source: Source<T>): ReadableStream<T>;
export declare function fromReadableStream<T>(stream: ReadableStream<T>): Source<T>;
export declare function writeTo<T>(writable: WritableStream<T>): Sink<T>;
//# sourceMappingURL=bridge.d.ts.map