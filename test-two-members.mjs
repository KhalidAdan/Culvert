const data1 = new TextEncoder().encode('First member');
const data2 = new TextEncoder().encode('Second member');

async function makeGzipMember(input) {
  const cs = new CompressionStream('deflate-raw');
  const w = cs.writable.getWriter();
  const r = cs.readable.getReader();
  await w.write(input);
  await w.close();
  const chunks = [];
  while (true) {
    const { done, value } = await r.read();
    if (done) break;
    chunks.push(value);
  }
  const compressed = new Uint8Array(chunks.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const c of chunks) { compressed.set(c, o); o += c.length; }
  
  const { CRC32 } = await import('./packages/crc32/dist/index.js');
  const crc = new CRC32();
  crc.update(input);
  const crcVal = crc.digest();
  const header = new Uint8Array([0x1f, 0x8b, 8, 0, 0,0,0,0, 0, 0xff]);
  const footer = new Uint8Array(8);
  footer[0] = crcVal & 0xff;
  footer[1] = (crcVal >>> 8) & 0xff;
  footer[2] = (crcVal >>> 16) & 0xff;
  footer[3] = (crcVal >>> 24) & 0xff;
  footer[4] = input.length & 0xff;
  footer[5] = (input.length >>> 8) & 0xff;
  footer[6] = (input.length >>> 16) & 0xff;
  footer[7] = (input.length >>> 24) & 0xff;
  const member = new Uint8Array(header.length + compressed.length + footer.length);
  member.set(header, 0);
  member.set(compressed, header.length);
  member.set(footer, header.length + compressed.length);
  return member;
}

const m1 = await makeGzipMember(data1);
const m2 = await makeGzipMember(data2);
const combined = new Uint8Array(m1.length + m2.length);
combined.set(m1, 0);
combined.set(m2, m1.length);

// Feed both members to a fresh DecompressionStream('gzip')
const ds = new DecompressionStream('gzip');
const w = ds.writable.getWriter();
const r = ds.readable.getReader();
await w.write(combined);
await w.close();

const out = [];
while (true) {
  const { done, value } = await r.read();
  if (done) break;
  out.push(value);
}
const result = new Uint8Array(out.reduce((a, b) => a + b.length, 0));
let o = 0;
for (const c of out) { result.set(c, o); o += c.length; }
console.log('Two members in one DecompressionStream:', new TextDecoder().decode(result));

// Now feed both members to a fresh DecompressionStream('gzip') WITHOUT closing
const ds2 = new DecompressionStream('gzip');
const w2 = ds2.writable.getWriter();
const r2 = ds2.readable.getReader();
await w2.write(combined);
// Don't close!

const out2 = [];
// Try reading with timeout
const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 200));
try {
  while (true) {
    const result2 = await Promise.race([r2.read(), timeout]);
    if (result2.done) {
      console.log('Readable closed without close');
      break;
    }
    out2.push(result2.value);
  }
} catch (e) {
  console.log('Timeout without close, read', out2.reduce((a,b)=>a+b.length,0), 'bytes');
}
