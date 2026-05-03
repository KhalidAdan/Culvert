import { describe, it, expect } from "vitest";
import {
  computeChecksum,
  encodeUstarHeader,
  fitsInUstar,
  parseUstarHeader,
  parseOctal,
  trySplitPath,
  writeOctal,
} from "./ustar.js";
import { TYPEFLAG_FILE } from "./constants.js";
import { TarCorruptionError } from "./errors.js";

describe("octal field codec", () => {
  it("round-trips zero", () => {
    const buf = new Uint8Array(8);
    writeOctal(buf, 0, 8, 0);
    expect(parseOctal(buf, 0, 8)).toBe(0);
  });

  it("round-trips small values", () => {
    const buf = new Uint8Array(8);
    writeOctal(buf, 0, 8, 0o755);
    expect(parseOctal(buf, 0, 8)).toBe(0o755);
  });

  it("round-trips max value for the field", () => {
    const buf = new Uint8Array(12);
    writeOctal(buf, 0, 12, 0o77777777777);
    expect(parseOctal(buf, 0, 12)).toBe(0o77777777777);
  });

  it("rejects values that overflow the field", () => {
    const buf = new Uint8Array(8);
    expect(() => writeOctal(buf, 0, 8, 0o77777777777)).toThrow(RangeError);
  });

  it("parseOctal tolerates space-terminated values", () => {
    const buf = new Uint8Array([0x37, 0x35, 0x35, 0x20, 0, 0, 0, 0]); // "755 "
    expect(parseOctal(buf, 0, 8)).toBe(0o755);
  });

  it("parseOctal rejects GNU base-256", () => {
    const buf = new Uint8Array(8);
    buf[0] = 0x80;
    expect(() => parseOctal(buf, 0, 8)).toThrow(TarCorruptionError);
  });

  it("parseOctal rejects non-octal digits", () => {
    const buf = new Uint8Array([0x39, 0, 0, 0, 0, 0, 0, 0]); // "9" not octal
    expect(() => parseOctal(buf, 0, 8)).toThrow(TarCorruptionError);
  });
});

describe("header round-trip", () => {
  it("encode + parse recovers fields", () => {
    const header = encodeUstarHeader({
      name: "report.csv",
      mode: 0o644,
      uid: 1000,
      gid: 1000,
      size: 1024,
      mtimeSeconds: 1700000000,
      typeflag: TYPEFLAG_FILE,
    });
    const parsed = parseUstarHeader(header);
    expect(parsed.name).toBe("report.csv");
    expect(parsed.mode).toBe(0o644);
    expect(parsed.uid).toBe(1000);
    expect(parsed.size).toBe(1024);
    expect(parsed.mtimeSeconds).toBe(1700000000);
    expect(parsed.typeflag).toBe("0");
    expect(parsed.magic).toBe("ustar");
    expect(parsed.storedChecksum).toBe(parsed.computedChecksum);
  });

  it("checksum matches after encoding", () => {
    const header = encodeUstarHeader({
      name: "x",
      mode: 0o644,
      uid: 0,
      gid: 0,
      size: 0,
      mtimeSeconds: 0,
      typeflag: "0",
    });
    const parsed = parseUstarHeader(header);
    const recomputed = computeChecksum(header);
    expect(parsed.storedChecksum).toBe(recomputed);
  });
});

describe("path splitting", () => {
  it("short path fits entirely in name field", () => {
    const split = trySplitPath("foo/bar.txt");
    expect(split).toEqual({ name: "foo/bar.txt", prefix: "" });
  });

  it("long path is split at a / boundary", () => {
    const longPath = "a/".repeat(60) + "x.txt"; // 125 bytes total
    const split = trySplitPath(longPath);
    expect(split).not.toBeNull();
    expect(split!.prefix.length).toBeLessThanOrEqual(155);
    expect(split!.name.length).toBeLessThanOrEqual(100);
  });

  it("returns null when no valid split exists", () => {
    // Single component longer than 100 bytes, no slashes.
    const huge = "a".repeat(200);
    expect(trySplitPath(huge)).toBeNull();
  });

  it("multibyte characters count as bytes, not characters", () => {
    // Each "日" is 3 bytes in UTF-8. 34 chars = 102 bytes — overflows
    // the 100-byte name field.
    const path = "日".repeat(34);
    expect(trySplitPath(path)).toBeNull();
  });
});

describe("fitsInUstar", () => {
  it("true for ordinary inputs", () => {
    expect(
      fitsInUstar({ path: "x.txt", size: 100, uid: 0, gid: 0 }),
    ).toBe(true);
  });

  it("false for path that won't split", () => {
    expect(
      fitsInUstar({ path: "a".repeat(200), size: 0, uid: 0, gid: 0 }),
    ).toBe(false);
  });

  it("false for size > 8 GiB", () => {
    expect(
      fitsInUstar({ path: "x", size: 0o100000000000, uid: 0, gid: 0 }),
    ).toBe(false);
  });

  it("false for uid > 2M", () => {
    expect(
      fitsInUstar({ path: "x", size: 0, uid: 0o10000000, gid: 0 }),
    ).toBe(false);
  });

  it("false for long symlink target", () => {
    expect(
      fitsInUstar({
        path: "x",
        size: 0,
        uid: 0,
        gid: 0,
        linkname: "a".repeat(200),
      }),
    ).toBe(false);
  });
});
