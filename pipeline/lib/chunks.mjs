// Writes one byte stream as fixed-size chunk files <name>-00.bin, <name>-01.bin, … and reads
// ranges back across file boundaries (spec §5.4 "Chunk files").
import { closeSync, openSync, readSync, writeSync } from 'node:fs';
import { join } from 'node:path';

export const chunkName = (name, k) => `${name}-${String(k).padStart(2, '0')}.bin`;

export class ChunkWriter {
  constructor(dir, name, chunkBytes) {
    this.dir = dir;
    this.name = name;
    this.chunkBytes = chunkBytes;
    this.buf = Buffer.alloc(chunkBytes);
    this.fill = 0;
    this.files = []; // byte size of each written file
  }

  write(bytes) {
    let o = 0;
    while (o < bytes.length) {
      const n = Math.min(bytes.length - o, this.chunkBytes - this.fill);
      this.buf.set(bytes.subarray(o, o + n), this.fill);
      this.fill += n;
      o += n;
      if (this.fill === this.chunkBytes) this.flush();
    }
  }

  pad(n) {
    while (n > 0) {
      const k = Math.min(n, this.chunkBytes - this.fill);
      this.buf.fill(0, this.fill, this.fill + k);
      this.fill += k;
      n -= k;
      if (this.fill === this.chunkBytes) this.flush();
    }
  }

  flush() {
    if (this.fill === 0) return;
    const fd = openSync(join(this.dir, chunkName(this.name, this.files.length)), 'w');
    writeSync(fd, this.buf, 0, this.fill);
    closeSync(fd);
    this.files.push(this.fill);
    this.fill = 0;
  }

  // Writes the last partial file. Returns the file sizes.
  finish() {
    this.flush();
    return this.files;
  }
}

// Reads [start, start + length) of a chunked stream, opening files as needed.
export class ChunkReader {
  constructor(dir, name, chunkBytes) {
    this.dir = dir;
    this.name = name;
    this.chunkBytes = chunkBytes;
    this.fds = new Map();
  }

  read(start, length, out = Buffer.alloc(length)) {
    let o = 0;
    while (o < length) {
      const pos = start + o;
      const k = Math.floor(pos / this.chunkBytes);
      const at = pos % this.chunkBytes;
      const n = Math.min(length - o, this.chunkBytes - at);
      if (!this.fds.has(k)) this.fds.set(k, openSync(join(this.dir, chunkName(this.name, k)), 'r'));
      const got = readSync(this.fds.get(k), out, o, n, at);
      if (got !== n) throw new Error(`${chunkName(this.name, k)}: short read at ${at}`);
      o += n;
    }
    return out;
  }

  close() {
    for (const fd of this.fds.values()) closeSync(fd);
    this.fds.clear();
  }
}
