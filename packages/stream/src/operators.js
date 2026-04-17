// ---------------------------------------------------------------------------
// tap() — observe each chunk without altering the stream.
//
// Earns its place because:
// 1. The await on fn() is load-bearing — skip it and async side effects
//    detach from the pipeline, causing unhandled rejections.
// 2. The pattern appears multiple times per pipeline (e.g., CRC + size
//    tracking in ZIP). A named concept makes pipelines readable.
// ---------------------------------------------------------------------------
export function tap(fn) {
    return async function* (source) {
        for await (const chunk of source) {
            await fn(chunk);
            yield chunk;
        }
    };
}
// ---------------------------------------------------------------------------
// finalize() — guaranteed cleanup on any termination path.
//
// Earns its place because:
// The streaming equivalent of `finally`. Runs the callback when the
// pipeline completes, errors, or the consumer stops early. Without this,
// every resource-holding pipeline needs manual teardown that developers
// forget.
// ---------------------------------------------------------------------------
export function finalize(fn) {
    return async function* (source) {
        try {
            for await (const chunk of source) {
                yield chunk;
            }
        }
        finally {
            await fn();
        }
    };
}
// ---------------------------------------------------------------------------
// abortable() — wrap a source so it stops yielding when a signal fires.
//
// Earns its place because:
// This keeps abort concerns out of pipe(). The signal is just another
// reason a source might end. pipe()'s existing teardown handles the rest.
// ---------------------------------------------------------------------------
export function abortable(source, signal) {
    return (async function* () {
        if (signal.aborted)
            return;
        const iterator = source[Symbol.asyncIterator]();
        try {
            while (true) {
                if (signal.aborted)
                    return;
                const result = await iterator.next();
                if (result.done)
                    return;
                yield result.value;
            }
        }
        finally {
            await iterator.return?.();
        }
    })();
}
// ---------------------------------------------------------------------------
// batch() — collect chunks into groups by count and/or time.
//
// Earns its place because:
// 1. The time-based variant has edge cases around flushing the last
//    incomplete batch that hand-rolled solutions invariably get wrong.
// 2. Crucial for database writes, API calls — anywhere per-item overhead
//    dominates.
//
// batch(n)           — emit every n items
// batch(n, ms)       — emit every n items OR every ms milliseconds,
//                       whichever comes first
// ---------------------------------------------------------------------------
export function batch(size, timeoutMs) {
    if (timeoutMs === undefined) {
        // Count-only batching — pure and simple
        return async function* (source) {
            let buf = [];
            for await (const item of source) {
                buf.push(item);
                if (buf.length >= size) {
                    yield buf;
                    buf = [];
                }
            }
            // Flush remainder
            if (buf.length > 0)
                yield buf;
        };
    }
    // Count + time batching
    return async function* (source) {
        let buf = [];
        let timer;
        let flushResolve;
        const startTimer = () => {
            clearTimer();
            timer = setTimeout(() => {
                flushResolve?.();
            }, timeoutMs);
        };
        const clearTimer = () => {
            if (timer !== undefined) {
                clearTimeout(timer);
                timer = undefined;
            }
        };
        const iterator = source[Symbol.asyncIterator]();
        try {
            while (true) {
                // Race: next item vs. timer flush
                const flushPromise = new Promise((resolve) => {
                    flushResolve = () => resolve("flush");
                });
                const nextPromise = iterator.next().then((result) => ({ kind: "next", result }), (err) => ({ kind: "error", error: err }));
                const winner = await Promise.race([nextPromise, flushPromise]);
                if (winner === "flush") {
                    // Timer fired — flush whatever we have
                    if (buf.length > 0) {
                        yield buf;
                        buf = [];
                    }
                    continue;
                }
                if (winner.kind === "error") {
                    throw winner.error;
                }
                if (winner.result.done)
                    break;
                buf.push(winner.result.value);
                if (buf.length === 1) {
                    // First item in a new batch — start the clock
                    startTimer();
                }
                if (buf.length >= size) {
                    clearTimer();
                    yield buf;
                    buf = [];
                }
            }
            // Flush remainder
            if (buf.length > 0)
                yield buf;
        }
        finally {
            clearTimer();
            await iterator.return?.();
        }
    };
}
// ---------------------------------------------------------------------------
// merge() — interleave multiple sources into a single stream.
//
// Earns its place because:
// 1. When one source errors, all others must be torn down.
// 2. Backpressure coordination across concurrent sources is subtle —
//    the naive Promise.race approach can cause unbounded buffering
//    if the consumer is slow and the sources are fast.
// 3. Every hand-rolled merge leaks iterators in the error path.
//
// Items arrive in the order they're produced across all sources
// (no ordering guarantee between sources).
// ---------------------------------------------------------------------------
export function merge(...sources) {
    return (async function* () {
        if (sources.length === 0)
            return;
        if (sources.length === 1) {
            yield* sources[0];
            return;
        }
        const iterators = sources.map((s) => s[Symbol.asyncIterator]());
        const active = new Set(iterators.map((_, i) => i));
        const pending = new Map();
        const pull = (index) => {
            const p = iterators[index].next().then((result) => ({ index, result }));
            pending.set(index, p);
        };
        // Initial pull from all sources
        for (const i of active) {
            pull(i);
        }
        try {
            while (active.size > 0) {
                // Wait for whichever source produces next
                const winner = await Promise.race(pending.values());
                pending.delete(winner.index);
                if (winner.result.done) {
                    active.delete(winner.index);
                }
                else {
                    yield winner.result.value;
                    // Pull the next item from the same source
                    pull(winner.index);
                }
            }
        }
        finally {
            // Tear down ALL iterators — including ones that haven't errored
            const errors = [];
            for (const [index, iterator] of iterators.entries()) {
                if (active.has(index) || pending.has(index)) {
                    try {
                        await iterator.return?.();
                    }
                    catch (err) {
                        errors.push(err);
                    }
                }
            }
            if (errors.length > 0)
                throw errors[0];
        }
    })();
}
// ---------------------------------------------------------------------------
// concat() — consume sources sequentially, one after another.
//
// Earns its place because resource cleanup between sources is subtle.
// If source two fails to open, source one's resources must already
// be released (which the async iteration protocol handles, but only
// if you iterate properly with for-await and don't manually juggle
// iterators).
// ---------------------------------------------------------------------------
export function concat(...sources) {
    return (async function* () {
        for (const source of sources) {
            yield* source;
        }
    })();
}
export function flatMap(fn, options = {}) {
    const { concurrency = 1 } = options;
    if (concurrency === 1) {
        // Sequential — simple and correct
        return async function* (source) {
            for await (const item of source) {
                yield* fn(item);
            }
        };
    }
    // Concurrent — substantially more complex
    return async function* (source) {
        const outerIterator = source[Symbol.asyncIterator]();
        const innerIterators = new Map();
        const innerPending = new Map();
        let nextIndex = 0;
        let outerDone = false;
        const pullInner = (index) => {
            const it = innerIterators.get(index);
            const p = it.next().then((result) => ({ index, result }));
            innerPending.set(index, p);
        };
        const teardownInner = async () => {
            const errors = [];
            for (const it of innerIterators.values()) {
                try {
                    await it.return?.();
                }
                catch (err) {
                    errors.push(err);
                }
            }
            innerIterators.clear();
            innerPending.clear();
            return errors;
        };
        const startInner = (item) => {
            const index = nextIndex++;
            const innerSource = fn(item);
            const it = innerSource[Symbol.asyncIterator]();
            innerIterators.set(index, it);
            pullInner(index);
        };
        try {
            // Seed: pull up to `concurrency` items from outer source
            while (!outerDone && innerIterators.size < concurrency) {
                const next = await outerIterator.next();
                if (next.done) {
                    outerDone = true;
                    break;
                }
                startInner(next.value);
            }
            // Main loop: yield inner results, start new inners as slots open
            while (innerPending.size > 0) {
                const winner = await Promise.race(innerPending.values());
                innerPending.delete(winner.index);
                if (winner.result.done) {
                    // Inner source exhausted — clean up and maybe start a new one
                    innerIterators.delete(winner.index);
                    if (!outerDone && innerIterators.size < concurrency) {
                        const next = await outerIterator.next();
                        if (next.done) {
                            outerDone = true;
                        }
                        else {
                            startInner(next.value);
                        }
                    }
                }
                else {
                    yield winner.result.value;
                    pullInner(winner.index);
                }
            }
        }
        finally {
            const errors = await teardownInner();
            try {
                await outerIterator.return?.();
            }
            catch (err) {
                errors.push(err);
            }
            if (errors.length > 0)
                throw errors[0];
        }
    };
}
export function buffer(size, strategy = "suspend") {
    return (source) => {
        return (async function* () {
            const buf = [];
            const iterator = source[Symbol.asyncIterator]();
            let sourceDone = false;
            let sourceError;
            // Consumer resolve — signals that the consumer is waiting for data
            let consumerResolve;
            // Producer resolve — signals that a buffer slot opened up (for "suspend")
            let producerResolve;
            const producerLoop = async () => {
                try {
                    while (true) {
                        const next = await iterator.next();
                        if (next.done) {
                            sourceDone = true;
                            consumerResolve?.();
                            return;
                        }
                        if (buf.length >= size) {
                            switch (strategy) {
                                case "suspend":
                                    // Wait for consumer to drain
                                    await new Promise((r) => {
                                        producerResolve = r;
                                    });
                                    break;
                                case "drop":
                                    // Discard this item, don't buffer it
                                    consumerResolve?.();
                                    continue;
                                case "slide":
                                    // Drop oldest to make room
                                    buf.shift();
                                    break;
                                case "error":
                                    throw new Error(`Buffer overflow: capacity ${size} exceeded`);
                            }
                        }
                        buf.push(next.value);
                        consumerResolve?.();
                    }
                }
                catch (err) {
                    sourceError = err;
                    sourceDone = true;
                    consumerResolve?.();
                }
            };
            // Start producing in the background
            const producerDone = producerLoop();
            try {
                while (true) {
                    if (buf.length > 0) {
                        const item = buf.shift();
                        // Signal producer that a slot opened
                        producerResolve?.();
                        producerResolve = undefined;
                        yield item;
                    }
                    else if (sourceDone) {
                        if (sourceError)
                            throw sourceError;
                        return;
                    }
                    else {
                        // Wait for producer to push something
                        await new Promise((r) => {
                            consumerResolve = r;
                        });
                    }
                }
            }
            finally {
                await iterator.return?.();
                await producerDone;
            }
        })();
    };
}
//# sourceMappingURL=operators.js.map