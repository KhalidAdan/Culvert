/**
 * The NDJSON wire format streamed by /api/peek.
 *
 * One JSON object per line. The client routes events into UI state by `t`.
 * The server emits these in roughly this order, with `mem` interleaved
 * throughout at a fixed cadence:
 *
 *   start   →   entry × N   (interleaved with mem × M)   →   done
 *
 * On any failure: `error` is emitted and the stream closes.
 */
export type PeekEvent =
  | StartEvent
  | EntryEvent
  | MemEvent
  | DoneEvent
  | ErrorEvent;

export interface StartEvent {
  t: "start";
  package: string;
  version: string;
  tarballUrl: string;
}

export interface EntryEvent {
  t: "entry";
  /** Path inside the archive, after PAX merge and strict path validation. */
  path: string;
  /** File size in bytes. Zero for non-file entries. */
  size: number;
  kind: "file" | "directory" | "symlink" | "hardlink" | "unknown";
}

export interface MemEvent {
  t: "mem";
  /** Milliseconds since the request started, server-side. */
  ms: number;
  /** Node `process.memoryUsage().heapUsed`, in bytes. */
  heapUsed: number;
  /** Cumulative bytes pulled from the tarball stream so far. */
  bytesIn: number;
}

export interface DoneEvent {
  t: "done";
  ms: number;
  totalEntries: number;
  /** Sum of declared file sizes across all entries. */
  totalBytes: number;
}

export interface ErrorEvent {
  t: "error";
  message: string;
}
