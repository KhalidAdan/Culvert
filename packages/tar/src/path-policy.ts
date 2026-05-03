import type { PathPolicy } from "./types.js";

// ---------------------------------------------------------------------------
// Strict path validation
//
// Rejects any name that could be hostile in extraction. The check runs
// AFTER PAX 'path' merging — never on the raw ustar name.
//
// Returns null if accepted, or an error message string if rejected.
// ---------------------------------------------------------------------------

export function strictReject(name: string): string | null {
  if (name.length === 0) {
    return "empty name";
  }

  // Null bytes — used in path-truncation attacks.
  if (name.includes("\x00")) {
    return "name contains null byte";
  }

  // Backslashes — Windows path separators that POSIX systems treat as
  // ordinary characters. We don't know where the archive will be
  // extracted, so reject them universally.
  if (name.includes("\\")) {
    return "name contains backslash";
  }

  // POSIX absolute path.
  if (name.startsWith("/")) {
    return "absolute POSIX path";
  }

  // Windows drive-relative or UNC.
  // - "C:..." (drive letter + colon)
  // - "\\\\server" (UNC) — already covered by backslash check, but explicit
  if (/^[A-Za-z]:/.test(name)) {
    return "Windows drive path";
  }

  // Parent traversal — check component-wise. A name like "..foo" is OK,
  // but "foo/.." or "../foo" or "a/../b" is not.
  const components = name.split("/");
  for (const c of components) {
    if (c === "..") {
      return "parent-directory traversal component";
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Apply a PathPolicy to a name.
//
// Returns the (possibly transformed) name to use, or an Error to
// signal that this entry should be rejected.
//
// 'strict'    : strictReject + Error if rejected
// 'permissive': always pass through unchanged
// function    : caller-defined
// ---------------------------------------------------------------------------

export function applyPathPolicy(name: string, policy: PathPolicy | undefined): string | Error {
  if (policy === undefined || policy === "strict") {
    const reason = strictReject(name);
    if (reason !== null) {
      return new Error(`Path rejected by strict policy: ${reason} (name=${JSON.stringify(name)})`);
    }
    return name;
  }
  if (policy === "permissive") {
    return name;
  }
  // Function form.
  return policy(name);
}
