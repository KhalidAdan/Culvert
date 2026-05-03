import { describe, it, expect } from "vitest";
import {
  buildPaxExtendedHeader,
  formatPaxRecord,
  formatPaxRecords,
  parsePaxRecords,
  PaxState,
} from "./pax.js";
import { TarCorruptionError } from "./errors.js";

describe("PAX record format", () => {
  it("formats a simple record with correct length", () => {
    // "27 mtime=1700000000.123456\n" — 27 bytes total
    const buf = formatPaxRecord("mtime", "1700000000.123456");
    expect(new TextDecoder().decode(buf)).toBe("27 mtime=1700000000.123456\n");
    expect(buf.length).toBe(27);
  });

  it("formats with multibyte UTF-8 in value", () => {
    const buf = formatPaxRecord("path", "日本/file");
    const text = new TextDecoder().decode(buf);
    const lengthStr = text.split(" ")[0];
    expect(parseInt(lengthStr!, 10)).toBe(buf.length);
  });

  it("round-trips records through parse + format", () => {
    const original = new Map([
      ["path", "long/path/to/file"],
      ["mtime", "1700000000.5"],
      ["size", "12345678901"],
    ]);
    const buf = formatPaxRecords(original);
    const parsed = parsePaxRecords(buf);
    expect(parsed).toEqual(original);
  });

  it("parses a value containing =", () => {
    const buf = formatPaxRecord("comment", "key=value=more");
    const parsed = parsePaxRecords(buf);
    expect(parsed.get("comment")).toBe("key=value=more");
  });

  it("parses an empty value (used to clear in 'g' headers)", () => {
    const buf = formatPaxRecord("path", "");
    const parsed = parsePaxRecords(buf);
    expect(parsed.has("path")).toBe(true);
    expect(parsed.get("path")).toBe("");
  });
});

describe("PAX record errors", () => {
  it("rejects missing length prefix", () => {
    const buf = new TextEncoder().encode("path=foo\n");
    expect(() => parsePaxRecords(buf)).toThrow(TarCorruptionError);
  });

  it("rejects mismatched length", () => {
    const buf = new TextEncoder().encode("99 path=foo\n");
    expect(() => parsePaxRecords(buf)).toThrow(TarCorruptionError);
  });

  it("rejects record without trailing newline", () => {
    // 9 bytes, but last byte is not \n
    const buf = new TextEncoder().encode("9 path=fX");
    expect(() => parsePaxRecords(buf)).toThrow(TarCorruptionError);
  });

  it("rejects record without =", () => {
    // "8 pathfoo\n" — 10 bytes (length should be 10, but no '=')
    const buf = new TextEncoder().encode("10 pathfoo\n");
    expect(() => parsePaxRecords(buf)).toThrow(TarCorruptionError);
  });

  it("rejects non-UTF-8 charset declaration", () => {
    const buf = formatPaxRecord("charset", "ISO-8859-1");
    expect(() => parsePaxRecords(buf)).toThrow(TarCorruptionError);
  });

  it("accepts UTF-8 charset declaration", () => {
    const buf = formatPaxRecord("charset", "ISO-IR 10646 2000 UTF-8");
    expect(() => parsePaxRecords(buf)).not.toThrow();
  });
});

describe("PaxState merge semantics", () => {
  it("pending overrides global", () => {
    const state = new PaxState();
    state.applyGlobal(new Map([["path", "global-path"]]));
    state.applyPending(new Map([["path", "pending-path"]]));
    expect(state.get("path")).toBe("pending-path");
  });

  it("global persists across consumePending", () => {
    const state = new PaxState();
    state.applyGlobal(new Map([["uid", "1000"]]));
    state.applyPending(new Map([["path", "x"]]));
    state.consumePending();
    expect(state.get("uid")).toBe("1000");
    expect(state.get("path")).toBeUndefined();
  });

  it("'g' empty value clears the key", () => {
    const state = new PaxState();
    state.applyGlobal(new Map([["uid", "1000"]]));
    state.applyGlobal(new Map([["uid", ""]]));
    expect(state.get("uid")).toBeUndefined();
  });

  it("'g' overrides previous 'g' for nonempty values", () => {
    const state = new PaxState();
    state.applyGlobal(new Map([["uid", "1000"]]));
    state.applyGlobal(new Map([["uid", "2000"]]));
    expect(state.get("uid")).toBe("2000");
  });
});

describe("buildPaxExtendedHeader", () => {
  it("output is BLOCK_SIZE-aligned", () => {
    const buf = buildPaxExtendedHeader(new Map([["path", "x"]]));
    expect(buf.length % 512).toBe(0);
    expect(buf.length).toBeGreaterThanOrEqual(1024); // header + at least one data block
  });

  it("sets typeflag 'x'", () => {
    const buf = buildPaxExtendedHeader(new Map([["path", "x"]]));
    expect(String.fromCharCode(buf[156]!)).toBe("x");
  });
});
