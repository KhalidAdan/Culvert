// ---------------------------------------------------------------------------
// track() — wraps an AsyncIterable so we can capture every iterator it creates.
// This is how pipe() knows what to tear down when things go wrong.
// ---------------------------------------------------------------------------
function track(iterable, iterators) {
    return {
        [Symbol.asyncIterator]() {
            const it = iterable[Symbol.asyncIterator]();
            iterators.push(it);
            return it;
        },
    };
}
// ---------------------------------------------------------------------------
// teardown() — close all tracked iterators, outermost first.
//
// If a primary error exists, it's re-thrown after cleanup. Errors from
// cleanup are attached as .suppressedErrors on the primary (borrowing
// Java's try-with-resources pattern). If there's no primary error but
// cleanup fails, the first cleanup error is thrown.
// ---------------------------------------------------------------------------
async function teardown(iterators, primaryError) {
    const suppressed = [];
    // Walk from outermost to innermost — mirrors the order of creation
    for (let i = iterators.length - 1; i >= 0; i--) {
        try {
            await iterators[i].return?.();
        }
        catch (err) {
            suppressed.push(err);
        }
    }
    if (primaryError !== undefined) {
        if (primaryError instanceof Error && suppressed.length > 0) {
            primaryError.suppressedErrors =
                suppressed;
        }
        throw primaryError;
    }
    if (suppressed.length > 0) {
        throw suppressed[0];
    }
}
export function pipe(source, ...stages) {
    // Separate the sink (last argument) from transforms (everything else)
    const sink = stages.pop();
    const transforms = stages;
    // Track every iterator so we can guarantee cleanup
    const iterators = [];
    // Build the pipeline: each transform wraps the previous source
    let current = track(source, iterators);
    for (const transform of transforms) {
        current = track(transform(current), iterators);
    }
    // Run — the sink pulls through the entire chain
    const run = async () => {
        let primaryError;
        let result;
        try {
            result = await sink(current);
        }
        catch (err) {
            primaryError = err;
        }
        // Always tear down, regardless of outcome.
        // teardown() re-throws primaryError if set, attaching any
        // suppressed cleanup errors.
        await teardown(iterators, primaryError);
        return result;
    };
    return run();
}
//# sourceMappingURL=pipe.js.map