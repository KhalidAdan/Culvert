// ---------------------------------------------------------------------------
// toReadableStream() — wrap a Culvert Source as a Web ReadableStream.
//
// This is the browser on-ramp. A Response, a fetch body, a Blob stream —
// anything that accepts ReadableStream can consume a Culvert pipeline.
//
//   return new Response(toReadableStream(source), { headers });
// ---------------------------------------------------------------------------
export function toReadableStream(source) {
    const iterator = source[Symbol.asyncIterator]();
    return new ReadableStream({
        async pull(controller) {
            try {
                const { done, value } = await iterator.next();
                if (done) {
                    controller.close();
                }
                else {
                    controller.enqueue(value);
                }
            }
            catch (err) {
                controller.error(err);
            }
        },
        async cancel() {
            await iterator.return?.();
        },
    });
}
// ---------------------------------------------------------------------------
// fromReadableStream() — wrap a Web ReadableStream as a Culvert Source.
//
// In runtimes that support Symbol.asyncIterator on ReadableStream (Node,
// Chrome, Firefox), this is a no-op passthrough. For Safari (which still
// lacks support as of 2025), we manually iterate via the reader.
// ---------------------------------------------------------------------------
export function fromReadableStream(stream) {
    // Fast path: if the stream is already async iterable, use it directly.
    // Cast to `any` for the check because TypeScript's ReadableStream type
    // may not include Symbol.asyncIterator even when the runtime supports it.
    if (Symbol.asyncIterator in stream) {
        return stream;
    }
    // Safari fallback: manually read via the reader
    return (async function* () {
        const reader = stream.getReader();
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done)
                    return;
                yield value;
            }
        }
        finally {
            reader.releaseLock();
        }
    })();
}
// ---------------------------------------------------------------------------
// writeTo() — create a Sink that writes to a Web WritableStream.
//
//   await pipe(source, transform, writeTo(writable));
// ---------------------------------------------------------------------------
export function writeTo(writable) {
    return async (source) => {
        const writer = writable.getWriter();
        try {
            for await (const chunk of source) {
                await writer.write(chunk);
            }
            await writer.close();
        }
        catch (err) {
            await writer.abort(err);
            throw err;
        }
    };
}
//# sourceMappingURL=bridge.js.map