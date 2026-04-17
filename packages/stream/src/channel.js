/**
 * Create a push-to-pull bridge.
 *
 * Returns a [writer, source] pair. The writer pushes values; the source
 * yields them. Backpressure is structural — each write blocks until the
 * consumer pulls.
 */
export function channel() {
    // The state machine mediates between two participants:
    //
    // - The producer, calling write()/close()/error()
    // - The consumer, calling next() via for-await-of
    //
    // At any moment, either:
    //   1. The producer is waiting (wrote a value, consumer hasn't pulled)
    //   2. The consumer is waiting (pulled, producer hasn't written)
    //   3. Neither is waiting (idle)
    //
    // Both waiting simultaneously is impossible — that's the invariant.
    let done = false;
    let errorValue = undefined;
    let hasError = false;
    // Producer wrote before consumer pulled — producer is parked here.
    let pendingWrite = null;
    // Consumer pulled before producer wrote — consumer is parked here.
    let pendingRead = null;
    const writer = {
        write(value) {
            if (done) {
                return Promise.reject(new Error("Cannot write to closed channel"));
            }
            // Is a consumer already waiting?
            if (pendingRead) {
                // Hand the value directly — zero buffering, zero delay.
                const reader = pendingRead;
                pendingRead = null;
                reader.resolve({ done: false, value });
                return Promise.resolve();
            }
            // No consumer waiting — park until one arrives.
            return new Promise((resolve) => {
                pendingWrite = { value, resolve };
            });
        },
        close() {
            done = true;
            // If a consumer is waiting, tell it we're done.
            if (pendingRead) {
                const reader = pendingRead;
                pendingRead = null;
                reader.resolve({ done: true, value: undefined });
            }
            return Promise.resolve();
        },
        error(err) {
            hasError = true;
            errorValue = err;
            done = true;
            // If a consumer is waiting, reject it.
            if (pendingRead) {
                const reader = pendingRead;
                pendingRead = null;
                reader.reject(err);
            }
        },
    };
    const source = {
        [Symbol.asyncIterator]() {
            return {
                next() {
                    // Error takes priority.
                    if (hasError) {
                        return Promise.reject(errorValue);
                    }
                    // Is a producer already waiting with a value?
                    if (pendingWrite) {
                        const { value, resolve } = pendingWrite;
                        pendingWrite = null;
                        resolve(); // unblock the producer
                        return Promise.resolve({ done: false, value });
                    }
                    // Done and no pending write — stream is over.
                    if (done) {
                        return Promise.resolve({ done: true, value: undefined });
                    }
                    // No producer waiting — park until one arrives.
                    return new Promise((resolve, reject) => {
                        pendingRead = { resolve, reject };
                    });
                },
                return() {
                    // Consumer is done early — signal the producer to stop.
                    done = true;
                    if (pendingWrite) {
                        const { resolve } = pendingWrite;
                        pendingWrite = null;
                        resolve(); // unblock the producer (they'll see done=true)
                    }
                    return Promise.resolve({ done: true, value: undefined });
                },
            };
        },
    };
    return [writer, source];
}
//# sourceMappingURL=channel.js.map