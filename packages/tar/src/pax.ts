import {
  BLOCK_SIZE,
  PAX_KEY_CHARSET,
  PAX_KEY_HDRCHARSET,
  TYPEFLAG_PAX_EXTENDED,
} from "./constants.js";
import { TarCorruptionError } from "./errors.js";
import { encodeUstarHeader } from "./ustar.js";

const decoder = new TextDecoder("utf-8", { fatal: true });
const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Record parsing
//
// Format (one record): "<length> <key>=<value>\n"
//   - <length> is decimal ASCII, total bytes of the record including
//     the length, the space, the key, the =, the value, and the \n.
//   - The data section contains zero or more such records concatenated.
//
// We tolerate:
//   - Empty values (key=) — semantically meaningful, used by 'g' to clear
//   - Values containing = signs (only the first = is the separator)
//   - UTF-8 in keys and values
//
// We reject:
//   - Length prefix that doesn't match the actual record bytes
//   - Records that don't end with \n
//   - Non-UTF-8 charset declarations
// ---------------------------------------------------------------------------

export function parsePaxRecords(data: Uint8Array): Map<string, string> {
  const result = new Map<string, string>();
  let pos = 0;

  while (pos < data.length) {
    // Find the space after the length prefix.
    let spaceAt = -1;
    for (let i = pos; i < data.length && i < pos + 16; i++) {
      if (data[i] === 0x20) {
        spaceAt = i;
        break;
      }
    }
    if (spaceAt === -1) {
      throw new TarCorruptionError(
        `PAX record at byte ${pos} has no length prefix`,
      );
    }

    // Parse the length prefix (decimal ASCII).
    let length = 0;
    for (let i = pos; i < spaceAt; i++) {
      const c = data[i]!;
      if (c < 0x30 || c > 0x39) {
        throw new TarCorruptionError(
          `Invalid digit in PAX length prefix at byte ${i}: 0x${c.toString(16)}`,
        );
      }
      length = length * 10 + (c - 0x30);
    }

    if (length === 0) {
      throw new TarCorruptionError(`PAX record at byte ${pos} has zero length`);
    }
    if (pos + length > data.length) {
      throw new TarCorruptionError(
        `PAX record at byte ${pos} declares length ${length} but only ` +
          `${data.length - pos} bytes remain`,
      );
    }
    if (data[pos + length - 1] !== 0x0a) {
      throw new TarCorruptionError(
        `PAX record at byte ${pos} does not end with \\n`,
      );
    }

    // The "key=value" portion is between the space and the trailing \n.
    const kvStart = spaceAt + 1;
    const kvEnd = pos + length - 1;
    const kvBytes = data.subarray(kvStart, kvEnd);

    // Find the first '=' (rest of value can contain '=').
    let eqAt = -1;
    for (let i = 0; i < kvBytes.length; i++) {
      if (kvBytes[i] === 0x3d) {
        eqAt = i;
        break;
      }
    }
    if (eqAt === -1) {
      throw new TarCorruptionError(
        `PAX record at byte ${pos} has no '=' separator`,
      );
    }
    if (eqAt === 0) {
      throw new TarCorruptionError(
        `PAX record at byte ${pos} has empty key`,
      );
    }

    let key: string;
    let value: string;
    try {
      key = decoder.decode(kvBytes.subarray(0, eqAt));
      value = decoder.decode(kvBytes.subarray(eqAt + 1));
    } catch (err) {
      throw new TarCorruptionError(
        `PAX record at byte ${pos} contains invalid UTF-8`,
      );
    }

    // Reject non-UTF-8 charset declarations.
    if (key === PAX_KEY_CHARSET || key === PAX_KEY_HDRCHARSET) {
      const upper = value.toUpperCase();
      if (upper !== "" && upper !== "ISO-IR 10646 2000 UTF-8" && upper !== "UTF-8") {
        throw new TarCorruptionError(
          `Non-UTF-8 charset in PAX records is not supported: "${value}"`,
        );
      }
    }

    result.set(key, value);
    pos += length;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Record formatting
//
// Building a record requires solving for the length self-referentially:
// the length prefix is part of the count. We compute it as a fixed point.
// ---------------------------------------------------------------------------

export function formatPaxRecord(key: string, value: string): Uint8Array {
  const keyBytes = encoder.encode(key);
  const valueBytes = encoder.encode(value);
  // Tail bytes: " " + key + "=" + value + "\n"
  const tail = 1 + keyBytes.length + 1 + valueBytes.length + 1;

  // Find the smallest integer L such that:
  //   digits(L) + tail = L
  // Iterate: each time digits grow, tail grows, length may change.
  let digits = 1;
  let length = digits + tail;
  while (length.toString().length !== digits) {
    digits = length.toString().length;
    length = digits + tail;
  }

  const out = new Uint8Array(length);
  const lengthStr = length.toString();
  let p = 0;
  for (let i = 0; i < lengthStr.length; i++) {
    out[p++] = lengthStr.charCodeAt(i);
  }
  out[p++] = 0x20; // space
  out.set(keyBytes, p);
  p += keyBytes.length;
  out[p++] = 0x3d; // =
  out.set(valueBytes, p);
  p += valueBytes.length;
  out[p++] = 0x0a; // newline
  return out;
}

/**
 * Concatenate a list of records into a single PAX data section.
 */
export function formatPaxRecords(records: Iterable<[string, string]>): Uint8Array {
  const buffers: Uint8Array[] = [];
  let total = 0;
  for (const [key, value] of records) {
    const buf = formatPaxRecord(key, value);
    buffers.push(buf);
    total += buf.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const buf of buffers) {
    out.set(buf, offset);
    offset += buf.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// PaxState — merged-metadata bookkeeping for the reader
//
// global  : accumulated from 'g' headers, persists until updated.
// pending : from the immediately preceding 'x' header, cleared after
//           the next regular entry is yielded.
//
// Per-spec, an empty value in a 'g' record clears the key from the
// global set.
// ---------------------------------------------------------------------------

export class PaxState {
  global = new Map<string, string>();
  pending = new Map<string, string>();

  /** Apply a 'g' header's records: merge into global, empty values clear. */
  applyGlobal(records: Map<string, string>): void {
    for (const [key, value] of records) {
      if (value === "") {
        this.global.delete(key);
      } else {
        this.global.set(key, value);
      }
    }
  }

  /** Apply an 'x' header's records: replace pending wholesale. */
  applyPending(records: Map<string, string>): void {
    this.pending = records;
  }

  /**
   * Look up a key, with precedence: pending > global > undefined.
   */
  get(key: string): string | undefined {
    return this.pending.get(key) ?? this.global.get(key);
  }

  /** Clear pending records — call after yielding the entry that consumed them. */
  consumePending(): void {
    this.pending = new Map();
  }
}

// ---------------------------------------------------------------------------
// Writer-side: emit a PAX 'x' extended header for a single entry.
//
// Returns the bytes (header + data, padded to BLOCK_SIZE alignment)
// that should precede the regular entry's header in the output stream.
// ---------------------------------------------------------------------------

export function buildPaxExtendedHeader(records: Map<string, string>): Uint8Array {
  const recordsBytes = formatPaxRecords(records);

  // Write a ustar header for the PAX entry. Conventional name is
  // "PaxHeaders/<n>" but readers ignore it; we use a minimal placeholder.
  const header = encodeUstarHeader({
    name: "PaxHeader",
    mode: 0o644,
    uid: 0,
    gid: 0,
    size: recordsBytes.length,
    mtimeSeconds: 0,
    typeflag: TYPEFLAG_PAX_EXTENDED,
  });

  // Pad records section to the next BLOCK_SIZE boundary.
  const paddedDataLength = Math.ceil(recordsBytes.length / BLOCK_SIZE) * BLOCK_SIZE;
  const out = new Uint8Array(BLOCK_SIZE + paddedDataLength);
  out.set(header, 0);
  out.set(recordsBytes, BLOCK_SIZE);
  // Padding bytes remain zero.
  return out;
}
