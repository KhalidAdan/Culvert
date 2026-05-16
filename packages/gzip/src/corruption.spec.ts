import { describe, it, expect } from "vitest";
import { gzip, gunzip } from "./index.js";
import { pipe, collectBytes, from } from "@culvert/stream";
import { GzipCorruptionError } from "./errors.js";
import { HEADER_SIZE, FOOTER_SIZE, GZIP_ID1, GZIP_ID2 } from "./constants.js";

describe("corruption detection (strict)", () => {
  it("throws on bad magic bytes", async () => {
    const bad = new Uint8Array([0x00, 0x00, 0x08, 0x00, 0, 0, 0, 0, 0, 0xff]);
    await expect(pipe(from([bad]), gunzip(), collectBytes())).rejects.toThrow(
      GzipCorruptionError,
    );
  });

  it("throws on truncated header", async () => {
    const truncated = new Uint8Array([GZIP_ID1, GZIP_ID2, 0x08]);
    await expect(pipe(from([truncated]), gunzip(), collectBytes())).rejects.toThrow(
      GzipCorruptionError,
    );
  });

  it("throws on bad compression method", async () => {
    const bad = new Uint8Array(HEADER_SIZE);
    bad[0] = GZIP_ID1;
    bad[1] = GZIP_ID2;
    bad[2] = 99; // not DEFLATE
    await expect(pipe(from([bad]), gunzip(), collectBytes())).rejects.toThrow(
      GzipCorruptionError,
    );
  });

  it("throws on CRC mismatch", async () => {
    const input = new TextEncoder().encode("hello");
    const compressed = await pipe(from([input]), gzip(), collectBytes());

    // Corrupt the CRC in the footer (last 8 bytes, first 4 are CRC)
    const corrupted = new Uint8Array(compressed);
    corrupted[corrupted.length - FOOTER_SIZE] ^= 0xff;

    await expect(pipe(from([corrupted]), gunzip(), collectBytes())).rejects.toThrow(
      GzipCorruptionError,
    );
  });

  it("throws on ISIZE mismatch", async () => {
    const input = new TextEncoder().encode("hello");
    const compressed = await pipe(from([input]), gzip(), collectBytes());

    // Corrupt the ISIZE (last 4 bytes of footer)
    const corrupted = new Uint8Array(compressed);
    corrupted[corrupted.length - 4] ^= 0xff;

    await expect(pipe(from([corrupted]), gunzip(), collectBytes())).rejects.toThrow(
      GzipCorruptionError,
    );
  });
});
