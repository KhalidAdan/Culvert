const data = new TextEncoder().encode('Hello, world!');
const cs = new CompressionStream('deflate-raw');
const w = cs.writable.getWriter();
const r = cs.readable.getReader();
await w.write(data);
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
crc.update(data);
const crcVal = crc.digest();
const header = new Uint8Array([0x1f, 0x8b, 8, 0, 0,0,0,0, 0, 0xff]);
const footer = new Uint8Array(8);
footer[0] = crcVal & 0xff;
footer[1] = (crcVal >>> 8) & 0xff;
footer[2] = (crcVal >>> 16) & 0xff;
footer[3] = (crcVal >>> 24) & 0xff;
footer[4] = data.length & 0xff;
footer[5] = (data.length >>> 8) & 0xff;
footer[6] = (data.length >>> 16) & 0xff;
footer[7] = (data.length >>> 24) & 0xff;
const member = new Uint8Array(header.length + compressed.length + footer.length);
member.set(header, 0);
member.set(compressed, header.length);
member.set(footer, header.length + compressed.length);

// Feed one member to a fresh DecompressionStream('gzip')
const ds = new DecompressionStream('gzip');
const w2 = ds.writable.getWriter();
const r2 = ds.readable.getReader();
await w2.write(member);
await w2.close();

const out = [];
while (true) {
  const { done, value } = await r2.read();
  if (done) break;
  out.push(value);
}
const result = new Uint8Array(out.reduce((a, b) => a + b.length, 0));
o = 0;
for (const c of out) { result.set(c, o); o += c.length; }
console.log('Single member text:', new TextDecoder().decode(result));
console.log('Single member done: true');

// Now test: feed member + extra bytes
const extra = new Uint8Array([0x1f, 0x8b, 8, 0, 0,0,0,0, 0, 0xff, 0x03, 0x00, 0x00,0x00,0x00,0x00, 0x00,0x00,0x00,0x00]);
const memberWithExtra = new Uint8Array(member.length + extra.length);
memberWithExtra.set(member, 0);
memberWithExtra.set(extra, member.length);

const ds2 = new DecompressionStream('gzip');
const w3 = ds2.writable.getWriter();
const r3 = ds2.readable.getReader();
await w3.write(memberWithExtra);
await w3.close();

const out2 = [];
try {
  while (true) {
    const { done, value } = await r3.read();
    if (done) break;
    out2.push(value);
  }
  const result2 = new Uint8Array(out2.reduce((a, b) => a + b.length, 0));
  o = 0;
  for (const c of out2) { result2.set(c, o); o += c.length; }
  console.log('Member + extra text:', new TextDecoder().decode(result2));
} catch (e) {
  console.log('Member + extra error:', e.message);
}
