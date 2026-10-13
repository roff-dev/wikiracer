// Decoder for the map's varints and delta-coded lists (spec §5.4). The pipeline's encoder is
// pipeline/lib/varint.mjs.

// A read position into a byte array, advanced by every read.
export interface Cursor {
  bytes: Uint8Array;
  pos: number;
}

export function readVarint(c: Cursor): number {
  let v = 0;
  let mul = 1;
  for (;;) {
    const b = c.bytes[c.pos++];
    if (b === undefined) throw new RangeError('varint runs past the end');
    v += (b & 127) * mul;
    if (b < 128) return v;
    mul *= 128;
  }
}

// Reads one list (varint count, then id - previous - 1 deltas) into a new array.
export function readList(c: Cursor): Int32Array {
  const n = readVarint(c);
  const ids = new Int32Array(n);
  let prev = -1;
  for (let k = 0; k < n; k++) {
    prev += readVarint(c) + 1;
    ids[k] = prev;
  }
  return ids;
}

// Moves the cursor past one list without decoding its ids.
export function skipList(c: Cursor): void {
  let n = readVarint(c);
  const { bytes } = c;
  while (n > 0) {
    if (bytes[c.pos++]! < 128) n--;
  }
}
