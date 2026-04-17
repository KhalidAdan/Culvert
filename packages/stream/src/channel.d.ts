import type { Source } from "./types.js";
/**
 * The push side of a channel. Write values in; they emerge from the
 * paired Source<T> when the consumer pulls.
 */
export interface ChannelWriter<T> {
    /** Push a value. Resolves when the consumer has pulled it. */
    write(value: T): Promise<void>;
    /** Signal that no more values will be pushed. */
    close(): Promise<void>;
    /** Signal an error to the consumer. The consumer's next pull rejects. */
    error(err: unknown): void;
}
/**
 * Create a push-to-pull bridge.
 *
 * Returns a [writer, source] pair. The writer pushes values; the source
 * yields them. Backpressure is structural — each write blocks until the
 * consumer pulls.
 */
export declare function channel<T>(): [ChannelWriter<T>, Source<T>];
//# sourceMappingURL=channel.d.ts.map