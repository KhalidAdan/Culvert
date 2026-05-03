import { channel, type Source } from "@culvert/stream";
import {
  BLOCK_SIZE,
  DEFAULT_DIRECTORY_MODE,
  DEFAULT_FILE_MODE,
  DEFAULT_HARDLINK_MODE,
  DEFAULT_SYMLINK_MODE,
  END_OF_ARCHIVE_SIZE,
  PAX_KEY_LINKPATH,
  PAX_KEY_MTIME,
  PAX_KEY_PATH,
  PAX_KEY_SIZE,
  TYPEFLAG_DIRECTORY,
  TYPEFLAG_FILE,
  TYPEFLAG_HARDLINK,
  TYPEFLAG_SYMLINK,
  USTAR_MAX_SIZE,
} from "./constants.js";
import { TarAbortError, TarEntryError } from "./errors.js";
import { applyPathPolicy } from "./path-policy.js";
import { buildPaxExtendedHeader } from "./pax.js";
import type {
  AddDirectoryOptions,
  AddFileOptions,
  AddHardLinkOptions,
  AddSymlinkOptions,
  CreateTarOptions,
  TarArchive,
} from "./types.js";
import {
  encodeUstarHeader,
  fitsInUstar,
  trySplitPath,
  type UstarHeaderFields,
} from "./ustar.js";

// ---------------------------------------------------------------------------
// EPOCH — exported constant for reproducible-build mtimes.
//
// Equivalent to `tar --mtime=@0` and `SOURCE_DATE_EPOCH=0`. Using this
// named constant in archive output makes the determinism choice
// self-documenting at the call site.
// ---------------------------------------------------------------------------

export const EPOCH: Date = new Date(0);

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

/** Ensure a directory name ends with a single trailing slash. */
function normalizeDirName(name: string): string {
  if (name.endsWith("/")) return name;
  return name + "/";
}

/** Pad a block to BLOCK_SIZE; returns the number of zero bytes needed. */
function blockPadding(dataLength: number): number {
  const remainder = dataLength % BLOCK_SIZE;
  return remainder === 0 ? 0 : BLOCK_SIZE - remainder;
}

// ---------------------------------------------------------------------------
// PAX-or-ustar field decision
//
// Returns:
//   - usableHeaderFields: the values to write in the 512-byte ustar
//     header (truncated/fallback values where PAX overrides apply)
//   - paxRecords: the PAX records to emit before the ustar header,
//     or null if no PAX header is needed.
// ---------------------------------------------------------------------------

interface FieldsInput {
  path: string;
  size: number;
  mtime: Date;
  mode: number;
  uid: number;
  gid: number;
  typeflag: string;
  linkname?: string;
  mtimePrecision: "seconds" | "subsecond";
}

interface FieldsOutput {
  ustarFields: UstarHeaderFields;
  paxRecords: Map<string, string> | null;
}

function buildHeaderFields(input: FieldsInput): FieldsOutput {
  const records = new Map<string, string>();

  // --- Path ---
  const split = trySplitPath(input.path);
  let ustarName: string | Uint8Array;
  let ustarPrefix: string;
  if (split === null) {
    // Path doesn't fit in name + prefix at all. Use first 100 bytes
    // as the fallback ustar name and emit a PAX path record.
    // We keep the raw truncated bytes (no TextDecoder round-trip) to
    // avoid re-encoding U+FFFD replacement chars that inflate the size.
    const encoder = new TextEncoder();
    const bytes = encoder.encode(input.path);
    ustarName = bytes.subarray(0, 100);
    ustarPrefix = "";
    records.set(PAX_KEY_PATH, input.path);
  } else {
    ustarName = split.name;
    ustarPrefix = split.prefix;
  }

  // --- Linkname (symlinks/hardlinks) ---
  let ustarLinkname: string | Uint8Array = input.linkname ?? "";
  if (input.linkname && new TextEncoder().encode(input.linkname).length > 100) {
    records.set(PAX_KEY_LINKPATH, input.linkname);
    // Truncate the ustar field to a fallback — keep raw bytes to
    // avoid re-encoding issues with mid-character truncation.
    const bytes = new TextEncoder().encode(input.linkname);
    ustarLinkname = bytes.subarray(0, 100);
  }

  // --- Size ---
  let ustarSize = input.size;
  if (input.size > USTAR_MAX_SIZE) {
    records.set(PAX_KEY_SIZE, input.size.toString());
    ustarSize = 0; // sentinel-style fallback
  }

  // --- mtime ---
  const mtimeMs = input.mtime.getTime();
  const mtimeSecondsFloat = mtimeMs / 1000;
  const mtimeSecondsInt = Math.floor(mtimeSecondsFloat);
  if (input.mtimePrecision === "subsecond" && mtimeSecondsFloat !== mtimeSecondsInt) {
    // Emit a PAX mtime record with millisecond precision.
    records.set(PAX_KEY_MTIME, mtimeSecondsFloat.toString());
  }

  const ustarFields: UstarHeaderFields = {
    name: ustarName,
    prefix: ustarPrefix,
    mode: input.mode,
    uid: input.uid,
    gid: input.gid,
    size: ustarSize,
    mtimeSeconds: mtimeSecondsInt,
    typeflag: input.typeflag,
    linkname: ustarLinkname,
  };

  return {
    ustarFields,
    paxRecords: records.size > 0 ? records : null,
  };
}

