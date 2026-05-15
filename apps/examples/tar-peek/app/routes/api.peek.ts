import { fromReadableStream, pipe, tap } from "@culvert/stream";
import { readTarEntries } from "@culvert/tar";
import type { PeekEvent } from "~/lib/events";
import { resolveTarball } from "~/lib/npm";
import type { Route } from "./+types/api.peek";

/**
 * GET /api/peek
 *
 * Streams a live view of an npm tarball as NDJSON. Three event types
 * interleave on the wire — `entry` per file, `mem` every 100ms, `start`
 * and `done` bracket the run.
 *
 * The pipeline:
 *
 *   fetch tarball  →  DecompressionStream("gzip")  →  fromReadableStream
 *                                                          │
 *                            tap(chunk → bytesIn += len)  ─┘
 *                                          │
 *                                  readTarEntries
 *                                          │
 *                              for await (entry) emit NDJSON
 *
 * No file body is ever read — moving to the next entry auto-skips.
 * Memory is sampled out-of-band on a 100ms timer using
 * `process.memoryUsage().heapUsed` and emitted as `mem` events.
 */

const SAMPLE_INTERVAL_MS = 100;

export async function loader({ request }: Route.LoaderArgs) {
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const startedAt = performance.now();
      let bytesIn = 0;
      let totalEntries = 0;
      let totalBytes = 0;
      let closed = false;

      const emit = (event: PeekEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          // Controller already closed — give up silently.
          closed = true;
        }
      };

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(sampler);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // The observability story. A fixed cadence sample of heapUsed,
      // emitted alongside the cumulative bytesIn counter that `tap`
      // is updating in the pipeline below. This is what the client
      // graphs.
      const sampler = setInterval(() => {
        emit({
          t: "mem",
          ms: performance.now() - startedAt,
          heapUsed: process.memoryUsage().heapUsed,
          bytesIn,
        });
      }, SAMPLE_INTERVAL_MS);

      // Honor client disconnect — close everything cleanly.
      const onAbort = () => cleanup();
      request.signal.addEventListener("abort", onAbort, { once: true });

      try {
        // 1) Resolve the latest published tarball.
        const url = new URL(request.url);
        const packageName = url.searchParams.get("package") || "next";

        const { version, tarballUrl } = await resolveTarball(
          packageName,
          request.signal,
        );
        emit({ t: "start", package: packageName, version, tarballUrl });

        // 2) Fetch the tarball. The body is a Web ReadableStream of
        //    gzipped bytes. Pipe it through the platform-native gunzip
        //    transformer — no zlib import, no node:stream, just bytes.
        const tarballRes = await fetch(tarballUrl, { signal: request.signal });
        if (!tarballRes.ok || !tarballRes.body) {
          throw new Error(
            `tarball fetch returned ${tarballRes.status} ${tarballRes.statusText}`,
          );
        }
        const tarBytes = tarballRes.body.pipeThrough(
          new DecompressionStream("gzip"),
        );

        // 3) Build the culvert pipeline. The entire stream — gunzip,
        //    throughput tap, tar header parsing, and NDJSON emission —
        //    is one pipe with a sink that drives consumption. Back-
        //    pressure propagates all the way back to the fetch, so we
        //    never buffer more than a chunk in flight.
        await pipe(
          fromReadableStream(tarBytes),
          tap((chunk: Uint8Array) => {
            bytesIn += chunk.byteLength;
          }),
          (source) => readTarEntries(source, { pathPolicy: "strict" }),
          async (entries) => {
            for await (const entry of entries) {
              if (request.signal.aborted) break;
              totalEntries += 1;
              if (entry.kind === "file") totalBytes += entry.size;
              emit({
                t: "entry",
                path: entry.name,
                size: entry.kind === "file" ? entry.size : 0,
                kind: entry.kind,
              });
            }

            // Final memory sample so the chart's last point reflects
            // the post-stream state, then `done`.
            emit({
              t: "mem",
              ms: performance.now() - startedAt,
              heapUsed: process.memoryUsage().heapUsed,
              bytesIn,
            });
            emit({
              t: "done",
              ms: performance.now() - startedAt,
              totalEntries,
              totalBytes,
            });
          },
        );
      } catch (err) {
        if (!request.signal.aborted) {
          emit({
            t: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        request.signal.removeEventListener("abort", onAbort);
        cleanup();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "X-Content-Type-Options": "nosniff",
      // Tell upstream proxies (nginx, etc.) not to buffer this response.
      "X-Accel-Buffering": "no",
    },
  });
}
