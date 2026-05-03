import { describe, it, expect } from "vitest";
import { byteReader, isAllZeros } from "./byte-reader.js";
import { TarCorruptionError } from "./errors.js";

async function* chunks(...arrays: number[][]): AsyncIterable<Uint8Array> {
  for (const arr of arrays) yield new Uint8Array(arr);
}

describe("byteReader", () => {
  it("readExact spanning a chunk boundary", async () => {
    const r = byteReader(chunks([1, 2, 3], [4, 5, 6, 7]));
    expect(Array.from(await r.readExact(5))).toEqual([1, 2, 3, 4, 5]);
    expect(Array.from(await r.readExact(2))).toEqual([6, 7]);
  });

  it("readExact across many small chunks", async () => {
    const r = byteReader(chunks([1], [2], [3], [4], [5]));
    expect(Array.from(await r.readExact(5))).toEqual([1, 2, 3, 4, 5]);
  });

  it("peek does not consume bytes", async () => {
    const r = byteReader(chunks([1, 2, 3, 4]));
    expect(Array.from(await r.peek(2))).toEqual([1, 2]);
    expect(Array.from(await r.peek(3))).toEqual([1, 2, 3]);
    expect(Array.from(await r.readExact(2))).toEqual([1, 2]);
    expect(Array.from(await r.readExact(2))).toEqual([3, 4]);
  });

  it("peek returns short result at EOF", async () => {
    const r = byteReader(chunks([1, 2]));
    expect(Array.from(await r.peek(10))).toEqual([1, 2]);
  });

  it("skip across chunks", async () => {
    const r = byteReader(chunks([1, 2, 3], [4, 5, 6], [7, 8, 9]));
    await r.skip(5);
    expect(Array.from(await r.readExact(2))).toEqual([6, 7]);
  });

  it("readExact throws on EOF", async () => {
    const r = byteReader(chunks([1, 2]));
    await expect(r.readExact(5)).rejects.toThrow(TarCorruptionError);
  });

  it("skip throws on EOF", async () => {
    const r = byteReader(chunks([1, 2]));
    await expect(r.skip(5)).rejects.toThrow(TarCorruptionError);
  });

  it("readExact(0) returns empty", async () => {
    const r = byteReader(chunks([1, 2]));
    expect((await r.readExact(0)).length).toBe(0);
  });

  it("ignores empty chunks from source", async () => {
    const r = byteReader(chunks([], [1, 2], [], [3]));
    expect(Array.from(await r.readExact(3))).toEqual([1, 2, 3]);
  });
});

describe("isAllZeros", () => {
  it("true for empty buffer", () => {
    expect(isAllZeros(new Uint8Array(0))).toBe(true);
  });
  it("true for zero-filled buffer", () => {
    expect(isAllZeros(new Uint8Array(512))).toBe(true);
  });
  it("false on first nonzero byte", () => {
    const buf = new Uint8Array(512);
    buf[0] = 1;
    expect(isAllZeros(buf)).toBe(false);
  });
  it("false on last nonzero byte", () => {
    const buf = new Uint8Array(512);
    buf[511] = 1;
    expect(isAllZeros(buf)).toBe(false);
  });
});
