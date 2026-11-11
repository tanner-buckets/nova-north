// A zip writer that only stores.
//
// No library, for the reason every other dependency here was refused: there is
// no build step, so a library is a CDN URL to keep working, and this is a
// hundred lines of a format that was finished in 1989 and has not moved since.
//
// Stored (method 0) rather than deflated, and that is not laziness. Every file
// going in is a PNG, which is already deflated -- compressing it again saves a
// fraction of a percent in exchange for a second implementation to get wrong.
// A zip of stored entries is a container, which is all that was wanted: a
// professor gets one download instead of forty.
//
// Deliberately not supported: zip64, encryption, folders as entries, and data
// descriptors. A sheet of trainer cards is a few megabytes and a few dozen
// files, so none of them can come up; `zipStore` throws rather than writing
// something a zip reader would quietly mis-read.
import { crc32 } from './crc32.js';

const LOCAL_SIZE = 30;
const CENTRAL_SIZE = 46;
const EOCD_SIZE = 22;

// The limits of the original format. Past any of these the central directory
// needs zip64 records, and writing the plain ones anyway produces a file that
// opens and is wrong, which is worse than a refusal.
const MAX_ENTRIES = 0xffff;
const MAX_BYTES = 0xffffffff;

// MS-DOS packed time, which is what a zip stores: seconds have two-second
// resolution and the year counts from 1980.
function dosTime(when) {
  return ((when.getHours() << 11) | (when.getMinutes() << 5)
    | Math.floor(when.getSeconds() / 2)) & 0xffff;
}

function dosDate(when) {
  return (((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5)
    | when.getDate()) & 0xffff;
}

function bytes(size, fill) {
  const buffer = new ArrayBuffer(size);
  fill(new DataView(buffer));
  return new Uint8Array(buffer);
}

// Entries are {name, data}: a path inside the zip and a Uint8Array.
export function zipStore(entries, when = new Date()) {
  if (entries.length > MAX_ENTRIES) {
    throw new Error(`A zip this way holds ${MAX_ENTRIES} files at most.`);
  }

  const encoder = new TextEncoder();
  const time = dosTime(when);
  const date = dosDate(when);

  const parts = [];
  const directory = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);

    if (offset + LOCAL_SIZE + name.length + data.length > MAX_BYTES) {
      throw new Error('That is more than a zip this way can address.');
    }

    parts.push(bytes(LOCAL_SIZE, (view) => {
      view.setUint32(0, 0x04034b50, true);   // local file header
      view.setUint16(4, 20, true);           // version needed: 2.0
      // Bit 11 says the name is UTF-8. Without it a reader falls back to the
      // OEM code page and a name with an accent in it arrives mangled.
      view.setUint16(6, 0x0800, true);
      view.setUint16(8, 0, true);            // method 0, stored
      view.setUint16(10, time, true);
      view.setUint16(12, date, true);
      view.setUint32(14, crc, true);
      view.setUint32(18, data.length, true); // compressed size
      view.setUint32(22, data.length, true); // uncompressed size
      view.setUint16(26, name.length, true);
      view.setUint16(28, 0, true);           // no extra field
    }));
    parts.push(name, data);

    directory.push({ name, crc, size: data.length, offset });
    offset += LOCAL_SIZE + name.length + data.length;
  }

  const directoryStart = offset;
  for (const item of directory) {
    parts.push(bytes(CENTRAL_SIZE, (view) => {
      view.setUint32(0, 0x02014b50, true);   // central directory header
      view.setUint16(4, 20, true);           // version made by
      view.setUint16(6, 20, true);           // version needed
      view.setUint16(8, 0x0800, true);       // UTF-8 name
      view.setUint16(10, 0, true);           // stored
      view.setUint16(12, time, true);
      view.setUint16(14, date, true);
      view.setUint32(16, item.crc, true);
      view.setUint32(20, item.size, true);
      view.setUint32(24, item.size, true);
      view.setUint16(28, item.name.length, true);
      view.setUint16(30, 0, true);           // extra
      view.setUint16(32, 0, true);           // comment
      view.setUint16(34, 0, true);           // disk number
      view.setUint16(36, 0, true);           // internal attributes
      view.setUint32(38, 0, true);           // external attributes
      view.setUint32(42, item.offset, true);
    }));
    parts.push(item.name);
    offset += CENTRAL_SIZE + item.name.length;
  }

  parts.push(bytes(EOCD_SIZE, (view) => {
    view.setUint32(0, 0x06054b50, true);     // end of central directory
    view.setUint16(4, 0, true);              // this disk
    view.setUint16(6, 0, true);              // disk with the directory
    view.setUint16(8, directory.length, true);
    view.setUint16(10, directory.length, true);
    view.setUint32(12, offset - directoryStart, true);
    view.setUint32(16, directoryStart, true);
    view.setUint16(20, 0, true);             // no comment
  }));

  return new Blob(parts, { type: 'application/zip' });
}
