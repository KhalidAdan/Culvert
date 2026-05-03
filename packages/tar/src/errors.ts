// ---------------------------------------------------------------------------
// Named error classes for @culvert/tar.
//
// Same shape as @culvert/zip: callers can catch specific failure modes
// without parsing error messages.
// ---------------------------------------------------------------------------

/**
 * Archive content is malformed or hostile.
 *
 * Reader-emitted: bad checksum, malformed PAX records, hostile path
 * under strict policy, truncated archive, missing end marker, non-UTF-8
 * charset declaration.
 */
export class TarCorruptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TarCorruptionError";
  }
}

/**
 * An AbortSignal fired during read or write.
 */
export class TarAbortError extends Error {
  constructor(message: string = "Tar operation aborted") {
    super(message);
    this.name = "TarAbortError";
  }
}

/**
 * Caller's input was bad.
 *
 * Writer-emitted: declared size mismatch with actual bytes, hostile
 * path under strict writer policy, invalid name, missing required field.
 */
export class TarEntryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TarEntryError";
  }
}
