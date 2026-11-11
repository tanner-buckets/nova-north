// CRC-32, the reflected IEEE polynomial 0xEDB88320.
//
// It has a file of its own because two unrelated things want exactly this one
// and neither should own it: every chunk of a PNG ends with it, and so does
// every entry in a zip. Writing it twice would be writing the same table twice
// and finding out later that one of them was wrong.
const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
