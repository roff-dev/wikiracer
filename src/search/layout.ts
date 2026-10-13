// Slot indexes (spec §5.4 "Slot index"): which 2 KB slots hold an article's list or title.
import { readVarint } from './codec.ts';

// Gzip-compressed index files start with 1F 8B. A host that adds Content-Encoding on its own
// hands over bytes already decompressed, so they're only decompressed when the magic is there.
export async function maybeGunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (bytes.length < 2 || bytes[0] !== 0x1f || bytes[1] !== 0x8b) return bytes;
  const stream = new Blob([bytes as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// Decodes the varint deltas into each slot's first id (absolute). Continuation slots repeat
// their group's first id, so a group is a run of equal values.
export function decodeSlotIndex(bytes: Uint8Array): Uint32Array {
  const c = { bytes, pos: 0 };
  let out = new Uint32Array(1 << 16);
  let n = 0;
  let prev = 0;
  while (c.pos < bytes.length) {
    if (n === out.length) {
      const grown = new Uint32Array(out.length * 2);
      grown.set(out);
      out = grown;
    }
    prev += readVarint(c);
    out[n++] = prev;
  }
  return out.slice(0, n);
}

export interface Group {
  // the group's first slot
  slot: number;
  // how many consecutive slots it takes
  slots: number;
  // id of the first item in the group
  first: number;
}

// Finds the group holding item `id`: the last slot whose first id is <= id, stepped back over
// continuation slots. Assumes 0 <= id < item count.
export function groupOf(firstOfSlot: Uint32Array, id: number): Group {
  let lo = 0;
  let hi = firstOfSlot.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    if (firstOfSlot[mid]! <= id) lo = mid;
    else hi = mid - 1;
  }
  const first = firstOfSlot[lo]!;
  let slot = lo;
  while (slot > 0 && firstOfSlot[slot - 1] === first) slot--;
  return { slot, slots: lo - slot + 1, first };
}
