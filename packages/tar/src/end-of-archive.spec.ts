import { describe, it, expect } from "vitest";
import { collectBytes, from, of, pipe } from "@culvert/stream";
import { createTar, EPOCH } from "./writer.js";
import { readTarEntries } from "./reader.js";
import { TarCorruptionError } from "./errors.js";

describe("end of archive", () => {
  it("reader stops cleanly at the 1024-byte zero marker", async () => {
    const bytes = await pipe(
      createTar(async (a) => {
        await a.addFile({
          name: "x",
          source: of(new Uint8Array(0)),
          size: 0,
          lastModified: EPOCH,
        });
      }),
      collectBytes(),
    );
    const out: string[] = [];
    for await (const e of readTarEntries(from([bytes]))) {
      out.push(e.name);
      if (e.kind === "file") await pipe(e.source, collectBytes());
    }
    expect(out).toEqual(["x"]);
  });

  it("missing end marker → TarCorruptionError", async () => {
    // Build a valid archive, then truncate the trailing 1024 zeros.
    const bytes = await pipe(
      createTar(async (a) => {
        await a.addFile({
          name: "x",
          source: of(new Uint8Array(0)),
          size: 0,
          lastModified: EPOCH,
        });
      }),
      collectBytes(),
    );
    const truncated = bytes.subarray(0, bytes.length - 1024);
    const promise = (async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      for await (const _ of readTarEntries(from([truncated]))) {
        // drain
      }
    })();
    await expect(promise).rejects.toThrow(TarCorruptionError);
  });

  it("trailing data after end marker is ignored", async () => {
    const bytes = await pipe(
      createTar(async (a) => {
        await a.addFile({
          name: "x",
          source: of(new Uint8Array(0)),
          size: 0,
          lastModified: EPOCH,
        });
      }),
      collectBytes(),
    );
    const garbage = new Uint8Array(2048); // arbitrary trailing junk
    const combined = new Uint8Array(bytes.length + garbage.length);
    combined.set(bytes, 0);
    combined.set(garbage, bytes.length);
    const out: string[] = [];
    for await (const e of readTarEntries(from([combined]))) {
      out.push(e.name);
      if (e.kind === "file") await pipe(e.source, collectBytes());
    }
    expect(out).toEqual(["x"]);
  });
});
