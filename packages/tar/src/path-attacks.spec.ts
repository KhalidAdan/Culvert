import { describe, it, expect } from "vitest";
import { collectBytes, from, of, pipe } from "@culvert/stream";
import { createTar, EPOCH } from "./writer.js";
import { readTarEntries } from "./reader.js";
import { TarCorruptionError, TarEntryError } from "./errors.js";
import { END_OF_ARCHIVE_SIZE } from "./constants.js";
import { buildPaxExtendedHeader } from "./pax.js";
import { encodeUstarHeader } from "./ustar.js";

async function buildHostile(name: string, opts?: { typeflag?: "file" | "symlink" | "hardlink"; target?: string }): Promise<Uint8Array> {
  return await pipe(
    createTar(
      async (a) => {
        const t = opts?.typeflag ?? "file";
        if (t === "file") {
          await a.addFile({
            name,
            source: of(new Uint8Array(0)),
            size: 0,
            lastModified: EPOCH,
          });
        } else if (t === "symlink") {
          await a.addSymlink({ name, target: opts?.target ?? "x", lastModified: EPOCH });
        } else {
          await a.addHardLink({ name, target: opts?.target ?? "x", lastModified: EPOCH });
        }
      },
      { pathPolicy: "permissive" },
    ),
    collectBytes(),
  );
}

const attacks: Array<{ name: string; description: string }> = [
  { name: "/etc/passwd", description: "absolute POSIX" },
  { name: "../../../etc/passwd", description: "parent traversal" },
  { name: "a/b/c/../../../../etc/passwd", description: "deep parent traversal" },
  { name: "C:Windows/evil", description: "Windows drive" },
  { name: "..\\..\\windows\\evil", description: "backslash + parent" },
  // Note: null byte attacks are inherently prevented by tar's use of null-terminated strings
  // The path is truncated at the null byte during writing, so the attack doesn't survive
];

// Separate test for null byte handling - tar format truncates at null bytes
describe("null byte handling", () => {
  it("null bytes are truncated by tar format - only prefix is stored", async () => {
    // When a path contains a null byte, tar truncates at the null byte
    // This is a format limitation, not a security policy
    const bytes = await pipe(
      createTar(
        async (a) => {
          await a.addFile({
            name: "safe.txt\x00../../etc/passwd",
            source: of(new Uint8Array(0)),
            size: 0,
            lastModified: EPOCH,
          });
        },
        { pathPolicy: "permissive" },
      ),
      collectBytes(),
    );
    
    // The reader only sees "safe.txt" because tar truncates at null byte
    const out: string[] = [];
    for await (const e of readTarEntries(from([bytes]), { pathPolicy: "permissive" })) {
      out.push(e.name);
      if (e.kind === "file") await pipe(e.source, collectBytes());
    }
    // Note: tar format truncates at null byte, so only "safe.txt" is stored
    expect(out).toEqual(["safe.txt"]);
  });
});

describe("hostile path attacks", () => {
  for (const { name, description } of attacks) {
    it(`reader rejects ${description}: ${JSON.stringify(name)}`, async () => {
      const bytes = await buildHostile(name);
      const iter = readTarEntries(from([bytes]))[Symbol.asyncIterator]();
      await expect(iter.next()).rejects.toThrow(TarCorruptionError);
    });

    it(`writer also rejects ${description} under strict default`, async () => {
      const promise = pipe(
        createTar(async (a) => {
          await a.addFile({
            name,
            source: of(new Uint8Array(0)),
            size: 0,
            lastModified: EPOCH,
          });
        }),
        collectBytes(),
      );
      await expect(promise).rejects.toThrow(TarEntryError);
    });

    it(`reader accepts ${description} under permissive`, async () => {
      const bytes = await buildHostile(name);
      const out: string[] = [];
      for await (const e of readTarEntries(from([bytes]), { pathPolicy: "permissive" })) {
        out.push(e.name);
        if (e.kind === "file") await pipe(e.source, collectBytes());
      }
      expect(out).toContain(name);
    });
  }
});

describe("PAX-merged-name attack", () => {
  // The writer emits PAX 'path' for any name that doesn't fit ustar.
  // Under permissive writing, we can craft a long hostile name that
  // rides in via PAX. The reader must validate the MERGED name.
  it("reader validates the post-PAX name, not the ustar fallback", async () => {
    const evilLong = "../../etc/passwd-and-extra-padding-to-force-pax-".repeat(3);
    const bytes = await buildHostile(evilLong);
    const iter = readTarEntries(from([bytes]))[Symbol.asyncIterator]();
    await expect(iter.next()).rejects.toThrow(TarCorruptionError);
  });

  it("reader validates PAX-merged name even when ustar name is benign (byte-crafted)", async () => {
    // Hand-craft an archive where the ustar name is "safe.txt" but a
    // preceding PAX 'x' header overrides the path with a hostile value.
    // The writer can't naturally produce this because it only emits PAX
    // when the path doesn't fit ustar — a short benign path wouldn't
    // trigger PAX. A real attacker crafts bytes directly.

    const paxBlock = buildPaxExtendedHeader(
      new Map([["path", "../../etc/passwd"]]),
    );
    const fileHeader = encodeUstarHeader({
      name: "safe.txt",
      mode: 0o644,
      uid: 0,
      gid: 0,
      size: 0,
      mtimeSeconds: 0,
      typeflag: "0",
    });
    const eoa = new Uint8Array(END_OF_ARCHIVE_SIZE);

    const archive = new Uint8Array(
      paxBlock.length + fileHeader.length + eoa.length,
    );
    archive.set(paxBlock, 0);
    archive.set(fileHeader, paxBlock.length);
    archive.set(eoa, paxBlock.length + fileHeader.length);

    const iter = readTarEntries(from([archive]))[Symbol.asyncIterator]();
    await expect(iter.next()).rejects.toThrow(TarCorruptionError);
  });
});
