import { describe, it, expect } from "vitest";
import { collectBytes, from, of, pipe } from "@culvert/stream";
import { createTar, EPOCH } from "./writer.js";
import { readTarEntries } from "./reader.js";
import { TarCorruptionError } from "./errors.js";
import { CHKSUM_OFFSET } from "./constants.js";

async function buildOne(): Promise<Uint8Array> {
  return await pipe(
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
}

describe("checksum policy", () => {
  it("strict (default) throws on corrupted checksum", async () => {
    const bytes = await buildOne();
    bytes[CHKSUM_OFFSET] = "9".charCodeAt(0); // corrupt first checksum digit
    const promise = (async () => {
      for await (const _ of readTarEntries(from([bytes]))) {
        // drain
      }
    })();
    await expect(promise).rejects.toThrow(TarCorruptionError);
  });

  it("permissive ignores corrupted checksum", async () => {
    const bytes = await buildOne();
    // Corrupt checksum by flipping a digit (use valid octal digit '0' vs original '1' or similar)
    // The stored checksum is at offset 148, modify one digit
    bytes[CHKSUM_OFFSET] = "0".charCodeAt(0); // corrupt first checksum digit to '0'
    const out: string[] = [];
    for await (const e of readTarEntries(from([bytes]), {
      checksumPolicy: "permissive",
    })) {
      out.push(e.name);
      if (e.kind === "file") await pipe(e.source, collectBytes());
    }
    expect(out).toEqual(["x"]);
  });
});
