// ---------------------------------------------------------------------------
// Named error classes for @culvert/gzip.
//
// Same shape as @culvert/zip and @culvert/tar: callers can catch
// specific failure modes without parsing error messages.
//
// Two classes, not three — gzip has no concept of "entries," so
// there's no GzipEntryError. Invalid options are plain TypeError.
// ---------------------------------------------------------------------------

/**
 * The gzip stream is malformed or corrupt.
 *
 * Covers: bad magic bytes, unsupported compression method, CRC-32
 * mismatch (under strict policy), ISIZE mismatch, truncated header,
 * truncated footer, truncated compressed data, invalid header flags.
 */
export class GzipCorruptionError extends Error {
  override name = "GzipCorruptionError" as const;

  constructor(message: string) {
    super(message);
  }
}

/**
 * An AbortSignal fired during compression or decompression.
 */
export class GzipAbortError extends Error {
  override name = "GzipAbortError" as const;

  constructor(message: string = "Gzip operation aborted") {
    super(message);
  }
}
