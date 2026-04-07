import type { Source, Transform } from "@culvert/stream";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Options for adding a file to a ZIP archive.
 *
 * The discriminated union enforces: if you bring your own compressor,
 * you must also provide the ZIP compression method number. TypeScript
 * prevents a transform without a header value.
 */
export type AddFileOptions = {
  /** Path within the archive. Forward slashes. No leading slash. */
  name: string;

  /** File data as an async iterable of byte chunks. */
  source: Source<Uint8Array>;

  /** Defaults to now. */
  lastModified?: Date;

  /** Per-entry comment stored in the central directory. */
  comment?: string;

  /** Cancel this individual file. */
  signal?: AbortSignal;
} & (
  | { compression?: "deflate" | "store" }
  | { compress: Transform<Uint8Array, Uint8Array>; compressionMethod: number }
);

/**
 * A single entry from a ZIP archive, yielded by readZipEntries().
 *
 * Metadata available immediately: name, compressionMethod, lastModified.
 * Lazy metadata (compressedSize, uncompressedSize, crc32): returns 0
 * with a console.warn() if accessed before source is fully consumed.
 */
export interface ZipEntry {
  readonly name: string;
  readonly compressionMethod: number;
  readonly lastModified: Date;

  /** Decompressed file data. Pull-based — backpressure is structural. */
  readonly source: Source<Uint8Array>;

  /** Available after source is fully consumed. */
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly crc32: number;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Accumulated per-file metadata for the central directory. */
export interface CentralDirectoryEntry {
  name: Uint8Array;
  comment: Uint8Array;
  compressionMethod: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  lastModified: Date;
}

/** The archive handle passed to the createZip callback. */
export interface ZipArchive {
  addFile(options: AddFileOptions): Promise<void>;
}
