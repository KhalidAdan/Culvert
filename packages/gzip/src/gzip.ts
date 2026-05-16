import type { Transform, Source } from "@culvert/stream";
import { deflateRaw } from "@culvert/internal-deflate";
import { CRC32 } from "@culvert/crc32";
import { buildGzipHeader, buildGzipFooter } from "./header.js";
import { GzipAbortError } from "./errors.js";
import type { GzipOptions, GzipWithOptions } from "./types.js";

// ---------------------------------------------------------------------------
// EPOCH — reproducible-build mtime default.
//
// Same convention as @culvert/tar. Two compressions of the same input
// with the same options produce byte-identical output.
// ---------------------------------------------------------------------------

const EPOCH = new Date(0);

// ---------------------------------------------------------------------------
// Core gzip implementation
//
// Factored so both gzip() and gzipWith() share the same framing logic.
// The only difference is the DEFLATE transform used.
// ---------------------------------------------------------------------------

function gzipCore(
  compressTransform: Transform<Uint8Array, Uint8Array>,
  options: GzipOptions = {},
): Transform<Uint8Array, Uint8Array> {
  return async function* (source: Source<Uint8Array>) {
    // Check for pre-aborted signal
    if (options.signal?.aborted) {
      throw new GzipAbortError();
    }

    // --- Header ---
    yield buildGzipHeader({
      mtime: options.mtime ?? EPOCH,
      filename: options.filename,
      comment: options.comment,
    });

    // --- Compressed data ---
    // We need to:
    // 1. Compute CRC-32 of the *uncompressed* data
    // 2. Track uncompressed size
    // 3. Compress via raw DEFLATE
    //
    // Strategy: tap the source before compression to accumulate
    // CRC and size, then yield the compressed output.

    const crc = new CRC32();
    let totalSize = 0;

    // Create a tapped source that computes CRC/size on the way through
    async function* tappedSource(): AsyncGenerator<Uint8Array> {
      for await (const chunk of source) {
        if (options.signal?.aborted) {
          throw new GzipAbortError();
        }
        crc.update(chunk);
        totalSize += chunk.length;
        yield chunk;
      }
    }

    // Compress the tapped source
    const compressed = compressTransform(tappedSource());

    for await (const chunk of compressed) {
      if (options.signal?.aborted) {
        throw new GzipAbortError();
      }
      yield chunk;
    }

    // --- Footer ---
    yield buildGzipFooter(crc.digest(), totalSize);
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Streaming gzip compressor.
 *
 * Returns a Transform<Uint8Array, Uint8Array> that wraps the input in
 * gzip framing (RFC 1952) using platform-provided raw DEFLATE.
 *
 * @example
 * ```ts
 * await pipe(source, gzip(), writeTo("output.gz"));
 * ```
 */
export function gzip(options?: GzipOptions): Transform<Uint8Array, Uint8Array> {
  return gzipCore(deflateRaw(), options);
}

/**
 * Streaming gzip compressor with a custom DEFLATE transform (BYOC).
 *
 * The custom transform handles raw DEFLATE (no gzip framing).
 * @culvert/gzip handles header, footer, CRC-32, and ISIZE.
 */
export function gzipWith(
  options: GzipWithOptions,
): Transform<Uint8Array, Uint8Array> {
  return gzipCore(options.compress, options);
}
