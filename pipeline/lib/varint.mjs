// Unsigned LEB128 varints and the delta-coded list format. The browser's decoder is
// src/search/codec.ts, and the two must stay in step.

// Byte length of varint(x).
export const vlen = (x) => (x < 128 ? 1 : x < 16384 ? 2 : x < 2097152 ? 3 : x < 268435456 ? 4 : 5);

// Writes varint(x) into buf at pos and returns the position after it.
export function writeVarint(buf, pos, x) {
  while (x >= 128) { buf[pos++] = (x & 127) | 128; x = Math.floor(x / 128); }
  buf[pos++] = x;
  return pos;
}

// Writes a list: varint(count), then ids (sorted ascending, distinct) as id - previous - 1,
// starting from previous = -1. Returns the position after it.
export function writeList(buf, pos, ids, count = ids.length) {
  pos = writeVarint(buf, pos, count);
  let prev = -1;
  for (let k = 0; k < count; k++) {
    const d = ids[k] - prev - 1;
    if (d < 0) throw new Error(`list not ascending at ${k}: ${prev} then ${ids[k]}`);
    pos = writeVarint(buf, pos, d);
    prev = ids[k];
  }
  return pos;
}
