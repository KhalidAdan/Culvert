import { TarCorruptionError } from "./errors.js";

/**
 * Adapts an AsyncIterable<Uint8Array> into a pull-based byte reader
 * with exact-length reads, peeks, and skips.
 *
 * Holds an internal buffer of unconsumed bytes from the most recent
 * chunk. Pulls more chunks lazily as the consumer demands bytes.
 *
 * Single-pass: cannot rewind. The reader's contract matches a forward-
 * only file pointer.
 */
export interface ByteReader {
  /** Read exactly n bytes. Throws TarCorruptionError if the source ends first. */
  readExact(n: number): Promise<Uint8Array>;

  /**
   * Read up to n bytes without removing them from the stream. The
   * returned buffer is at most n bytes long; may be shorter if the
   * source ends. Subsequent reads return the same bytes.
   */
  peek(n: number): Promise<Uint8Array>;

  /** Skip exactly n bytes. Throws TarCorruptionError if the source ends first. */
  skip(n: number): Promise<void>;

  /** Best-effort: drain any remaining bytes from the underlying iterator. */
  finish(): Promise<void>;
}

export function byteReader(source: AsyncIterable<Uint8Array>): ByteReader {
  const iter = source[Symbol.asyncIterator]();
  let buffered: Uint8Array | null = null;
  let bufferedOffset = 0;
  let exhausted = false;

  /** Pull one more chunk into the buffer. Returns false if source is done. */
  async function pullChunk(): Promise<boolean> {
    if (exhausted) return false;
    const { value, done } = await iter.next();
    if (done) {
      exhausted = true;
      return false;
    }
    if (value.length === 0) {
      // Empty chunk — pull again rather than treat as EOF.
      return pullChunk();
    }
    if (buffered === null || bufferedOffset === buffered.length) {
      buffered = value;
      bufferedOffset = 0;
    } else {
      // Append: existing remainder + new chunk.
      const remaining = buffered.subarray(bufferedOffset);
      const combined = new Uint8Array(remaining.length + value.length);
      combined.set(remaining, 0);
      combined.set(value, remaining.length);
      buffered = combined;
      bufferedOffset = 0;
    }
    return true;
  }

  function bufferedLength(): number {
    return buffered === null ? 0 : buffered.length - bufferedOffset;
  }

  async function ensureBuffered(n: number): Promise<boolean> {
    while (bufferedLength() < n) {
      const got = await pullChunk();
      if (!got) return false;
    }
    return true;
  }

  return {
    async readExact(n: number): Promise<Uint8Array> {
      if (n === 0) return new Uint8Array(0);
      const ok = await ensureBuffered(n);
      if (!ok) {
        throw new TarCorruptionError(
          `Unexpected end of source: needed ${n} more bytes`,
        );
      }
      const out = buffered!.subarray(bufferedOffset, bufferedOffset + n);
      bufferedOffset += n;
      // Copy out — the caller may hold this for a while, and we'll be
      // mutating buffered when we splice in new chunks.
      return out.slice();
    },

    async peek(n: number): Promise<Uint8Array> {
      if (n === 0) return new Uint8Array(0);
      await ensureBuffered(n); // ok if we don't get all of it
      const available = Math.min(n, bufferedLength());
      return buffered!.subarray(bufferedOffset, bufferedOffset + available).slice();
    },

    async skip(n: number): Promise<void> {
      let remaining = n;
      while (remaining > 0) {
        const have = bufferedLength();
        if (have >= remaining) {
          bufferedOffset += remaining;
          return;
        }
        bufferedOffset += have;
        const got = await pullChunk();
        if (!got) {
          throw new TarCorruptionError(
            `Unexpected end of source while skipping ${n} bytes`,
          );
        }
        remaining -= have;
      }
    },

    async finish(): Promise<void> {
      if (typeof iter.return === "function") {
        try {
          await iter.return();
        } catch {
          // Cleanup errors during finish are not fatal.
        }
      }
    },
  };
}

/**
 * Return true iff every byte in the buffer is zero.
 */
export function isAllZeros(buf: Uint8Array): boolean {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] !== 0) return false;
  }
  return true;
}
