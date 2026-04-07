// ---------------------------------------------------------------------------
// ZipCorruptionError — the data is wrong.
//
// CRC mismatch, malformed header, truncated archive, invalid signature.
// Thrown by the reader when the bytes don't match the spec.
// ---------------------------------------------------------------------------

export class ZipCorruptionError extends Error {
  override name = "ZipCorruptionError" as const;

  constructor(message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// ZipAbortError — the operation was cancelled.
//
// An AbortSignal fired, either at the archive level or per-file.
// ---------------------------------------------------------------------------

export class ZipAbortError extends Error {
  override name = "ZipAbortError" as const;

  constructor(message?: string) {
    super(message ?? "ZIP operation aborted");
  }
}

// ---------------------------------------------------------------------------
// ZipEntryError — the caller's data is wrong.
//
// Invalid entry name, missing source, or other input validation failure.
// Thrown before any bytes are written — this is a programming error,
// not a data error.
// ---------------------------------------------------------------------------

export class ZipEntryError extends Error {
  override name = "ZipEntryError" as const;

  constructor(message: string) {
    super(message);
  }
}
