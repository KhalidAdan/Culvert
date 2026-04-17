import type { Source } from "./types.js";
export declare function from<T>(input: AsyncIterable<T>): Source<T>;
export declare function from<T>(input: Iterable<T>): Source<T>;
export declare function empty<T = never>(): Source<T>;
export declare function of<T>(...values: T[]): Source<T>;
//# sourceMappingURL=sources.d.ts.map