import type { Transform } from "@culvert/stream";

// ---------------------------------------------------------------------------
// deflateRaw() — platform-provided raw deflate as a Transform.
//
// Uses CompressionStream("deflate-raw") which is available in:
//   - All modern browsers (Chrome 80+, Firefox 113+, Safari 16.4+)
//   - Node.js 18+ (via web streams compat)
//   - Deno, Bun, Cloudflare Workers
//
// The "raw" variant produces/consumes bare DEFLATE (RFC 1951):
// no zlib header (RFC 1950), no gzip wrapper (RFC 1952).
// ZIP uses this for per-file compression.
// Gzip uses this with its own framing around it.
// ---------------------------------------------------------------------------

export function deflateRaw(): Transform<Uint8Array, Uint8Array> {
  return async function* (source) {
    const cs = new CompressionStream("deflate-raw");
    const writer = cs.writable.getWriter();
    const reader = cs.readable.getReader();

    const pump = (async () => {
      try {
        for await (const chunk of source) {
          await writer.write(chunk as any);
        }
        await writer.close();
      } catch (err) {
        await writer.abort(err);
      }
    })();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield value;
      }
    } finally {
      reader.releaseLock();
      await pump;
    }
  };
}

// ---------------------------------------------------------------------------
// inflateRaw() — platform-provided raw inflate as a Transform.
// ---------------------------------------------------------------------------

export function inflateRaw(): Transform<Uint8Array, Uint8Array> {
  return async function* (source) {
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();

    const pump = (async () => {
      try {
        for await (const chunk of source) {
          await writer.write(chunk as any);
        }
        await writer.close();
      } catch (err) {
        await writer.abort(err);
      }
    })();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        yield value;
      }
    } finally {
      reader.releaseLock();
      await pump;
    }
  };
}
