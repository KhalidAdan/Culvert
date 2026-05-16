# @culvert/gzip

Streaming gzip compression and decompression. Platform DEFLATE. CRC-32 verified. Zero dependencies beyond Culvert.

```ts
await pipe(source, gzip(), writeTo("output.gz"));
await pipe(readFile("output.gz"), gunzip(), writeTo("output"));
```

## Install

```sh
npm install @culvert/gzip
```

## Compress

```ts
import { gzip } from "@culvert/gzip";
import { pipe } from "@culvert/stream";

await pipe(source, gzip(), writeTo("data.json.gz"));
```

With options:

```ts
await pipe(
  source,
  gzip({
    filename: "data.json", // stored in gzip header (FNAME)
    mtime: new Date(), // stored in gzip header; defaults to epoch
    comment: "nightly export", // stored in gzip header (FCOMMENT)
    signal: AbortSignal.timeout(5000),
  }),
  writeTo("data.json.gz"),
);
```

`mtime` defaults to Unix epoch (`new Date(0)`) for reproducible output. Two compressions of the same input with the same options produce byte-identical gzip output.

## Decompress

```ts
import { gunzip } from "@culvert/gzip";

await pipe(readFile("data.json.gz"), gunzip(), writeTo("data.json"));
```

With abort:

```ts
await pipe(compressedSource, gunzip({ signal }), writeTo("output"));
```

## Compose with tar

The reason this package exists:

```ts
import { createTar, EPOCH } from "@culvert/tar";
import { gzip } from "@culvert/gzip";

await pipe(
  createTar(async (tar) => {
    await tar.addFile({
      name: "report.csv",
      source,
      size,
      lastModified: EPOCH,
    });
  }),
  gzip(),
  writeTo("archive.tar.gz"),
);
```

## HTTP response compression

```ts
import { gzip } from "@culvert/gzip";
import { pipe, toReadableStream } from "@culvert/stream";

const body = pipe(generateResponse(), gzip());
return new Response(toReadableStream(body), {
  headers: { "Content-Encoding": "gzip" },
});
```

## BYOC (bring your own compressor)

The platform's `CompressionStream` handles DEFLATE. If you need a custom codec — different compression level, a pure-JS implementation, or a WebAssembly engine — use the escape hatch:

```ts
import { gzipWith, gunzipWith } from "@culvert/gzip";

await pipe(
  source,
  gzipWith({ compress: myDeflateTransform }),
  writeTo("out.gz"),
);
await pipe(
  readFile("out.gz"),
  gunzipWith({ decompress: myInflateTransform }),
  writeTo("out"),
);
```

Your custom transform handles raw DEFLATE (RFC 1951). `@culvert/gzip` handles the gzip framing, CRC-32, and ISIZE around it.

## Errors

Two error classes, same taxonomy as `@culvert/zip` and `@culvert/tar`:

```ts
import { GzipCorruptionError, GzipAbortError } from "@culvert/gzip";

try {
  await pipe(source, gunzip(), collect());
} catch (err) {
  if (err instanceof GzipCorruptionError) {
    // bad magic, bad CRC, truncated stream, invalid DEFLATE
  }
  if (err instanceof GzipAbortError) {
    // AbortSignal fired
  }
}
```

CRC-32 and ISIZE are validated by the platform. Mismatches throw `GzipCorruptionError`.

## Limitations

**Single gzip member only.** RFC 1952 allows concatenated gzip members (`cat a.gz b.gz > combined.gz`), but the WHATWG Compression Streams spec defines a gzip stream as exactly one member. `DecompressionStream` does not report how many compressed bytes it consumed, so detecting member boundaries is impossible without owning the DEFLATE implementation. Some runtimes (Node.js) handle concatenated members as a non-spec extension, but this isn't portable across browsers, Cloudflare Workers, Deno, and Bun.

If you need concatenated member support, use `gunzipWith()` with a custom DEFLATE decompressor that tracks consumed byte counts.

**No compression level control.** `CompressionStream` doesn't accept a level parameter. The platform picks its default (typically zlib level 6). For level control today, use `gzipWith()` with a custom DEFLATE transform that accepts level configuration.

**No permissive CRC mode.** The platform always validates CRC-32. Its error behavior on mismatch is inconsistent across payload sizes and runtimes — sometimes it throws before yielding any data, sometimes after yielding all of it. We normalize to `GzipCorruptionError`. For damaged streams, use `gunzipWith()` with a custom decompressor that skips validation.

## API surface

```
gzip(options?)    → Transform<Uint8Array, Uint8Array>
gunzip(options?)  → Transform<Uint8Array, Uint8Array>
gzipWith(options) → Transform<Uint8Array, Uint8Array>
gunzipWith(options) → Transform<Uint8Array, Uint8Array>

GzipCorruptionError
GzipAbortError
```

Six runtime exports. Four type exports (`GzipOptions`, `GunzipOptions`, `GzipWithOptions`, `GunzipWithOptions`). That's the whole package.

## How it works

The compressor uses `CompressionStream("deflate-raw")` for raw DEFLATE and wraps it in gzip framing (RFC 1952) with a CRC-32 footer computed by `@culvert/crc32`. This gives us control over header fields (FNAME, FCOMMENT, MTIME) and reproducible output.

The decompressor uses `DecompressionStream("gzip")` directly. The platform handles header parsing, DEFLATE, CRC-32, and ISIZE. We bridge async iterables to/from the Web Stream and normalize errors to `GzipCorruptionError`.

## Related packages

```
stream
├── crc32   (leaf — no culvert deps)
├── zip     (stream + crc32)
├── tar     (stream)
└── gzip    ← you are here  (stream + crc32)
```

## License

MIT. See [LICENSE](./LICENSE).
