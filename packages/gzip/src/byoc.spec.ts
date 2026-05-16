import { describe, it, expect } from "vitest";
import { gzipWith, gunzipWith } from "./index.js";
import { deflateRaw, inflateRaw } from "./deflate.js";
import { pipe, collectBytes, from } from "@culvert/stream";
import type { Transform } from "@culvert/stream";

describe("BYOC (bring your own compressor)", () => {
  it("round-trips with explicit deflateRaw/inflateRaw", async () => {
    const input = new TextEncoder().encode("BYOC test");

    const compressed = await pipe(
      from([input]),
      gzipWith({ compress: deflateRaw() }),
      collectBytes(),
    );

    const decompressed = await pipe(
      from([compressed]),
      gunzipWith({ decompress: inflateRaw() }),
      collectBytes(),
    );

    expect(decompressed).toEqual(input);
  });

  it("CRC is computed on uncompressed data regardless of compressor", async () => {
    const input = new TextEncoder().encode("CRC check");

    // Use an identity "compressor" — no actual compression
    const identity: Transform<Uint8Array, Uint8Array> = async function* (
      source,
    ) {
      for await (const chunk of source) yield chunk;
    };

    const compressed = await pipe(
      from([input]),
      gzipWith({ compress: identity }),
      collectBytes(),
    );

    // Decompressing with the same identity "decompressor" should work
    // and CRC should validate
    const decompressed = await pipe(
      from([compressed]),
      gunzipWith({ decompress: identity }),
      collectBytes(),
    );

    expect(decompressed).toEqual(input);
  });
});
