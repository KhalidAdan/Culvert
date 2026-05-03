import { describe, it, expect } from "vitest";
import { collectBytes, from, of, pipe } from "@culvert/stream";
import { createTar, EPOCH } from "./writer.js";
import { readTarEntries } from "./reader.js";

/**
 * Regression test for a UTF-8 multibyte truncation bug in the writer.
 *
 * When a path or linkname overflows the ustar field (100 bytes for name,
 * 100 bytes for linkname), the writer used to truncate the raw bytes at
 * the field length, decode the truncated bytes with TextDecoder (which
 * inserts U+FFFD replacement characters for incomplete sequences), then
 * re-encode the string with TextEncoder for writeString().
 *
 * The problem: U+FFFD encodes to 3 bytes in UTF-8, so the re-encoded
 * result could exceed the field limit, causing writeString() to throw
 * RangeError.
 *
 * Example: "a".repeat(99) + "日" is 102 bytes. Truncated to 100 bytes,
 * the 3-byte "日" sequence is cut, producing an incomplete sequence.
 * Decoding produces "a" x 99 + "\uFFFD" (100 chars, but 102 bytes
 * re-encoded). writeString then throws because 102 > 100.
 */

describe("writer UTF-8 truncation at field boundary", () => {
  it("symlink with multibyte char at byte 100 does not throw", async () => {
    // 99 ASCII 'a' + 3-byte "日" = 102 bytes total.
    // Byte 100 falls in the middle of the 3-byte "日" sequence.
    const target = "a".repeat(99) + "日";

    const bytes = await pipe(
      createTar(async (a) => {
        await a.addSymlink({
          name: "link",
          target,
          lastModified: EPOCH,
        });
      }, { pathPolicy: "permissive" }),
      collectBytes(),
    );

    // Round-trip: reader should recover the full target via PAX.
    let recoveredTarget: string | null = null;
    for await (const e of readTarEntries(from([bytes]))) {
      if (e.kind === "symlink") {
        recoveredTarget = e.target;
      }
    }
    expect(recoveredTarget).toBe(target);
  });

  it("file path with multibyte char at byte 100 does not throw", async () => {
    // Path with no slashes, 98 ASCII 'a' + 3-byte "日" = 101 bytes.
    // Doesn't fit in 100-byte name field, no valid prefix split.
    const path = "a".repeat(98) + "日";

    const bytes = await pipe(
      createTar(async (a) => {
        await a.addFile({
          name: path,
          source: of(new Uint8Array(0)),
          size: 0,
          lastModified: EPOCH,
        });
      }, { pathPolicy: "permissive" }),
      collectBytes(),
    );

    // Round-trip: reader should recover the full path via PAX.
    let recoveredPath: string | null = null;
    for await (const e of readTarEntries(from([bytes]))) {
      if (e.kind === "file") {
        recoveredPath = e.name;
      }
    }
    expect(recoveredPath).toBe(path);
  });
});
