import type { PeekEvent } from "./events";

/**
 * Read NDJSON events from a Response body.
 *
 * Yields one parsed event per line. Tolerates chunk boundaries that split
 * lines mid-JSON. The final partial line (if any) is dropped — the server
 * always terminates events with a newline.
 */
export async function* readNdjson(
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<PeekEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.length === 0) continue;
        try {
          yield JSON.parse(line) as PeekEvent;
        } catch {
          // Malformed line — skip and keep streaming. The server should
          // never produce these, but we don't want one bad line to nuke
          // the run.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
