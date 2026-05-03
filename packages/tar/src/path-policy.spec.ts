import { describe, it, expect } from "vitest";
import { applyPathPolicy, strictReject } from "./path-policy.js";

describe("strict path policy", () => {
  it("accepts ordinary relative paths", () => {
    expect(strictReject("foo/bar.txt")).toBeNull();
    expect(strictReject("a")).toBeNull();
    expect(strictReject("a/b/c")).toBeNull();
    expect(strictReject("..foo")).toBeNull(); // not a parent traversal component
    expect(strictReject("foo..")).toBeNull();
  });

  it("rejects empty name", () => {
    expect(strictReject("")).not.toBeNull();
  });

  it("rejects POSIX absolute paths", () => {
    expect(strictReject("/etc/passwd")).not.toBeNull();
    expect(strictReject("/")).not.toBeNull();
  });

  it("rejects Windows drive paths", () => {
    expect(strictReject("C:Windows")).not.toBeNull();
    expect(strictReject("c:foo")).not.toBeNull();
  });

  it("rejects backslashes", () => {
    expect(strictReject("foo\\bar")).not.toBeNull();
    expect(strictReject("\\\\server\\share")).not.toBeNull();
  });

  it("rejects parent traversal components", () => {
    expect(strictReject("..")).not.toBeNull();
    expect(strictReject("../foo")).not.toBeNull();
    expect(strictReject("foo/..")).not.toBeNull();
    expect(strictReject("a/b/../c")).not.toBeNull();
  });

  it("rejects null bytes", () => {
    expect(strictReject("foo\x00bar")).not.toBeNull();
  });
});

describe("applyPathPolicy", () => {
  it("strict default", () => {
    expect(applyPathPolicy("foo/bar", undefined)).toBe("foo/bar");
    expect(applyPathPolicy("../foo", undefined)).toBeInstanceOf(Error);
  });

  it("permissive passes through", () => {
    expect(applyPathPolicy("/etc/passwd", "permissive")).toBe("/etc/passwd");
    expect(applyPathPolicy("../foo", "permissive")).toBe("../foo");
  });

  it("function form receives the name", () => {
    const policy = (name: string) => name.toLowerCase();
    expect(applyPathPolicy("FOO", policy)).toBe("foo");
  });

  it("function form can return Error", () => {
    const policy = (name: string) =>
      name.startsWith("temp/") ? new Error("temp not allowed") : name;
    expect(applyPathPolicy("temp/x", policy)).toBeInstanceOf(Error);
    expect(applyPathPolicy("foo", policy)).toBe("foo");
  });
});
