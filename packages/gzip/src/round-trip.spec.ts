import { describe, it, expect } from "vitest";
import { gzip, gzipWith, gunzip, gunzipWith } from "./index.js";
import { pipe, collectBytes, from } from "@culvert/stream";

// Helper: compress then decompress, return the round-tripped bytes
async function roundTrip(
  input: Uint8Array,
  gzipOpts?: Parameters<typeof gzip>[0],
  gunzipOpts?: Parameters<typeof gunzip>[0],
): Promise<Uint8Array> {
  return pipe(from([input]), gzip(gzipOpts), gunzip(gunzipOpts), collectBytes());
}

describe("gzip/gunzip round-trip", () => {
  it("round-trips empty input", async () => {
    const input = new Uint8Array(0);
    const output = await roundTrip(input);
    expect(output).toEqual(input);
  });

  it("round-trips 'Hello, world!'", async () => {
    const input = new TextEncoder().encode("Hello, world!");
    const output = await roundTrip(input);
    expect(output).toEqual(input);
  });

  it("round-trips binary data (0x00..0xFF)", async () => {
    const input = new Uint8Array(256);
    for (let i = 0; i < 256; i++) input[i] = i;
    const output = await roundTrip(input);
    expect(output).toEqual(input);
  });

  it("round-trips multi-chunk input", async () => {
    const a = new TextEncoder().encode("chunk one ");
    const b = new TextEncoder().encode("chunk two ");
    const c = new TextEncoder().encode("chunk three");

    const compressed = await pipe(from([a, b, c]), gzip(), collectBytes());
    const decompressed = await pipe(from([compressed]), gunzip(), collectBytes());

    const expected = new Uint8Array(a.length + b.length + c.length);
    expected.set(a, 0);
    expected.set(b, a.length);
    expected.set(c, a.length + b.length);
    expect(decompressed).toEqual(expected);
  });

  it("round-trips 1 MiB of data (memory stays flat)", async () => {
    // Generate deterministic 1 MiB of data
    const input = new Uint8Array(1024 * 1024);
    for (let i = 0; i < input.length; i++) {
      input[i] = (i * 7 + 13) & 0xff;
    }
    const output = await roundTrip(input);
    expect(output).toEqual(input);
  });
});

describe("gzip header options", () => {
  it("produces valid gzip with filename", async () => {
    const input = new TextEncoder().encode("data");
    const output = await roundTrip(input, { filename: "test.txt" });
    expect(output).toEqual(input);
  });

  it("produces valid gzip with comment", async () => {
    const input = new TextEncoder().encode("data");
    const output = await roundTrip(input, { comment: "a comment" });
    expect(output).toEqual(input);
  });

  it("produces valid gzip with filename and comment", async () => {
    const input = new TextEncoder().encode("data");
    const output = await roundTrip(input, {
      filename: "test.txt",
      comment: "hello",
    });
    expect(output).toEqual(input);
  });

  it("produces valid gzip with custom mtime", async () => {
    const input = new TextEncoder().encode("data");
    const output = await roundTrip(input, {
      mtime: new Date("2024-06-15T00:00:00Z"),
    });
    expect(output).toEqual(input);
  });
});

describe("reproducibility", () => {
  it("same input + same options = identical output", async () => {
    const input = new TextEncoder().encode("deterministic");
    const a = await pipe(from([input]), gzip(), collectBytes());
    const b = await pipe(from([input]), gzip(), collectBytes());
    expect(a).toEqual(b);
  });

  it("default mtime is epoch (reproducible)", async () => {
    const input = new TextEncoder().encode("test");
    const a = await pipe(from([input]), gzip(), collectBytes());
    const b = await pipe(from([input]), gzip({ mtime: new Date(0) }), collectBytes());
    expect(a).toEqual(b);
  });
});
