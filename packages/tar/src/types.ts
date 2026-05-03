import type { Source } from "@culvert/stream";

// ---------------------------------------------------------------------------
// Public entry types — what the reader yields
//
// Discriminated by `kind`. Five branches cover every typeflag the reader
// surfaces. PAX 'x' and 'g' headers are consumed internally and never
// reach the caller.
// ---------------------------------------------------------------------------

export interface TarFileEntry {
  kind: "file";
  name: string;
  size: number;
  lastModified: Date;
  mode: number;
  uid: number;
  gid: number;
  source: Source<Uint8Array>;
}

export interface TarDirectoryEntry {
  kind: "directory";
  name: string;
  lastModified: Date;
  mode: number;
  uid: number;
  gid: number;
}

export interface TarSymlinkEntry {
  kind: "symlink";
  name: string;
  target: string;
  lastModified: Date;
}

export interface TarHardLinkEntry {
  kind: "hardlink";
  name: string;
  target: string;
  lastModified: Date;
}

export interface TarUnknownEntry {
  kind: "unknown";
  typeflag: string;
  name: string;
  size: number;
}

export type TarEntry =
  | TarFileEntry
  | TarDirectoryEntry
  | TarSymlinkEntry
  | TarHardLinkEntry
  | TarUnknownEntry;

// ---------------------------------------------------------------------------
// Path policy — shared shape between writer and reader
//
// 'strict'     — reject hostile paths
// 'permissive' — pass through unchanged
// function     — caller-defined transform/reject
// ---------------------------------------------------------------------------

export type PathPolicy =
  | "strict"
  | "permissive"
  | ((name: string) => string | Error);

// ---------------------------------------------------------------------------
// Writer options
// ---------------------------------------------------------------------------

export interface CreateTarOptions {
  signal?: AbortSignal;
  pathPolicy?: PathPolicy;
  mtimePrecision?: "seconds" | "subsecond";
}

export interface AddFileOptions {
  name: string;
  source: Source<Uint8Array>;
  size: number;
  lastModified: Date;
  mode?: number;
  uid?: number;
  gid?: number;
}

export interface AddDirectoryOptions {
  name: string;
  lastModified: Date;
  mode?: number;
  uid?: number;
  gid?: number;
}

export interface AddSymlinkOptions {
  name: string;
  target: string;
  lastModified: Date;
}

export interface AddHardLinkOptions {
  name: string;
  target: string;
  lastModified: Date;
}

export interface TarArchive {
  addFile(options: AddFileOptions): Promise<void>;
  addDirectory(options: AddDirectoryOptions): Promise<void>;
  addSymlink(options: AddSymlinkOptions): Promise<void>;
  addHardLink(options: AddHardLinkOptions): Promise<void>;
}

// ---------------------------------------------------------------------------
// Reader options
// ---------------------------------------------------------------------------

export interface ReadTarOptions {
  signal?: AbortSignal;
  pathPolicy?: PathPolicy;
  checksumPolicy?: "strict" | "permissive";
}
