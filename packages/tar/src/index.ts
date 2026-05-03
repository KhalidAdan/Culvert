// Functions
export { createTar, EPOCH } from "./writer.js";
export { readTarEntries } from "./reader.js";

// Types
export type {
  CreateTarOptions,
  ReadTarOptions,
  AddFileOptions,
  AddDirectoryOptions,
  AddSymlinkOptions,
  AddHardLinkOptions,
  TarArchive,
  TarEntry,
  TarFileEntry,
  TarDirectoryEntry,
  TarSymlinkEntry,
  TarHardLinkEntry,
  TarUnknownEntry,
  PathPolicy,
} from "./types.js";

// Errors
export { TarCorruptionError, TarAbortError, TarEntryError } from "./errors.js";
