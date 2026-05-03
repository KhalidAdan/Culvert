import { describe, it, expect } from "vitest";
import { collectBytes, from, of, pipe } from "@culvert/stream";
import { createTar, EPOCH } from "./writer.js";
import { readTarEntries } from "./reader.js";
import type { TarEntry, TarFileEntry } from "./types.js";
import { encodeUstarHeader } from "./ustar.js";
import { BLOCK_SIZE, END_OF_ARCHIVE_SIZE, TYPEFLAG_CONTIGUOUS } from "./constants.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesOf(s: string): Uint8Array {
  return encoder.encode(s);
}

async function archiveBytes(
  build: (archive: import("./types.js").TarArchive) => Promise<void>,
): Promise<Uint8Array> {
  return await pipe(createTar(build), collectBytes());
}

async function readAll(bytes: Uint8Array): Promise<TarEntry[]> {
  const out: TarEntry[] = [];
  for await (const entry of readTarEntries(from([bytes]))) {
    if (entry.kind === "file") {
      // Drain so the iterator can advance.
      const data = await pipe(entry.source, collectBytes());
      out.push({ ...entry, source: from([data]) }); // store consumed
      // Stash the consumed bytes for assertion.
      (entry as any)._bytes = data;
      out[out.length - 1] = entry;
    } else {
      out.push(entry);
    }
  }
  return out;
}

describe("round-trip: single small file", () => {
  it("write then read recovers content", async () => {
    const data = bytesOf("hello, world");
    const bytes = await archiveBytes(async (a) => {
      await a.addFile({
        name: "hello.txt",
        source: of(data),
        size: data.length,
        lastModified: EPOCH,
      });
    });

    const entries: TarEntry[] = [];
    for await (const e of readTarEntries(from([bytes]))) {
      if (e.kind === "file") {
        const got = await pipe(e.source, collectBytes());
        expect(decoder.decode(got)).toBe("hello, world");
      }
      entries.push(e);
    }
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe("file");
    expect(entries[0]!.name).toBe("hello.txt");
  });
});

describe("round-trip: multiple entries of mixed kinds", () => {
  it("file, directory, symlink, hardlink all round-trip", async () => {
    const fileData = bytesOf("contents");
    const bytes = await archiveBytes(async (a) => {
      await a.addDirectory({ name: "src/", lastModified: EPOCH });
      await a.addFile({
        name: "src/hello.txt",
        source: of(fileData),
        size: fileData.length,
        lastModified: EPOCH,
      });
      await a.addSymlink({
        name: "src/latest",
        target: "hello.txt",
        lastModified: EPOCH,
      });
      await a.addHardLink({
        name: "src/copy",
        target: "src/hello.txt",
        lastModified: EPOCH,
      });
    });

    const seen: Array<{ kind: string; name: string }> = [];
    for await (const e of readTarEntries(from([bytes]))) {
      seen.push({ kind: e.kind, name: e.name });
      if (e.kind === "file") {
        await pipe(e.source, collectBytes());
      }
    }
    expect(seen).toEqual([
      { kind: "directory", name: "src/" },
      { kind: "file", name: "src/hello.txt" },
      { kind: "symlink", name: "src/latest" },
      { kind: "hardlink", name: "src/copy" },
    ]);
  });
});

describe("round-trip: contiguous file (typeflag '7')", () => {
  it("reader surfaces contiguous as kind 'file' per POSIX", async () => {
    const data = bytesOf("contiguous-data");
    const header = encodeUstarHeader({
      name: "contiguous.bin",
      mode: 0o644,
      uid: 0,
      gid: 0,
      size: data.length,
      mtimeSeconds: 0,
      typeflag: TYPEFLAG_CONTIGUOUS,
    });
    const pad = new Uint8Array(BLOCK_SIZE - (data.length % BLOCK_SIZE));
    const archive = new Uint8Array(
      header.length + data.length + pad.length + END_OF_ARCHIVE_SIZE,
    );
    archive.set(header, 0);
    archive.set(data, header.length);
    archive.set(pad, header.length + data.length);
    // end-of-archive zeros are already zero

    const entries: TarEntry[] = [];
    for await (const e of readTarEntries(from([archive]))) {
      entries.push(e);
      if (e.kind === "file") {
        await pipe(e.source, collectBytes());
      }
    }
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe("file");
    expect(entries[0]!.name).toBe("contiguous.bin");
  });
});

describe("round-trip: PAX long path", () => {
  it("long name triggers PAX, reader recovers full name", async () => {
    const longName = "deep/" + "a/".repeat(60) + "file.txt"; // ~130+ bytes
    const bytes = await archiveBytes(async (a) => {
      await a.addFile({
        name: longName,
        source: of(new Uint8Array(0)),
        size: 0,
        lastModified: EPOCH,
      });
    });

    let recovered: string | null = null;
    for await (const e of readTarEntries(from([bytes]))) {
      if (e.kind === "file") {
        recovered = e.name;
        await pipe(e.source, collectBytes());
      }
    }
    expect(recovered).toBe(longName);
  });
});

