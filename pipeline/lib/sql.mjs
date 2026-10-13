// Streaming reader for MediaWiki .sql.gz dumps. The dumps put one row per line after
// "INSERT INTO `t` VALUES", so every line starting with "(" is a row. Fields are read in order
// with a cursor, so nothing is allocated per row.
import { createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';

// P is the cursor into the current buffer; S/E are the last string's raw (still escaped) bounds.
export let P = 0, S = 0, E = 0;

// Calls onRow(buf) once per row with P at its first field. Returns the uncompressed byte count.
export async function forEachRow(file, onRow) {
  const gz = createReadStream(file, { highWaterMark: 1 << 23 }).pipe(createGunzip({ chunkSize: 1 << 23 }));
  let carry = null;
  let bytes = 0;
  for await (const chunk of gz) {
    bytes += chunk.length;
    const buf = carry ? Buffer.concat([carry, chunk]) : chunk;
    let start = 0;
    let nl;
    while ((nl = buf.indexOf(10, start)) !== -1) {
      if (buf[start] === 40) { P = start + 1; onRow(buf, nl); }
      start = nl + 1;
    }
    carry = start < buf.length ? Buffer.from(buf.subarray(start)) : null;
  }
  if (carry && carry[0] === 40) { P = 1; onRow(carry, carry.length); }
  return bytes;
}

export function int(b) {
  let neg = false;
  if (b[P] === 45) { neg = true; P++; }
  let v = 0, c;
  while ((c = b[P]) >= 48 && c <= 57) { v = v * 10 + (c - 48); P++; }
  P++;
  return neg ? -v : v;
}

// Reads a quoted string into S/E. Returns false for NULL.
export function str(b) {
  if (b[P] !== 39) { while (b[P] !== 44 && b[P] !== 41) P++; P++; S = E = 0; return false; }
  P++; S = P;
  for (;;) { const c = b[P]; if (c === 92) { P += 2; continue; } if (c === 39) break; P++; }
  E = P; P += 2;
  return true;
}

export function skip(b) {
  if (b[P] === 39) { str(b); return; }
  while (b[P] !== 44 && b[P] !== 41) P++;
  P++;
}

// Copies b[s, e) into out at o, undoing MySQL escapes. Returns the new end offset.
export function unescapeInto(out, o, b, s, e) {
  for (let i = s; i < e; i++) {
    let c = b[i];
    if (c === 92) {
      c = b[++i];
      if (c === 48) c = 0; else if (c === 110) c = 10; else if (c === 114) c = 13; else if (c === 90) c = 26;
    }
    out[o++] = c;
  }
  return o;
}
