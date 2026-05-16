const data = new TextEncoder().encode('Hello, world!');
const cs = new CompressionStream('deflate-raw');
const w = cs.writable.getWriter();
const r = cs.readable.getReader();
w.write(data);
w.close();
const chunks = [];
while (true) {
  const { done, value } = await r.read();
  if (done) break;
  chunks.push(value);
}
const compressed = new Uint8Array(chunks.reduce((a, b) => a + b.length, 0));
let o = 0;
for (const c of chunks) { compressed.set(c, o); o += c.length; }

// Test: write compressed + footer in single chunk to deflate-raw, then close, then read
const ds = new DecompressionStream('deflate-raw');
const w2 = ds.writable.getWriter();
const r2 = ds.readable.getReader();

const combined = new Uint8Array(compressed.length + 8);
combined.set(compressed, 0);
combined.set(new Uint8Array([1,2,3,4,5,6,7,8]), compressed.length);

w2.write(combined);
w2.close();

const out = [];
while (true) {
  const { done, value } = await r2.read();
  if (done) break;
  out.push(value);
}
const result = new Uint8Array(out.reduce((a, b) => a + b.length, 0));
o = 0;
for (const c of out) { result.set(c, o); o += c.length; }
console.log('decompressed length:', result.length);
console.log('text:', new TextDecoder().decode(result));

// Now test: what happens with multiple writes where second write has footer?
const ds3 = new DecompressionStream('deflate-raw');
const w3 = ds3.writable.getWriter();
const r3 = ds3.readable.getReader();

w3.write(compressed);
w3.write(new Uint8Array([1,2,3,4,5,6,7,8]));
w3.close();

const out3 = [];
while (true) {
  const { done, value } = await r3.read();
  if (done) break;
  out3.push(value);
}
const result3 = new Uint8Array(out3.reduce((a, b) => a + b.length, 0));
o = 0;
for (const c of out3) { result3.set(c, o); o += c.length; }
console.log('multiple writes length:', result3.length);
console.log('multiple writes text:', new TextDecoder().decode(result3));
