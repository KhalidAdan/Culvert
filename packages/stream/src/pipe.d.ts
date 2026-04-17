import type { Source, Transform, Sink } from "./types.js";
export declare function pipe<A, R>(s: Source<A>, sink: Sink<A, R>): Promise<R>;
export declare function pipe<A, B, R>(s: Source<A>, t1: Transform<A, B>, sink: Sink<B, R>): Promise<R>;
export declare function pipe<A, B, C, R>(s: Source<A>, t1: Transform<A, B>, t2: Transform<B, C>, sink: Sink<C, R>): Promise<R>;
export declare function pipe<A, B, C, D, R>(s: Source<A>, t1: Transform<A, B>, t2: Transform<B, C>, t3: Transform<C, D>, sink: Sink<D, R>): Promise<R>;
export declare function pipe<A, B, C, D, E, R>(s: Source<A>, t1: Transform<A, B>, t2: Transform<B, C>, t3: Transform<C, D>, t4: Transform<D, E>, sink: Sink<E, R>): Promise<R>;
export declare function pipe<A, B, C, D, E, F, R>(s: Source<A>, t1: Transform<A, B>, t2: Transform<B, C>, t3: Transform<C, D>, t4: Transform<D, E>, t5: Transform<E, F>, sink: Sink<F, R>): Promise<R>;
export declare function pipe<A, B, C, D, E, F, G, R>(s: Source<A>, t1: Transform<A, B>, t2: Transform<B, C>, t3: Transform<C, D>, t4: Transform<D, E>, t5: Transform<E, F>, t6: Transform<F, G>, sink: Sink<G, R>): Promise<R>;
export declare function pipe(source: Source<unknown>, ...stages: [...Transform<any, any>[], Sink<any, any>]): Promise<unknown>;
//# sourceMappingURL=pipe.d.ts.map