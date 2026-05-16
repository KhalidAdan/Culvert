import { describe, it, expect } from "vitest";
import { deflateRaw, inflateRaw } from "./index.js";
import { pipe, collectBytes, from } from "@culvert/stream";

describe("deflateRaw / inflateRaw", () => {
  it("round-trips a buffer", async () => {
    const input = new TextEncoder().encode("Hello, DEFLATE bridge!");

    const compressed = await pipe(from([input]), deflateRaw(), collectBytes());
    expect(compressed.length).toBeGreaterThan(0);
    expect(compressed.length).not.toBe(input.length); // should differ

    const decompressed = await pipe(from([compressed]), inflateRaw(), collectBytes());
    expect(decompressed).toEqual(input);
  });

  it("round-trips empty input", async () => {
    const input = new Uint8Array(0);
    const compressed = await pipe(from([input]), deflateRaw(), collectBytes());
    const decompressed = await pipe(from([compressed]), inflateRaw(), collectBytes());
    expect(decompressed).toEqual(input);
  });

  it("round-trips multi-chunk input", async () => {
    const a = new TextEncoder().encode("chunk one ");
    const b = new TextEncoder().encode("chunk two ");
    const c = new TextEncoder().encode("chunk three");

    const compressed = await pipe(from([a, b, c]), deflateRaw(), collectBytes());
    const decompressed = await pipe(from([compressed]), inflateRaw(), collectBytes());

    const expected = new Uint8Array(a.length + b.length + c.length);
    expected.set(a, 0);
    expected.set(b, a.length);
    expected.set(c, a.length + b.length);
    expect(decompressed).toEqual(expected);
  });
});
