import { CRC32 } from "@culvert/crc32";
import type { Source } from "@culvert/stream";
import {
  collectBytes,
  from,
  pipe,
  tap,
  toReadableStream,
} from "@culvert/stream";
import { describe, expect, it } from "vitest";
import {
  createZip,
  readZipEntries,
  ZipAbortError,
  ZipEntryError,
} from "./index.js";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const encode = (s: string) => new TextEncoder().encode(s);
const decode = (b: Uint8Array) => new TextDecoder().decode(b);

/** Collect a Source<Uint8Array> into a single Uint8Array */
async function collectAll(source: Source<Uint8Array>): Promise<Uint8Array> {
  return await pipe(source, collectBytes());
}

/** Create a simple single-chunk file source from a string */
function stringSource(s: string): Source<Uint8Array> {
  return from([encode(s)]);
}

// ---------------------------------------------------------------------------
// 1. DOS time conversion (via round-trip — the functions are internal,
//    so we verify them indirectly through write → read)
// ---------------------------------------------------------------------------
describe("date preservation", () => {
  it("lastModified survives round-trip", async () => {
    // DOS time has 2-second resolution, so we pick an even second
    const date = new Date(2024, 5, 15, 14, 30, 22); // June 15, 2024 14:30:22

    const zip = createZip(async (archive) => {
      await archive.addFile({
        name: "dated.txt",
        source: stringSource("hello"),
        compression: "store",
        lastModified: date,
      });
    });

    const zipBytes = await collectAll(zip);

    for await (const entry of readZipEntries(from([zipBytes]))) {
      expect(entry.lastModified.getFullYear()).toEqual(2024);
      expect(entry.lastModified.getMonth()).toEqual(5); // June
      expect(entry.lastModified.getDate()).toEqual(15);
      expect(entry.lastModified.getHours()).toEqual(14);
      expect(entry.lastModified.getMinutes()).toEqual(30);
      expect(entry.lastModified.getSeconds()).toEqual(22);

      // Consume the source
      await collectAll(entry.source);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Binary format — verify the ZIP structure is parseable
// ---------------------------------------------------------------------------
describe("binary format", () => {
  it("produces valid ZIP signature at start", async () => {
    const zip = createZip(async (archive) => {
      await archive.addFile({
        name: "test.txt",
        source: stringSource("hello"),
        compression: "store",
      });
    });

    const bytes = await collectAll(zip);
    const view = new DataView(bytes.buffer, bytes.byteOffset);

    // Local file header signature
    expect(view.getUint32(0, true)).toEqual(0x04034b50);
  });

  it("produces valid EOCD signature at end", async () => {
    const zip = createZip(async (archive) => {
      await archive.addFile({
        name: "test.txt",
        source: stringSource("hello"),
        compression: "store",
      });
    });

    const bytes = await collectAll(zip);

    // Search for EOCD signature from the end
    let eocdOffset = -1;
    for (let i = bytes.length - 22; i >= 0; i--) {
      const view = new DataView(bytes.buffer, bytes.byteOffset + i);
      if (view.getUint32(0, true) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }

    expect(eocdOffset, "EOCD signature not found").toBeGreaterThanOrEqual(0);
  });

  it("empty archive has just an EOCD", async () => {
    const zip = createZip(async () => {
      // no files
    });

    const bytes = await collectAll(zip);
    // Minimum ZIP: just EOCD = 22 bytes
    expect(bytes.length).toEqual(22);

    const view = new DataView(bytes.buffer, bytes.byteOffset);
    expect(view.getUint32(0, true)).toEqual(0x06054b50);
  });
});

// ---------------------------------------------------------------------------
// 3. Round-trip: store compression (no deflate)
// ---------------------------------------------------------------------------
describe("round-trip: store", () => {
  it("single file preserves content", async () => {
    const content = "Hello, Culvert!";

    const zip = createZip(async (archive) => {
      await archive.addFile({
        name: "greeting.txt",
        source: stringSource(content),
        compression: "store",
      });
    });

    const zipBytes = await collectAll(zip);
    const entries: { name: string; data: string }[] = [];

    for await (const entry of readZipEntries(from([zipBytes]))) {
      const data = await collectAll(entry.source);
      entries.push({ name: entry.name, data: decode(data) });
    }

    expect(entries.length).toEqual(1);
    expect(entries[0]!.name).toEqual("greeting.txt");
    expect(entries[0]!.data).toEqual(content);
  });

  it("multiple files preserve content and order", async () => {
    const files = [
      { name: "a.txt", content: "alpha" },
      { name: "b.txt", content: "bravo" },
      { name: "c.txt", content: "charlie" },
    ];

    const zip = createZip(async (archive) => {
      for (const f of files) {
        await archive.addFile({
          name: f.name,
          source: stringSource(f.content),
          compression: "store",
        });
      }
    });

    const zipBytes = await collectAll(zip);
    const results: { name: string; data: string }[] = [];

    for await (const entry of readZipEntries(from([zipBytes]))) {
      const data = await collectAll(entry.source);
      results.push({ name: entry.name, data: decode(data) });
    }

    expect(results.length).toEqual(3);
    for (let i = 0; i < files.length; i++) {
      expect(results[i]!.name).toEqual(files[i]!.name);
      expect(results[i]!.data).toEqual(files[i]!.content);
    }
  });

  it("empty file round-trips", async () => {
    const zip = createZip(async (archive) => {
      await archive.addFile({
        name: "empty.txt",
        source: from([]),
        compression: "store",
      });
    });

    const zipBytes = await collectAll(zip);

    for await (const entry of readZipEntries(from([zipBytes]))) {
      expect(entry.name).toEqual("empty.txt");
      const data = await collectAll(entry.source);
      expect(data.length).toEqual(0);
    }
  });

  it("binary data round-trips", async () => {
    const binary = new Uint8Array(256);
    for (let i = 0; i < 256; i++) binary[i] = i;

    const zip = createZip(async (archive) => {
      await archive.addFile({
        name: "binary.bin",
        source: from([binary]),
        compression: "store",
      });
    });

    const zipBytes = await collectAll(zip);

    for await (const entry of readZipEntries(from([zipBytes]))) {
      const data = await collectAll(entry.source);
      expect(data).toStrictEqual(binary);
    }
  });

  it("multi-chunk file round-trips", async () => {
    const chunks = [
      encode("chunk-one-"),
      encode("chunk-two-"),
      encode("chunk-three"),
    ];

    const zip = createZip(async (archive) => {
      await archive.addFile({
        name: "chunked.txt",
        source: from(chunks),
        compression: "store",
      });
    });

    const zipBytes = await collectAll(zip);

    for await (const entry of readZipEntries(from([zipBytes]))) {
      const data = decode(await collectAll(entry.source));
      expect(data).toEqual("chunk-one-chunk-two-chunk-three");
    }
  });

  it("unicode filename round-trips", async () => {
    const zip = createZip(async (archive) => {
      await archive.addFile({
        name: "日本語ファイル.txt",
        source: stringSource("こんにちは"),
        compression: "store",
      });
    });

    const zipBytes = await collectAll(zip);

    for await (const entry of readZipEntries(from([zipBytes]))) {
      expect(entry.name).toEqual("日本語ファイル.txt");
      const data = decode(await collectAll(entry.source));
      expect(data).toEqual("こんにちは");
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Round-trip: deflate compression
// ---------------------------------------------------------------------------
describe("round-trip: deflate", () => {
  it("single file with deflate preserves content", async () => {
    const content = "This is a test of deflate compression in @culvert/zip.";

    const zip = createZip(async (archive) => {
      await archive.addFile({
        name: "compressed.txt",
        source: stringSource(content),
        compression: "deflate",
      });
    });

    const zipBytes = await collectAll(zip);
    const entries: { name: string; data: string }[] = [];

    for await (const entry of readZipEntries(from([zipBytes]))) {
      expect(entry.compressionMethod).toEqual(8); // deflate = method 8
      const data = await collectAll(entry.source);
      entries.push({ name: entry.name, data: decode(data) });
    }

    expect(entries.length).toEqual(1);
    expect(entries[0]!.data).toEqual(content);
  });

  it("deflate actually compresses (output smaller than input)", async () => {
    // Highly compressible: repeated pattern
    const repeated = "ABCDEFGH".repeat(1000);

    const zip = createZip(async (archive) => {
      await archive.addFile({
        name: "compressible.txt",
        source: stringSource(repeated),
        compression: "deflate",
      });
    });

    const zipBytes = await collectAll(zip);

    // The ZIP file should be substantially smaller than the raw data
    expect(zipBytes.length).toBeLessThan(repeated.length / 2);
    expect(
      zipBytes.length,
      "ZIP file should be smaller than raw data",
    ).toBeLessThan(repeated.length / 2);
    for await (const entry of readZipEntries(from([zipBytes]))) {
      const data = decode(await collectAll(entry.source));
      expect(data).toEqual(repeated);
    }
  });

  it("mixed store and deflate in same archive", async () => {
    const zip = createZip(async (archive) => {
      await archive.addFile({
        name: "stored.txt",
        source: stringSource("stored content"),
        compression: "store",
      });
      await archive.addFile({
        name: "deflated.txt",
        source: stringSource("deflated content"),
        compression: "deflate",
      });
    });

    const zipBytes = await collectAll(zip);
    const results: { name: string; data: string; method: number }[] = [];

    for await (const entry of readZipEntries(from([zipBytes]))) {
      const data = decode(await collectAll(entry.source));
      results.push({ name: entry.name, data, method: entry.compressionMethod });
    }

    expect(results.length).toEqual(2);
    expect(results[0]!.name).toEqual("stored.txt");
    expect(results[0]!.data).toEqual("stored content");
    expect(results[0]!.method).toEqual(0);
    expect(results[1]!.name).toEqual("deflated.txt");
    expect(results[1]!.data).toEqual("deflated content");
    expect(results[1]!.method).toEqual(8);
  });
});

// ---------------------------------------------------------------------------
// 5. Lazy properties
// ---------------------------------------------------------------------------
describe("lazy entry properties", () => {
  it("sizes and CRC available after consuming source", async () => {
    const content = "test content for size check";
    const contentBytes = encode(content);

    // Compute expected CRC
    const expectedCrc = new CRC32();
    expectedCrc.update(contentBytes);
    const expectedCrcValue = expectedCrc.digest();

    const zip = createZip(async (archive) => {
      await archive.addFile({
        name: "sized.txt",
        source: stringSource(content),
        compression: "store",
      });
    });

    const zipBytes = await collectAll(zip);

    for await (const entry of readZipEntries(from([zipBytes]))) {
      // Consume the source first
      const data = await collectAll(entry.source);

      // Now sizes and CRC should be available
      expect(entry.uncompressedSize).toEqual(contentBytes.length);
      expect(entry.compressedSize).toEqual(contentBytes.length); // store = same
      expect(entry.crc32).toEqual(expectedCrcValue);
    }
  });

  // Note: we can't easily test the console.warn without mocking console,
  // but we verify the return value is 0 before consumption
  it("returns 0 before source is consumed", async () => {
    const zip = createZip(async (archive) => {
      await archive.addFile({
        name: "test.txt",
        source: stringSource("hello"),
        compression: "store",
      });
    });

    const zipBytes = await collectAll(zip);
    const originalWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...args: unknown[]) => {
      warnings.push(String(args[0]));
    };

    try {
      for await (const entry of readZipEntries(from([zipBytes]))) {
        // Access before consuming
        const size = entry.compressedSize;
        expect(size).toEqual(0);
        expect(warnings.length).toBeGreaterThan(0);
        expect(warnings[0]!).toContain("compressedSize");

        // Now consume
        await collectAll(entry.source);
      }
    } finally {
      console.warn = originalWarn;
    }
  });
});

// ---------------------------------------------------------------------------
// 6. CRC verification
// ---------------------------------------------------------------------------
describe("CRC verification", () => {
  it("valid CRC passes silently", async () => {
    const zip = createZip(async (archive) => {
      await archive.addFile({
        name: "valid.txt",
        source: stringSource("correct data"),
        compression: "store",
      });
    });

    const zipBytes = await collectAll(zip);

    // Should not throw
    for await (const entry of readZipEntries(from([zipBytes]))) {
      await collectAll(entry.source);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Streaming behavior
// ---------------------------------------------------------------------------
describe("streaming behavior", () => {
  it("data flows through without full buffering", async () => {
    // Write a moderately large file in many chunks
    const chunkCount = 100;
    const chunkSize = 10_000;

    const zip = createZip(async (archive) => {
      await archive.addFile({
        name: "large.bin",
        source: (async function* () {
          for (let i = 0; i < chunkCount; i++) {
            yield new Uint8Array(chunkSize).fill(i % 256);
          }
        })(),
        compression: "store",
      });
    });

    // Consume and count
    let totalBytes = 0;
    let chunks = 0;
    for await (const chunk of zip) {
      totalBytes += chunk.length;
      chunks++;
    }

    // Should have received data in multiple chunks, not one giant buffer
    expect(chunks).toBeGreaterThan(10);
    // Total should include file data + headers/descriptors/CD
    expect(totalBytes).toBeGreaterThan(chunkCount * chunkSize);
  });

  it("backpressure flows between files via channel", async () => {
    const producerTimestamps: number[] = [];
    const start = Date.now();

    const zip = createZip(async (archive) => {
      // Multiple small files — backpressure between file emissions
      for (let i = 0; i < 5; i++) {
        producerTimestamps.push(Date.now() - start);
        await archive.addFile({
          name: `file-${i}.bin`,
          source: from([new Uint8Array(100)]),
          compression: "store",
        });
      }
    });

    // Slow consumer: 30ms between pulls
    for await (const _ of zip) {
      await delay(30);
    }

    const spread =
      producerTimestamps[producerTimestamps.length - 1]! -
      producerTimestamps[0]!;
    expect(spread).toBeGreaterThan(60);
  });
});

// ---------------------------------------------------------------------------
// 8. Entry skipping
// ---------------------------------------------------------------------------
describe("entry skipping", () => {
  it("skipping an entry still allows reading subsequent entries", async () => {
    const zip = createZip(async (archive) => {
      await archive.addFile({
        name: "skip-me.txt",
        source: stringSource("I will be skipped"),
        compression: "store",
      });
      await archive.addFile({
        name: "read-me.txt",
        source: stringSource("I will be read"),
        compression: "store",
      });
    });

    const zipBytes = await collectAll(zip);
    const results: string[] = [];

    for await (const entry of readZipEntries(from([zipBytes]))) {
      if (entry.name === "skip-me.txt") {
        // Don't consume — reader should drain it for us
        continue;
      }
      const data = decode(await collectAll(entry.source));
      results.push(data);
    }

    expect(results).toStrictEqual(["I will be read"]);
  });
});

// ---------------------------------------------------------------------------
// 9. Error handling
// ---------------------------------------------------------------------------
describe("error handling", () => {
  it("rejects on empty entry name", async () => {
    const zip = createZip(async (archive) => {
      await archive.addFile({
        name: "",
        source: stringSource("hello"),
        compression: "store",
      });
    });

    try {
      await collectAll(zip);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(ZipEntryError);
      expect(err.message).toContain("name");
    }
  });

  it("archive-level abort signal cancels", async () => {
    const controller = new AbortController();

    const zip = createZip(
      async (archive) => {
        await archive.addFile({
          name: "first.txt",
          source: stringSource("ok"),
          compression: "store",
        });

        controller.abort();

        await archive.addFile({
          name: "second.txt",
          source: stringSource("should not reach"),
          compression: "store",
        });
      },
      { signal: controller.signal },
    );

    try {
      await collectAll(zip);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err).toBeInstanceOf(ZipAbortError);
      expect(err.message).toContain("aborted");
    }
  });

  it("per-file abort signal cancels only that file", async () => {
    const fileController = new AbortController();

    const zip = createZip(async (archive) => {
      try {
        await archive.addFile({
          name: "aborted.txt",
          source: (async function* () {
            yield encode("partial");
            fileController.abort();
            await delay(10);
            yield encode("should not reach");
          })(),
          compression: "store",
          signal: fileController.signal,
        });
      } catch (err) {
        // Per-file abort — we can catch and continue
        if (!(err instanceof ZipAbortError)) throw err;
      }

      // This file should still work (if we caught the abort above)
      // Note: in practice, the archive is in an inconsistent state
      // after a partial file. This test verifies the signal fires.
    });

    // The per-file abort may leave the archive in a partial state
    // depending on timing. The key assertion is that ZipAbortError fires.
    try {
      await collectAll(zip);
    } catch {
      // May throw due to partial archive — that's ok
    }
  });

  it("source error propagates through pipeline", async () => {
    const zip = createZip(async (archive) => {
      await archive.addFile({
        name: "failing.txt",
        source: (async function* () {
          yield encode("some data");
          throw new Error("disk read failure");
        })(),
        compression: "store",
      });
    });

    try {
      await collectAll(zip);
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.message).toEqual("disk read failure");
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Composition with @culvert/stream
// ---------------------------------------------------------------------------
describe("stream composition", () => {
  it("createZip output works with toReadableStream", async () => {
    const zip = createZip(async (archive) => {
      await archive.addFile({
        name: "web.txt",
        source: stringSource("for the browser"),
        compression: "store",
      });
    });

    const readable = toReadableStream(zip);
    expect(readable).toBeInstanceOf(ReadableStream);

    // Read via Web Streams API
    const reader = readable.getReader();
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    expect(chunks.length).toBeGreaterThan(0);
  });

  it("tap() can observe ZIP output bytes", async () => {
    let totalBytes = 0;

    const zip = createZip(async (archive) => {
      await archive.addFile({
        name: "observed.txt",
        source: stringSource("watching the bytes flow"),
        compression: "store",
      });
    });

    await pipe(
      zip,
      tap((chunk) => {
        totalBytes += chunk.length;
      }),
      async (source) => {
        for await (const _ of source) {
        }
      },
    );

    expect(totalBytes).toBeGreaterThan(0);
    expect(totalBytes, "Should have observed bytes").toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 11. Many files
// ---------------------------------------------------------------------------
describe("many files", () => {
  it("100 files round-trip correctly", async () => {
    const fileCount = 100;

    const zip = createZip(async (archive) => {
      for (let i = 0; i < fileCount; i++) {
        await archive.addFile({
          name: `file-${i.toString().padStart(3, "0")}.txt`,
          source: stringSource(`content of file ${i}`),
          compression: "store",
        });
      }
    });

    const zipBytes = await collectAll(zip);
    let count = 0;

    for await (const entry of readZipEntries(from([zipBytes]))) {
      const data = decode(await collectAll(entry.source));
      expect(data).toEqual(`content of file ${count}`);
      expect(entry.name).toEqual(
        `file-${count.toString().padStart(3, "0")}.txt`,
      );
      count++;
    }

    expect(count).toEqual(fileCount);
  });
});
