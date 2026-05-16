import type { Transform, Source } from "@culvert/stream";
import { from } from "@culvert/stream";
import { CRC32 } from "@culvert/crc32";
import { GzipCorruptionError, GzipAbortError } from "./errors.js";
import type { GunzipOptions, GunzipWithOptions } from "./types.js";
import { parseFixedHeader, readUint32LE } from "./header.js";
import {
  HEADER_SIZE,
  FOOTER_SIZE,
  FEXTRA,
  FNAME,
  FCOMMENT,
  FHCRC,
} from "./constants.js";

// ---------------------------------------------------------------------------
// decompressWithPlatform() — delegate to DecompressionStream("gzip").
// ---------------------------------------------------------------------------

function decompressWithPlatform(): Transform<Uint8Array, Uint8Array> {
  return async function* (source: Source<Uint8Array>) {
    const ds = new DecompressionStream("gzip");
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

// ---------------------------------------------------------------------------
// gunzipCore — shared by gunzip() and gunzipWith().
// ---------------------------------------------------------------------------

function gunzipCore(
  decompressTransform: Transform<Uint8Array, Uint8Array>,
  options: GunzipOptions = {},
): Transform<Uint8Array, Uint8Array> {
  return async function* (source: Source<Uint8Array>) {
    if (options.signal?.aborted) {
      throw new GzipAbortError();
    }

    try {
      const decompressed = decompressTransform(source);
      for await (const chunk of decompressed) {
        if (options.signal?.aborted) {
          throw new GzipAbortError();
        }
        yield chunk;
      }
    } catch (err) {
      if (err instanceof GzipCorruptionError || err instanceof GzipAbortError) {
        throw err;
      }
      // Normalize platform errors (TypeError, Error with zlib messages)
      // into GzipCorruptionError for a consistent error taxonomy.
      if (err instanceof Error) {
        throw new GzipCorruptionError(
          `Gzip decompression failed: ${err.message}`,
        );
      }
      throw new GzipCorruptionError("Gzip decompression failed");
    }
  };
}

// ---------------------------------------------------------------------------
// BYOC decompressor — strips gzip framing and passes raw DEFLATE
// to the caller's custom transform. Verifies CRC-32 and ISIZE.
// ---------------------------------------------------------------------------

function decompressWithCustom(
  custom: Transform<Uint8Array, Uint8Array>,
): Transform<Uint8Array, Uint8Array> {
  return async function* (source: Source<Uint8Array>) {
    // Buffer the entire source so we can locate the footer.
    const chunks: Uint8Array[] = [];
    let totalLen = 0;
    for await (const chunk of source) {
      chunks.push(chunk);
      totalLen += chunk.length;
    }

    const buf = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      buf.set(c, offset);
      offset += c.length;
    }

    // Parse fixed header
    const parsed = parseFixedHeader(buf);

    // Skip optional fields
    let pos = HEADER_SIZE;

    if (parsed.flg & FEXTRA) {
      if (buf.length < pos + 2) {
        throw new GzipCorruptionError("Gzip FEXTRA field truncated");
      }
      const xlen = buf[pos]! | (buf[pos + 1]! << 8);
      pos += 2 + xlen;
    }

    if (parsed.flg & FNAME) {
      while (pos < buf.length && buf[pos] !== 0) pos++;
      if (pos >= buf.length) {
        throw new GzipCorruptionError("Gzip FNAME field truncated");
      }
      pos++; // skip null terminator
    }

    if (parsed.flg & FCOMMENT) {
      while (pos < buf.length && buf[pos] !== 0) pos++;
      if (pos >= buf.length) {
        throw new GzipCorruptionError("Gzip FCOMMENT field truncated");
      }
      pos++; // skip null terminator
    }

    if (parsed.flg & FHCRC) {
      pos += 2; // skip CRC-16
    }

    if (buf.length < pos + FOOTER_SIZE) {
      throw new GzipCorruptionError("Gzip footer truncated");
    }

    const deflateEnd = buf.length - FOOTER_SIZE;
    const expectedCrc = readUint32LE(buf, deflateEnd);
    const expectedIsize = readUint32LE(buf, deflateEnd + 4);
    const deflateData = buf.subarray(pos, deflateEnd);

    // Decompress via custom transform and verify CRC/ISIZE on the fly
    const crc = new CRC32();
    let size = 0;

    const decompressed = custom(from([deflateData]));
    for await (const chunk of decompressed) {
      crc.update(chunk);
      size += chunk.length;
      yield chunk;
    }

    if (crc.digest() !== expectedCrc) {
      throw new GzipCorruptionError("Gzip CRC-32 mismatch");
    }
    if ((size % 0x100000000) !== expectedIsize) {
      throw new GzipCorruptionError("Gzip ISIZE mismatch");
    }
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Streaming gzip decompressor.
 *
 * Returns a Transform<Uint8Array, Uint8Array> that decompresses a
 * single gzip member (RFC 1952) using the platform's
 * DecompressionStream.
 *
 * CRC-32 and ISIZE are validated by the platform. Mismatches throw
 * GzipCorruptionError. There is no permissive mode — use gunzipWith()
 * with a custom decompressor for damaged streams.
 *
 * Concatenated gzip members are not supported. The WHATWG Compression
 * Streams spec defines a gzip stream as a single member.
 *
 * @example
 * ```ts
 * await pipe(compressedSource, gunzip(), writeTo("output.txt"));
 * ```
 */
export function gunzip(
  options?: GunzipOptions,
): Transform<Uint8Array, Uint8Array> {
  return gunzipCore(decompressWithPlatform(), options);
}

/**
 * Streaming gzip decompressor with a custom transform (BYOC).
 *
 * The custom transform receives raw DEFLATE data (no gzip framing).
 * @culvert/gzip parses the header, strips footer, verifies CRC-32 and
 * ISIZE, and streams the raw DEFLATE through the custom decompressor.
 */
export function gunzipWith(
  options: GunzipWithOptions,
): Transform<Uint8Array, Uint8Array> {
  return async function* (source: Source<Uint8Array>) {
    if (options.signal?.aborted) {
      throw new GzipAbortError();
    }

    const decompressed = decompressWithCustom(options.decompress)(source);
    for await (const chunk of decompressed) {
      if (options.signal?.aborted) {
        throw new GzipAbortError();
      }
      yield chunk;
    }
  };
}
