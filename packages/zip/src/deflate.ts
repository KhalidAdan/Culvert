// Re-export shared DEFLATE bridge from internal package.
export { deflateRaw, inflateRaw } from "@culvert/internal-deflate";

// ---------------------------------------------------------------------------
// identityTransform() — passthrough for "store" compression.
// ---------------------------------------------------------------------------

import type { Transform } from "@culvert/stream";

export function identityTransform(): Transform<Uint8Array, Uint8Array> {
  return async function* (source) {
    for await (const chunk of source) {
      yield chunk;
    }
  };
}