// ---------------------------------------------------------------------------
// createTar — main writer entry point
// ---------------------------------------------------------------------------

export function createTar(
  callback: (archive: TarArchive) => Promise<void>,
  options: CreateTarOptions = {},
): Source<Uint8Array> {
  const mtimePrecision = options.mtimePrecision ?? "seconds";
  const pathPolicy = options.pathPolicy;

  const [writer, source] = channel<Uint8Array>();

  // Background producer task.
  const produce = async (): Promise<void> => {
    if (options.signal?.aborted) {
      throw new TarAbortError();
    }

    /** Validate a path (and possibly transform) per pathPolicy. */
    const checkPath = (rawName: string): string => {
      const result = applyPathPolicy(rawName, pathPolicy);
      if (result instanceof Error) {
        throw new TarEntryError(result.message);
      }
      return result;
    };

    /** Emit a single entry (PAX header if needed, ustar header, data, padding). */
    const emitEntry = async (
      input: FieldsInput,
      data?: Source<Uint8Array>,
    ): Promise<void> => {
      const { ustarFields, paxRecords } = buildHeaderFields(input);

      if (paxRecords !== null) {
        await writer.write(buildPaxExtendedHeader(paxRecords));
        if (options.signal?.aborted) throw new TarAbortError();
      }

      const header = encodeUstarHeader(ustarFields);
      await writer.write(header);
      if (options.signal?.aborted) throw new TarAbortError();

      if (data !== undefined) {
        let bytesWritten = 0;
        for await (const chunk of data) {
          if (options.signal?.aborted) throw new TarAbortError();
          if (chunk.length === 0) continue;
          bytesWritten += chunk.length;
          if (bytesWritten > input.size) {
            throw new TarEntryError(
              `Source for "${input.path}" yielded more bytes than declared size ${input.size}`,
            );
          }
          await writer.write(chunk);
        }
        if (bytesWritten !== input.size) {
          throw new TarEntryError(
            `Source for "${input.path}" yielded ${bytesWritten} bytes, ` +
              `but declared size was ${input.size}`,
          );
        }
        const pad = blockPadding(bytesWritten);
        if (pad > 0) {
          await writer.write(new Uint8Array(pad));
        }
      }
    };

    const archive: TarArchive = {
      async addFile(opts: AddFileOptions): Promise<void> {
        if (typeof opts.size !== "number" || opts.size < 0) {
          throw new TarEntryError(`addFile: invalid size ${opts.size}`);
        }
        if (!(opts.lastModified instanceof Date)) {
          throw new TarEntryError("addFile: lastModified is required");
        }
        const name = checkPath(opts.name);
        await emitEntry(
          {
            path: name,
            size: opts.size,
            mtime: opts.lastModified,
            mode: opts.mode ?? DEFAULT_FILE_MODE,
            uid: opts.uid ?? 0,
            gid: opts.gid ?? 0,
            typeflag: TYPEFLAG_FILE,
            mtimePrecision,
          },
          opts.source,
        );
      },

      async addDirectory(opts: AddDirectoryOptions): Promise<void> {
        if (!(opts.lastModified instanceof Date)) {
          throw new TarEntryError("addDirectory: lastModified is required");
        }
        const name = checkPath(normalizeDirName(opts.name));
        await emitEntry({
          path: name,
          size: 0,
          mtime: opts.lastModified,
          mode: opts.mode ?? DEFAULT_DIRECTORY_MODE,
          uid: opts.uid ?? 0,
          gid: opts.gid ?? 0,
          typeflag: TYPEFLAG_DIRECTORY,
          mtimePrecision,
        });
      },

      async addSymlink(opts: AddSymlinkOptions): Promise<void> {
        if (!(opts.lastModified instanceof Date)) {
          throw new TarEntryError("addSymlink: lastModified is required");
        }
        if (typeof opts.target !== "string" || opts.target.length === 0) {
          throw new TarEntryError("addSymlink: target is required");
        }
        const name = checkPath(opts.name);
        await emitEntry({
          path: name,
          size: 0,
          mtime: opts.lastModified,
          mode: DEFAULT_SYMLINK_MODE,
          uid: 0,
          gid: 0,
          typeflag: TYPEFLAG_SYMLINK,
          linkname: opts.target,
          mtimePrecision,
        });
      },

      async addHardLink(opts: AddHardLinkOptions): Promise<void> {
        if (!(opts.lastModified instanceof Date)) {
          throw new TarEntryError("addHardLink: lastModified is required");
        }
        if (typeof opts.target !== "string" || opts.target.length === 0) {
          throw new TarEntryError("addHardLink: target is required");
        }
        const name = checkPath(opts.name);
        await emitEntry({
          path: name,
          size: 0,
          mtime: opts.lastModified,
          mode: DEFAULT_HARDLINK_MODE,
          uid: 0,
          gid: 0,
          typeflag: TYPEFLAG_HARDLINK,
          linkname: opts.target,
          mtimePrecision,
        });
      },
    };

    await callback(archive);

    // End-of-archive marker: 1024 zero bytes.
    await writer.write(new Uint8Array(END_OF_ARCHIVE_SIZE));
    await writer.close();
  };

  // Fire-and-forget the producer; errors propagate through the channel.
  produce().catch((err) => {
    writer.error(err);
  });

  return source;
}
