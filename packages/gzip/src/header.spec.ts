import { describe, it, expect } from "vitest";
import {
  buildGzipHeader,
  buildGzipFooter,
  parseFixedHeader,
  readUint32LE,
} from "./header.js";
import {
  GZIP_ID1,
  GZIP_ID2,
  CM_DEFLATE,
  OS_UNKNOWN,
  XFL_DEFAULT,
  HEADER_SIZE,
} from "./constants.js";
import { GzipCorruptionError } from "./errors.js";

describe("buildGzipHeader", () => {
  it("builds a minimal header (no optional fields)", () => {
    const header = buildGzipHeader({ mtime: new Date(0) });
    expect(header.length).toBe(HEADER_SIZE);
    expect(header[0]).toBe(GZIP_ID1);
    expect(header[1]).toBe(GZIP_ID2);
    expect(header[2]).toBe(CM_DEFLATE);
    expect(header[3]).toBe(0); // FLG = no optional fields
    expect(readUint32LE(header, 4)).toBe(0); // MTIME = epoch
    expect(header[8]).toBe(XFL_DEFAULT);
    expect(header[9]).toBe(OS_UNKNOWN);
  });

  it("includes FNAME when filename is provided", () => {
    const header = buildGzipHeader({
      mtime: new Date(0),
      filename: "test.txt",
    });
    expect(header.length).toBe(HEADER_SIZE + 8 + 1); // "test.txt" + null
    expect(header[3]! & 0x08).toBe(0x08); // FNAME bit set
    // Filename bytes start at offset 10
    const fnameBytes = header.slice(HEADER_SIZE, HEADER_SIZE + 8);
    expect(new TextDecoder().decode(fnameBytes)).toBe("test.txt");
    expect(header[HEADER_SIZE + 8]).toBe(0x00); // null terminator
  });

  it("includes FCOMMENT when comment is provided", () => {
    const header = buildGzipHeader({
      mtime: new Date(0),
      comment: "hi",
    });
    expect(header[3]! & 0x10).toBe(0x10); // FCOMMENT bit set
    expect(header.length).toBe(HEADER_SIZE + 2 + 1); // "hi" + null
  });

  it("includes both FNAME and FCOMMENT", () => {
    const header = buildGzipHeader({
      mtime: new Date(0),
      filename: "a",
      comment: "b",
    });
    expect(header[3]! & 0x08).toBe(0x08); // FNAME
    expect(header[3]! & 0x10).toBe(0x10); // FCOMMENT
    // FNAME comes first per RFC 1952 order
    expect(header[HEADER_SIZE]).toBe(0x61); // 'a'
    expect(header[HEADER_SIZE + 1]).toBe(0x00); // null
    expect(header[HEADER_SIZE + 2]).toBe(0x62); // 'b'
    expect(header[HEADER_SIZE + 3]).toBe(0x00); // null
  });

  it("drops non-Latin-1 characters from filename", () => {
    const header = buildGzipHeader({
      mtime: new Date(0),
      filename: "日本語.txt",
    });
    // Japanese characters are dropped; only ".txt" survives
    expect(header[3]! & 0x08).toBe(0x08);
    // The exact remaining bytes depend on which chars survive Latin-1
  });

  it("encodes MTIME from Date", () => {
    const date = new Date("2024-01-15T12:00:00Z");
    const header = buildGzipHeader({ mtime: date });
    const mtime = readUint32LE(header, 4);
    expect(mtime).toBe(Math.floor(date.getTime() / 1000));
  });
});

describe("buildGzipFooter", () => {
  it("writes CRC and ISIZE as uint32 LE", () => {
    const footer = buildGzipFooter(0xcbf43926, 9);
    expect(readUint32LE(footer, 0)).toBe(0xcbf43926);
    expect(readUint32LE(footer, 4)).toBe(9);
  });

  it("wraps ISIZE mod 2^32", () => {
    const bigSize = 0x100000000 + 42; // 4 GiB + 42
    const footer = buildGzipFooter(0, bigSize);
    expect(readUint32LE(footer, 4)).toBe(42);
  });
});

describe("parseFixedHeader", () => {
  it("parses a valid minimal header", () => {
    const header = buildGzipHeader({ mtime: new Date(0) });
    const parsed = parseFixedHeader(header);
    expect(parsed.flg).toBe(0);
    expect(parsed.mtime).toBe(0);
    expect(parsed.xfl).toBe(XFL_DEFAULT);
    expect(parsed.os).toBe(OS_UNKNOWN);
  });

  it("throws on bad magic bytes", () => {
    const bad = new Uint8Array(HEADER_SIZE);
    bad[0] = 0x00;
    bad[1] = 0x00;
    expect(() => parseFixedHeader(bad)).toThrow(GzipCorruptionError);
  });

  it("throws on unsupported compression method", () => {
    const bad = buildGzipHeader({ mtime: new Date(0) });
    bad[2] = 99; // not DEFLATE
    expect(() => parseFixedHeader(bad)).toThrow(GzipCorruptionError);
  });

  it("throws on truncated header", () => {
    expect(() => parseFixedHeader(new Uint8Array(5))).toThrow(
      GzipCorruptionError,
    );
  });

  it("throws on reserved FLG bits", () => {
    const bad = buildGzipHeader({ mtime: new Date(0) });
    bad[3] = 0b11100000; // reserved bits set
    expect(() => parseFixedHeader(bad)).toThrow(GzipCorruptionError);
  });
});
