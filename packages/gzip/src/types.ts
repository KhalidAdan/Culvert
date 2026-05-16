import type { Transform } from "@culvert/stream";

// ---------------------------------------------------------------------------
// Compressor options
// ---------------------------------------------------------------------------

export interface GzipOptions {
  /** Original filename, stored in gzip header (FNAME). ISO 8859-1. */
  filename?: string;
  /**
   * Modification time, stored in gzip header.
   * Defaults to EPOCH (Unix time 0) for reproducible output.
   */
  mtime?: Date;
  /** Comment, stored in gzip header (FCOMMENT). ISO 8859-1. */
  comment?: string;
  /** Cancel compression. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Decompressor options
// ---------------------------------------------------------------------------

export interface GunzipOptions {
  /** Cancel decompression. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// BYOC (bring your own compressor) options
//
// The custom transform handles raw DEFLATE (no gzip framing).
// @culvert/gzip handles header, footer, CRC, and ISIZE.
// ---------------------------------------------------------------------------

export interface GzipWithOptions extends GzipOptions {
  /** Custom raw DEFLATE compressor. */
  compress: Transform<Uint8Array, Uint8Array>;
}

export interface GunzipWithOptions extends GunzipOptions {
  /** Custom raw DEFLATE decompressor. */
  decompress: Transform<Uint8Array, Uint8Array>;
}
