# `@culvert/peeker`

**A live npm tarball inspector.** Paste the URL of a published package and watch
its contents stream into the browser as the bytes arrive — alongside a real-time
chart of the server's heap usage to prove that nothing is being buffered.

This app exists for one reason: to make `@culvert/tar`'s constant-memory
guarantee legible at a glance. The demo of choice is `next` — a couple
megabytes compressed, ~14 MB uncompressed, hundreds of `.d.ts` files. A
buffering library would visibly grow heap as the archive flows through. Culvert
doesn't.

## What you'll see

- **archive entries** stream in as they're parsed by `readTarEntries`. The
  reader auto-skips file body bytes when iteration moves on, so the entry log
  appears almost instantly.
- **bytes streamed** climbs steeply. This is the cumulative byte count from a
  `tap()` operator inside the pipeline — the same primitive culvert ships, used
  here to do its own observability.
- **heap delta** stays nailed near zero throughout. Heap is sampled
  out-of-band every 100ms via `process.memoryUsage().heapUsed`. The contrast is
  the whole point.

## How it works

```
fetch(tarball)  →  DecompressionStream("gzip")  →  fromReadableStream
                                                          │
                            tap(chunk → bytesIn += len)   ┘
                                          │
                                  readTarEntries
                                          │
                              for await (entry) emit NDJSON
```

The server (a React Router resource route at `/api/peek`) holds open a single
NDJSON response. Three event types interleave on the wire:

```ts
{
  t: ("entry", path, size, kind);
}
{
  t: ("mem", ms, heapUsed, bytesIn);
}
{
  t: ("done", ms, totalEntries, totalBytes);
}
```

The client reads them with `getReader()` + line-splitting, batches updates to
React state on `requestAnimationFrame`, and renders.

No file body is ever read. We never decode strings, never collect bytes, never
peek inside any file. The peeker only walks headers — `O(headers)`, not
`O(archive size)` — which is the same property that lets you stream-process tar
files at any size without breaking a sweat.

## Setup

This package depends on `@culvert/tar` and `@culvert/stream` via workspace
protocol. The intended layout:

```
culvert/
├── packages/
│   ├── stream/
│   ├── crc32/
│   ├── zip/
│   └── tar/
└── apps/
    └── peeker/   ← drop this here
```

Add `apps/*` to the workspace globs in the root `package.json`:

```json
{
  "workspaces": ["packages/*", "apps/*"]
}
```

Then from the repo root:

```sh
npm install
npm run build --workspaces
cd apps/peeker
npm run dev
```

Open the URL the dev server prints. The stream starts on page load.

## V2 ideas

- Configurable package via query param (`?package=react`). The route is already
  isolated; add a search param, parse it in the loader, validate, pass to
  `resolveTarball`. The pipeline doesn't change.
- Side-by-side run vs. a buffering library. Two `<MemoryChart>`s, two pipelines,
  one window. Sells the case even harder.
- Drag-and-drop a local `.tar.gz`. Same pipeline, different source. Browser-side
  variant where the app has no server at all.

## Files

```
app/
├── root.tsx
├── routes.ts
├── routes/
│   ├── _index.tsx        ← the page
│   └── api.peek.ts       ← the streaming resource route
├── lib/
│   ├── events.ts         ← shared NDJSON event types
│   ├── ndjson.ts         ← client-side line reader
│   └── npm.ts            ← server-side registry resolver
├── components/
│   └── MemoryChart.tsx   ← inline-SVG dual-line chart
└── styles.css
```

About 800 lines total, plus styles. The whole demo, including the chart, is
small enough to read end-to-end before lunch.