describe("round-trip: subsecond mtime", () => {
  it("default 'seconds' truncates", async () => {
    const t = new Date(1700000000123); // 1700000000.123 seconds
    const bytes = await archiveBytes(async (a) => {
      await a.addFile({
        name: "x",
        source: of(new Uint8Array(0)),
        size: 0,
        lastModified: t,
      });
    });
    for await (const e of readTarEntries(from([bytes]))) {
      expect(e.lastModified.getTime()).toBe(1700000000000);
      if (e.kind === "file") await pipe(e.source, collectBytes());
    }
  });

  it("'subsecond' preserves milliseconds", async () => {
    const t = new Date(1700000000123);
    const bytes = await pipe(
      createTar(
        async (a) => {
          await a.addFile({
            name: "x",
            source: of(new Uint8Array(0)),
            size: 0,
            lastModified: t,
          });
        },
        { mtimePrecision: "subsecond" },
      ),
      collectBytes(),
    );
    for await (const e of readTarEntries(from([bytes]))) {
      expect(e.lastModified.getTime()).toBe(1700000000123);
      if (e.kind === "file") await pipe(e.source, collectBytes());
    }
  });
});

describe("round-trip: PAX uid/gid overflow", () => {
  it("uid > 2M triggers PAX, reader recovers full uid", async () => {
    const bigUid = 5_000_000;
    const bytes = await pipe(
      createTar(async (a) => {
        await a.addFile({
          name: "x",
          source: of(new Uint8Array(0)),
          size: 0,
          lastModified: EPOCH,
          uid: bigUid,
        });
      }),
      collectBytes(),
    );
    let recoveredUid: number | null = null;
    for await (const e of readTarEntries(from([bytes]))) {
      if (e.kind === "file") {
        recoveredUid = e.uid;
        await pipe(e.source, collectBytes());
      }
    }
    expect(recoveredUid).toBe(bigUid);
  });

  it("gid > 2M triggers PAX, reader recovers full gid", async () => {
    const bigGid = 5_000_000;
    const bytes = await pipe(
      createTar(async (a) => {
        await a.addFile({
          name: "x",
          source: of(new Uint8Array(0)),
          size: 0,
          lastModified: EPOCH,
          gid: bigGid,
        });
      }),
      collectBytes(),
    );
    let recoveredGid: number | null = null;
    for await (const e of readTarEntries(from([bytes]))) {
      if (e.kind === "file") {
        recoveredGid = e.gid;
        await pipe(e.source, collectBytes());
      }
    }
    expect(recoveredGid).toBe(bigGid);
  });
});

describe("auto-skip: unconsumed file source", () => {
  it("reader advances past skipped file data", async () => {
    const bytes = await archiveBytes(async (a) => {
      await a.addFile({
        name: "skipped.bin",
        source: of(new Uint8Array(1024)),
        size: 1024,
        lastModified: EPOCH,
      });
      await a.addFile({
        name: "kept.txt",
        source: of(bytesOf("ok")),
        size: 2,
        lastModified: EPOCH,
      });
    });

    const names: string[] = [];
    let lastBytes: Uint8Array | null = null;
    for await (const e of readTarEntries(from([bytes]))) {
      names.push(e.name);
      if (e.name === "kept.txt" && e.kind === "file") {
        lastBytes = await pipe(e.source, collectBytes());
      }
      // Note: skipped.bin's source is intentionally NOT drained.
    }
    expect(names).toEqual(["skipped.bin", "kept.txt"]);
    expect(decoder.decode(lastBytes!)).toBe("ok");
  });
});

describe("size mismatch", () => {
  it("source yields fewer bytes than declared → TarEntryError", async () => {
    const truncated = of(bytesOf("short"));
    const promise = pipe(
      createTar(async (a) => {
        await a.addFile({
          name: "x",
          source: truncated,
          size: 1000, // declared 1000, source has 5
          lastModified: EPOCH,
        });
      }),
      collectBytes(),
    );
    await expect(promise).rejects.toThrow(/size/);
  });

  it("source yields more bytes than declared → TarEntryError", async () => {
    const overshoot = of(bytesOf("x".repeat(100)));
    const promise = pipe(
      createTar(async (a) => {
        await a.addFile({
          name: "x",
          source: overshoot,
          size: 50,
          lastModified: EPOCH,
        });
      }),
      collectBytes(),
    );
    await expect(promise).rejects.toThrow(/size/);
  });
});
