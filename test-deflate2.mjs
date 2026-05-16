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

// Write compressed and close, then read all output
const ds = new DecompressionStream('deflate-raw');
const w2 = ds.writable.getWriter();
const r2 = ds.readable.getReader();

w2.write(compressed);
w2.close();

const out = [];
while (true) {
  const { done, value } = await r2.read();
  if (done) break;
  out.push(value);
}
console.log('read done, decompressed length:', out.reduce((a,b)=>a+b.length,0));

// Try to write after close
const writerState = w2.desiredSize;
console.log('writer desiredSize after close:', writerState);
try {
  await w2.write(new Uint8Array([1]));
  console.log('write after close: success');
} catch (e) {
  console.log('write after close: error', e.message);
}

// What if we don't close, but just read until we think we're done?
const ds3 = new DecompressionStream('deflate-raw');
const w3 = ds3.writable.getWriter();
const r3 = ds3.readable.getReader();

w3.write(compressed);

// Read one chunk
const { done: d1, value: v1 } = await r3.read();
console.log('first read done:', d1, 'value length:', v1?.length ?? 0);

// Write footer before closing
try {
  await w3.write(new Uint8Array([1,2,3,4,5,6,7,8]));
  console.log('write footer before close: success');
} catch (e) {
  console.log('write footer before close: error', e.message);
}

// Now close and read remaining
w3.close();
const out3 = [];
while (true) {
  const { done, value } = await r3.read();
  if (done) break;
  out3.push(value);
}
console.log('second read total length:', out3.reduce((a,b)=>a+b.length,0));
