// ---------------------------------------------------------------------------
// @culvert/gzip — public API
//
// 10 exports. Four functions, four types, two errors.
// Everything else is internal.
// ---------------------------------------------------------------------------

// --- Functions ---
export { gzip, gzipWith } from "./gzip.js";
export { gunzip, gunzipWith } from "./gunzip.js";

// --- Types ---
export type {
  GzipOptions,
  GunzipOptions,
  GzipWithOptions,
  GunzipWithOptions,
} from "./types.js";

// --- Errors ---
export { GzipCorruptionError } from "./errors.js";
export { GzipAbortError } from "./errors.js";
