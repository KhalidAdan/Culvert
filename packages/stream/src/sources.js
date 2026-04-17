export function from(input) {
    // Already async iterable — return as-is
    if (Symbol.asyncIterator in input) {
        return input;
    }
    // Sync iterable — wrap in async generator
    return (async function* () {
        for (const item of input) {
            yield item;
        }
    })();
}
// ---------------------------------------------------------------------------
// empty() — a source that immediately completes with no items.
// ---------------------------------------------------------------------------
export function empty() {
    return (async function* () {
        // nothing
    })();
}
// ---------------------------------------------------------------------------
// of() — a source that emits the given values and completes.
// ---------------------------------------------------------------------------
export function of(...values) {
    return (async function* () {
        for (const value of values) {
            yield value;
        }
    })();
}
//# sourceMappingURL=sources.js.map