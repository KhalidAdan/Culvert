const TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
    let crc = i;
    for (let j = 0; j < 8; j++) {
        crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
    TABLE[i] = crc;
}
export class CRC32 {
    crc = 0xffffffff;
    update(data) {
        for (let i = 0; i < data.length; i++) {
            this.crc = TABLE[(this.crc ^ data[i]) & 0xff] ^ (this.crc >>> 8);
        }
    }
    digest() {
        return (this.crc ^ 0xffffffff) >>> 0;
    }
    reset() {
        this.crc = 0xffffffff;
    }
}
//# sourceMappingURL=index.js.map